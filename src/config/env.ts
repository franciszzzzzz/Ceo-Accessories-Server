import "dotenv/config";
import { z } from "zod";

const proxySchema = z
  .string()
  .default("false")
  .transform((value): boolean | number | string => {
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  REDIS_URL: z.string().url().refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol)),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SENTRY_DSN: z.union([z.literal(""), z.string().url()]).default(""),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  TRUST_PROXY: proxySchema,
  BODY_LIMIT: z.string().regex(/^\d+(?:b|kb|mb|gb)?$/i).default("100kb"),
  PAYSTACK_SECRET_KEY: z.string().default(""),
});

export function parseEnvironment(values: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(values);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const corsOrigins = parsed.data.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of corsOrigins) {
    const parsedOrigin = z.string().url().safeParse(origin);
    if (origin === "*" || !parsedOrigin.success || new URL(origin).origin !== origin) {
      throw new Error("Invalid environment configuration:\n- CORS_ALLOWED_ORIGINS: provide comma-separated absolute origins; wildcards are not allowed");
    }
  }

  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    accessTokenSecret: parsed.data.ACCESS_TOKEN_SECRET,
    csrfSecret: parsed.data.CSRF_SECRET,
    corsAllowedOrigins: corsOrigins,
    logLevel: parsed.data.LOG_LEVEL,
    sentryDsn: parsed.data.SENTRY_DSN,
    sentryEnvironment: parsed.data.SENTRY_ENVIRONMENT ?? parsed.data.NODE_ENV,
    trustProxy: parsed.data.TRUST_PROXY,
    bodyLimit: parsed.data.BODY_LIMIT,
    paystackSecretKey: parsed.data.PAYSTACK_SECRET_KEY,
  });
}

export const env = parseEnvironment(process.env);

export type AppConfig = typeof env;
