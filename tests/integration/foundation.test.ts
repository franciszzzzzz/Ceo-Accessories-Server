import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp, type AppOptions } from "../../src/app.js";
import { createErrorHandler } from "../../src/middleware/error.js";
import { requestIdMiddleware } from "../../src/middleware/request-id.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { sendSuccess } from "../../src/shared/http/envelopes.js";
import { validateRequest } from "../../src/shared/middleware/validate.js";

function createTestApp(options: AppOptions = {}) {
  return createApp({
    ...options,
    globalRateLimiter: (_request, _response, next) => next(),
    authRateLimiter: (_request, _response, next) => next(),
  });
}

describe("Phase 1 HTTP foundation", () => {
  it("returns liveness in the success envelope without checking dependencies", async () => {
    const app = createTestApp({
      healthChecks: {
        database: vi.fn().mockRejectedValue(new Error("must not be called")),
        redis: vi.fn().mockRejectedValue(new Error("must not be called")),
      },
    });

    const response = await request(app).get("/api/v1/health").expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: { status: "ok" },
    });
    expect(response.body.data.uptime).toEqual(expect.any(Number));
    expect(response.body.data.timestamp).toEqual(expect.any(String));
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("returns ready when PostgreSQL and Redis checks succeed", async () => {
    const app = createTestApp({
      healthChecks: { database: vi.fn().mockResolvedValue(undefined), redis: vi.fn().mockResolvedValue(undefined) },
    });

    const response = await request(app).get("/api/v1/ready").expect(200);
    expect(response.body).toEqual({
      success: true,
      data: { status: "ready", checks: { database: "up", redis: "up" } },
    });
  });

  it.each([
    ["database", "redis"],
    ["redis", "database"],
  ] as const)("returns 503 when %s is down", async (failedCheck, healthyCheck) => {
    const checks = {
      database: vi.fn().mockResolvedValue(undefined),
      redis: vi.fn().mockResolvedValue(undefined),
    };
    checks[failedCheck].mockRejectedValue(new Error("dependency unavailable"));
    const app = createTestApp({ healthChecks: checks });

    const response = await request(app).get("/api/v1/ready").expect(503);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        details: {
          checks: { [failedCheck]: "down", [healthyCheck]: "up" },
        },
        requestId: response.headers["x-request-id"],
      },
    });
    expect(response.body.error.message).not.toContain("dependency unavailable");
  });

  it("returns the standard not-found error envelope", async () => {
    const response = await request(createTestApp()).get("/api/v1/missing").expect(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND", requestId: response.headers["x-request-id"] },
    });
  });

  it("maps AppError to its status and code", async () => {
    const extraRoutes = Router();
    extraRoutes.get("/app-error", (_request, _response, next) => {
      next(new AppError(409, "CONFLICT", "The operation conflicts."));
    });
    const response = await request(createTestApp({ extraRoutes })).get("/api/v1/app-error").expect(409);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "CONFLICT", message: "The operation conflicts." },
    });
  });

  it("maps Zod request failures to VALIDATION_ERROR details", async () => {
    const extraRoutes = Router();
    extraRoutes.post(
      "/validate",
      validateRequest({ body: z.object({ name: z.string().min(1) }).strict() }),
      (_request, response) => sendSuccess(response, { accepted: true }),
    );

    const response = await request(createTestApp({ extraRoutes }))
      .post("/api/v1/validate")
      .send({ name: 42 })
      .expect(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", details: expect.arrayContaining([expect.objectContaining({ field: "name" })]) },
    });
  });

  it("does not return internal messages or stacks for unexpected production errors", async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/failure", () => {
      throw new Error("sensitive database detail");
    });
    app.use(createErrorHandler(true));

    const response = await request(app).get("/failure").expect(500);
    expect(JSON.stringify(response.body)).not.toContain("sensitive database detail");
    expect(JSON.stringify(response.body)).not.toContain("stack");
    expect(response.body.error.message).toBe("An unexpected error occurred.");
  });

  it("keeps production 5xx AppError messages and details private", async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/failure", (_request, _response, next) => {
      next(new AppError(500, "INTERNAL_ERROR", "sensitive database detail", { password: "hidden" }));
    });
    app.use(createErrorHandler(true));

    const response = await request(app).get("/failure").expect(500);
    expect(response.body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
    expect(response.body.error.details).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("sensitive database detail");
    expect(JSON.stringify(response.body)).not.toContain("hidden");
  });
});

describe("Phase 2 authentication HTTP boundary", () => {
  it("issues a signed CSRF token cookie and response value", async () => {
    const response = await request(createTestApp()).get("/api/v1/auth/csrf").expect(200);
    expect(response.body).toMatchObject({ success: true, data: { csrfToken: expect.any(String) } });
    expect(response.headers["set-cookie"]).toEqual(expect.arrayContaining([expect.stringContaining("csrf_token=")]));
  });

  it("rejects unsafe auth requests without a matching CSRF cookie and header", async () => {
    const response = await request(createTestApp())
      .post("/api/v1/auth/register")
      .send({ email: "shopper@example.com", password: "long-enough-password" })
      .expect(403);
    expect(response.body).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  });

  it("validates auth payloads after a valid CSRF check", async () => {
    const csrf = await request(createTestApp()).get("/api/v1/auth/csrf").expect(200);
    const token = csrf.body.data.csrfToken as string;
    const response = await request(createTestApp())
      .post("/api/v1/auth/register")
      .set("Cookie", `csrf_token=${token}`)
      .set("X-CSRF-Token", token)
      .send({ email: "invalid", password: "too-short" })
      .expect(400);
    expect(response.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });
});
