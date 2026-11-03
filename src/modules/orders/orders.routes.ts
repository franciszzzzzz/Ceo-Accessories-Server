import type { RequestHandler } from "express";
import { Router } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { AppError } from "../../shared/errors/app-error.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import { authenticate, requireCsrf, requireRoles } from "../auth/auth.middleware.js";
import * as controller from "./orders.controller.js";
import { checkoutSchema, idempotencyHeaderSchema, orderIdSchema, orderListSchema } from "./orders.schemas.js";

const orderWriteLimit = createRateLimit({ prefix: "order-write", limit: 30, windowSeconds: 900 });

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

export function createOrdersRouter(orderRateLimiter?: RequestHandler): Router {
  const router = Router();
  const writeLimit = orderRateLimiter ?? orderWriteLimit;
  router.post(
    "/orders/checkout",
    authenticate,
    requireRoles("customer"),
    writeLimit,
    requireCsrf,
    validateIdempotencyKey,
    validateRequest({ body: checkoutSchema }),
    controller.checkout,
  );
  router.get("/orders/me", authenticate, requireRoles("customer"), validateRequest({ query: orderListSchema }), controller.listCustomerOrders);
  router.get("/orders/:id", authenticate, requireRoles("customer"), validateRequest({ params: orderIdSchema }), controller.getCustomerOrder);
  router.post(
    "/orders/:id/cancel",
    authenticate,
    requireRoles("customer"),
    writeLimit,
    requireCsrf,
    validateRequest({ params: orderIdSchema }),
    controller.cancelCustomerOrder,
  );
  router.get("/vendor/orders", authenticate, requireRoles("vendor"), validateRequest({ query: orderListSchema }), controller.listVendorOrders);
  router.get("/vendor/orders/:id", authenticate, requireRoles("vendor"), validateRequest({ params: orderIdSchema }), controller.getVendorOrder);
  return router;
}
