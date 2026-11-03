import type { RequestHandler } from "express";
import { Router } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { AppError } from "../../shared/errors/app-error.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import { authenticate, requireCsrf, requireRoles } from "../auth/auth.middleware.js";
import * as controller from "./payments.controller.js";
import {
  idempotencyHeaderSchema,
  paystackWebhookSchema,
  paymentIdSchema,
  paymentReferenceSchema,
  refundCreateSchema,
} from "./payments.schemas.js";

const paymentWriteLimit = createRateLimit({ prefix: "payment-write", limit: 30, windowSeconds: 900 });

const validateIdempotencyKey: RequestHandler = (request, response, next) => {
  const result = idempotencyHeaderSchema.safeParse({ key: request.get("Idempotency-Key") });
  if (!result.success) {
    next(new AppError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required.", result.error.issues.map((issue) => ({
      field: "Idempotency-Key",
      message: issue.message,
    }))));
    return;
  }
  response.locals.idempotencyKey = result.data.key;
  next();
};

export function createPaymentsRouter(paymentRateLimiter?: RequestHandler): Router {
  const router = Router();
  const writeLimit = paymentRateLimiter ?? paymentWriteLimit;
  router.post(
    "/orders/:id/payment",
    authenticate,
    requireRoles("customer"),
    writeLimit,
    requireCsrf,
    validateIdempotencyKey,
    validateRequest({ params: paymentIdSchema }),
    controller.initiatePayment,
  );
  router.get(
    "/orders/:id/payment",
    authenticate,
    requireRoles("customer"),
    validateRequest({ params: paymentIdSchema }),
    controller.getOrderPayment,
  );
  router.post(
    "/payments/verify",
    authenticate,
    requireRoles("customer"),
    writeLimit,
    requireCsrf,
    validateRequest({ body: paymentReferenceSchema }),
    controller.verifyPayment,
  );
  router.post("/payments/webhooks/paystack", validateRequest({ body: paystackWebhookSchema }), controller.paystackWebhook);
  router.post(
    "/admin/payments/:id/refunds",
    authenticate,
    requireRoles("admin"),
    writeLimit,
    requireCsrf,
    validateIdempotencyKey,
    validateRequest({ params: paymentIdSchema, body: refundCreateSchema }),
    controller.createRefund,
  );
  router.get(
    "/admin/payments/:id/refunds",
    authenticate,
    requireRoles("admin"),
    validateRequest({ params: paymentIdSchema }),
    controller.listRefunds,
  );
  return router;
}
