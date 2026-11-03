import cors from "cors";
import express, {
  type Express,
  type Request,
  type RequestHandler,
  type Router,
} from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { createRateLimit } from "./middleware/rate-limit.js";
import type { HealthChecks } from "./modules/health/health.types.js";
import { errorHandler } from "./middleware/error.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createApiRouter } from "./routes/index.js";
import type { VendorRateLimiters } from "./modules/vendors/vendor.routes.js";

export interface AppOptions {
  healthChecks?: HealthChecks;
  extraRoutes?: Router;
  globalRateLimiter?: RequestHandler;
  authRateLimiter?: RequestHandler;
  vendorRateLimiters?: VendorRateLimiters;
  orderRateLimiter?: RequestHandler;
  paymentRateLimiter?: RequestHandler;
  commissionRateLimiter?: RequestHandler;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy);

  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      origin:
        env.corsAllowedOrigins.length > 0 ? env.corsAllowedOrigins : false,
      credentials: true,
    }),
  );
  app.use(express.json({
    limit: env.bodyLimit,
    strict: true,
    verify: (request, _response, buffer) => {
      const expressRequest = request as Request;
      if (expressRequest.originalUrl.startsWith("/api/v1/payments/webhooks/paystack")) {
        expressRequest.rawBody = Buffer.from(buffer);
      }
    },
  }));
  app.use(
    "/api/v1",
    options.globalRateLimiter ??
      createRateLimit({ prefix: "global", limit: 300, windowSeconds: 900 }),
  );
  app.use(
    "/api/v1",
    createApiRouter(
      options.extraRoutes,
      options.healthChecks,
      options.authRateLimiter,
      options.vendorRateLimiters,
      options.orderRateLimiter,
      options.paymentRateLimiter,
      options.commissionRateLimiter,
    ),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
