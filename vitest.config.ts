import { defineConfig } from "vitest/config";
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";

const localEnvironment = existsSync(".env") ? parse(readFileSync(".env")) : {};
const testDatabaseUrl = localEnvironment.DATABASE_URL_TEST;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    clearMocks: true,
    restoreMocks: true,
    env: {
      NODE_ENV: "test",
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
      REDIS_URL: "redis://localhost:6379",
      ACCESS_TOKEN_SECRET: "test-only-access-secret-long-enough-for-validation",
      CSRF_SECRET: "test-only-csrf-secret-long-enough-for-validation",
      CORS_ALLOWED_ORIGINS: "http://localhost:3000",
      LOG_LEVEL: "silent",
      SENTRY_DSN: "",
    },
  },
});
