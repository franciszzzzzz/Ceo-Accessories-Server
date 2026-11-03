import { Router, type RequestHandler } from "express";
import { createHealthRouter } from "../modules/health/health.routes.js";
import { healthRepository } from "../modules/health/health.repository.js";
import type { HealthChecks } from "../modules/health/health.types.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { createVendorRouter, type VendorRateLimiters } from "../modules/vendors/vendor.routes.js";
import { createCatalogRouter } from "../modules/catalog/catalog.routes.js";
import { createInventoryRouter } from "../modules/inventory/inventory.routes.js";
import { createCartRouter } from "../modules/cart/cart.routes.js";
import { createOrdersRouter } from "../modules/orders/orders.routes.js";
import { createPaymentsRouter } from "../modules/payments/payments.routes.js";
import { createCommissionsRouter } from "../modules/commissions/commissions.routes.js";

export function createApiRouter(
  extraRoutes?: Router,
  checks: HealthChecks = healthRepository,
  authRateLimiter?: RequestHandler,
  vendorRateLimiters?: VendorRateLimiters,
  orderRateLimiter?: RequestHandler,
  paymentRateLimiter?: RequestHandler,
  commissionRateLimiter?: RequestHandler,
): Router {
  const router = Router();
  router.use(createHealthRouter(checks));
  router.use("/auth", createAuthRouter(authRateLimiter));
  router.use(createVendorRouter(vendorRateLimiters));
  router.use(createCatalogRouter());
  router.use(createInventoryRouter());
  router.use(createCartRouter());
  router.use(createOrdersRouter(orderRateLimiter));
  router.use(createPaymentsRouter(paymentRateLimiter));
  router.use(createCommissionsRouter(commissionRateLimiter));
  if (extraRoutes) router.use(extraRoutes);
  return router;
}
