import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { redis } from "../config/redis.js";
import { ServiceUnavailableError, AppError } from "../shared/errors/app-error.js";

export function createRateLimit(options: { limit: number; windowSeconds: number; prefix: string }): RequestHandler {
  return async (request, response, next) => {
    if (request.path === "/health" || request.path === "/ready") {
      next();
      return;
    }
    try {
      const clientKey = createHash("sha256").update(request.ip ?? "unknown").digest("hex");
      const key = `rate:${options.prefix}:${clientKey}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, options.windowSeconds);
      if (count > options.limit) {
        response.setHeader("Retry-After", String(options.windowSeconds));
        next(new AppError(429, "RATE_LIMITED", "Too many requests. Try again later."));
        return;
      }
      next();
    } catch {
      next(new ServiceUnavailableError({ status: "not_ready", checks: { redis: "down" } }));
    }
  };
}
