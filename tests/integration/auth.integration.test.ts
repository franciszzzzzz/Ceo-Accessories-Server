import { randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, disconnectDatabase, prisma } from "../../src/config/database.js";
import { connectRedis, disconnectRedis } from "../../src/config/redis.js";
import { createApp } from "../../src/app.js";
import { createRateLimit } from "../../src/middleware/rate-limit.js";
import { env } from "../../src/config/env.js";
import { createPasswordResetToken } from "../../src/modules/auth/auth.repository.js";
import { hashToken } from "../../src/modules/auth/auth.service.js";

const app = createApp({
  globalRateLimiter: (_request, _response, next) => next(),
  authRateLimiter: createRateLimit({ prefix: `auth-integration-${randomUUID()}`, limit: 20, windowSeconds: 60 }),
});
const email = `phase2-${randomUUID()}@example.com`;
const password = "phase-two-integration-password";
let databaseConnected = false;
let redisConnected = false;

function cookieHeader(setCookie: string[] | string | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function cookieValue(header: string, name: string): string {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) throw new Error(`Expected ${name} cookie`);
  return match[1] ?? "";
}

beforeAll(async () => {
  await connectDatabase();
  databaseConnected = true;
  await connectRedis();
  redisConnected = true;
});

afterAll(async () => {
  if (databaseConnected) await prisma.user.deleteMany({ where: { email } });
  if (redisConnected) await disconnectRedis();
  if (databaseConnected) await disconnectDatabase();
});

describe("Phase 2 database-backed browser identity", () => {
  it("registers, logs in, rotates refresh, authenticates, and logs out", async () => {
    const csrfResponse = await request(app).get("/api/v1/auth/csrf").expect(200);
    const initialCsrf = csrfResponse.body.data.csrfToken as string;

    await request(app)
      .post("/api/v1/auth/register")
      .set("Cookie", `csrf_token=${initialCsrf}`)
      .set("X-CSRF-Token", initialCsrf)
      .send({ email, password })
      .expect(202);

    await request(app)
      .post("/api/v1/auth/register")
      .set("Cookie", `csrf_token=${initialCsrf}`)
      .set("X-CSRF-Token", initialCsrf)
      .send({ email, password })
      .expect(202);
    const persistedUser = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    expect(persistedUser?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(persistedUser?.passwordHash).not.toBe(password);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("Cookie", `csrf_token=${initialCsrf}`)
      .set("X-CSRF-Token", initialCsrf)
      .send({ email, password })
      .expect(200);
    expect(login.body.data.user).toMatchObject({ email, roles: ["customer"] });

    const loginCookies = cookieHeader(login.headers["set-cookie"] as string[] | undefined);
    const loginCsrf = cookieValue(loginCookies, "csrf_token");
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await new SignJWT({ sid: randomUUID() })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("marketplace-server")
      .setAudience("marketplace-web")
      .setSubject(login.body.data.user.id as string)
      .setIssuedAt(now - 60)
      .setExpirationTime(now - 1)
      .sign(new TextEncoder().encode(env.accessTokenSecret));
    await request(app).get("/api/v1/auth/me").set("Cookie", `access_token=${expiredToken}`).expect(401);
    const loginRefreshToken = cookieValue(loginCookies, "refresh_token");
    const storedRefreshTokens = await prisma.refreshSession.findMany({
      where: { user: { email } },
      select: { tokenHash: true },
    });
    expect(storedRefreshTokens.length).toBe(1);
    expect(storedRefreshTokens[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedRefreshTokens[0]?.tokenHash).not.toBe(loginRefreshToken);
    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loginCookies)
      .set("X-CSRF-Token", loginCsrf)
      .expect(200);
    expect(refresh.body.data.user.email).toBe(email);

    const refreshedCookies = cookieHeader(refresh.headers["set-cookie"] as string[] | undefined);
    const refreshedCsrf = cookieValue(refreshedCookies, "csrf_token");
    await request(app).get("/api/v1/auth/me").set("Cookie", refreshedCookies).expect(200);

    const malformedCookies = refreshedCookies
      .split("; ")
      .map((cookie) => (cookie.startsWith("access_token=") ? "access_token=invalid" : cookie))
      .join("; ");
    await request(app).get("/api/v1/auth/me").set("Cookie", malformedCookies).expect(401);

    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loginCookies)
      .set("X-CSRF-Token", loginCsrf)
      .expect(401);
    await request(app).get("/api/v1/auth/me").set("Cookie", refreshedCookies).expect(401);

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", refreshedCookies)
      .set("X-CSRF-Token", refreshedCsrf)
      .expect(204);
    await request(app).get("/api/v1/auth/me").set("Cookie", refreshedCookies).expect(401);

    const resetRequestBody = { email };
    await request(app)
      .post("/api/v1/auth/password-reset-requests")
      .set("Cookie", `csrf_token=${refreshedCsrf}`)
      .set("X-CSRF-Token", refreshedCsrf)
      .send(resetRequestBody)
      .expect(202);
    await request(app)
      .post("/api/v1/auth/password-reset-requests")
      .set("Cookie", `csrf_token=${refreshedCsrf}`)
      .set("X-CSRF-Token", refreshedCsrf)
      .send({ email: `unknown-${randomUUID()}@example.com` })
      .expect(202);

    const resetToken = randomBytes(32).toString("base64url");
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await createPasswordResetToken({ userId: user.id, tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 60_000) });
    const storedReset = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(resetToken) },
      select: { tokenHash: true },
    });
    expect(storedReset?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedReset?.tokenHash).not.toBe(resetToken);
    await request(app)
      .post("/api/v1/auth/password-resets")
      .set("Cookie", `csrf_token=${refreshedCsrf}`)
      .set("X-CSRF-Token", refreshedCsrf)
      .send({ token: resetToken, password: "new-phase-two-password" })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/password-resets")
      .set("Cookie", `csrf_token=${refreshedCsrf}`)
      .set("X-CSRF-Token", refreshedCsrf)
      .send({ token: resetToken, password: "another-phase-two-password" })
      .expect(400);

    const expiredReset = randomBytes(32).toString("base64url");
    await createPasswordResetToken({ userId: user.id, tokenHash: hashToken(expiredReset), expiresAt: new Date(Date.now() - 1) });
    await request(app)
      .post("/api/v1/auth/password-resets")
      .set("Cookie", `csrf_token=${refreshedCsrf}`)
      .set("X-CSRF-Token", refreshedCsrf)
      .send({ token: expiredReset, password: "another-phase-two-password" })
      .expect(400);
  });

  it("returns RATE_LIMITED from the Redis-backed authentication limiter", async () => {
    const limitedApp = createApp({
      globalRateLimiter: (_request, _response, next) => next(),
      authRateLimiter: createRateLimit({ prefix: `test-${randomUUID()}`, limit: 1, windowSeconds: 60 }),
    });
    const first = await request(limitedApp).post("/api/v1/auth/login").send({}).expect(403);
    expect(first.body.error.code).toBe("FORBIDDEN");
    const second = await request(limitedApp).post("/api/v1/auth/login").send({}).expect(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
  });
});
