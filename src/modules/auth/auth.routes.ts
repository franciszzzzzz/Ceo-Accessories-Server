import { Router, type RequestHandler } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import * as controller from "./auth.controller.js";
import { authenticate, requireCsrf } from "./auth.middleware.js";
import {
  loginSchema,
  passwordResetCompleteSchema,
  passwordResetRequestSchema,
  registerSchema,
} from "./auth.schemas.js";

export function createAuthRouter(rateLimiter: RequestHandler = createRateLimit({ prefix: "auth", limit: 10, windowSeconds: 900 })): Router {
  const router = Router();
  router.get("/csrf", controller.issueCsrf);
  router.post("/register", rateLimiter, requireCsrf, validateRequest({ body: registerSchema }), controller.register);
  router.post("/login", rateLimiter, requireCsrf, validateRequest({ body: loginSchema }), controller.login);
  router.post("/refresh", rateLimiter, requireCsrf, controller.refresh);
  router.post("/logout", requireCsrf, controller.logout);
  router.get("/me", authenticate, controller.currentUser);
  router.post(
    "/password-reset-requests",
    rateLimiter,
    requireCsrf,
    validateRequest({ body: passwordResetRequestSchema }),
    controller.requestPasswordReset,
  );
  router.post(
    "/password-resets",
    rateLimiter,
    requireCsrf,
    validateRequest({ body: passwordResetCompleteSchema }),
    controller.completePasswordReset,
  );
  return router;
}
