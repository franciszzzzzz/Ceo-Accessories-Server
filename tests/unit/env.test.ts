import { parseEnvironment } from "../../src/config/env.js";
import { describe, expect, it } from "vitest";

describe("environment configuration", () => {
  it("fails clearly when required configuration is missing", () => {
    expect(() => parseEnvironment({})).toThrow(/Invalid environment configuration/);
    expect(() => parseEnvironment({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnvironment({})).toThrow(/REDIS_URL/);
  });

  it("rejects wildcard CORS origins", () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: "postgresql://localhost/marketplace",
        REDIS_URL: "redis://localhost:6379",
        ACCESS_TOKEN_SECRET: "test-only-access-secret-long-enough-for-validation",
        CSRF_SECRET: "test-only-csrf-secret-long-enough-for-validation",
        CORS_ALLOWED_ORIGINS: "*",
      }),
    ).toThrow(/wildcards are not allowed/);
  });
});
