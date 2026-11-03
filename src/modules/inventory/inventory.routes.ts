import { Router } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import { authenticate, requireCsrf, requireRoles } from "../auth/auth.middleware.js";
import * as controller from "./inventory.controller.js";
import {
  inventoryListSchema,
  inventoryUpdateSchema,
  reservationCreateSchema,
  reservationIdSchema,
  variantIdSchema,
} from "./inventory.schemas.js";

const inventoryWriteLimit = createRateLimit({ prefix: "inventory-write", limit: 60, windowSeconds: 900 });

export function createInventoryRouter(): Router {
  const router = Router();
  router.get(
    "/vendor/inventory",
    authenticate,
    requireRoles("vendor"),
    validateRequest({ query: inventoryListSchema }),
    controller.listVendorInventory,
  );
  router.patch(
    "/vendor/inventory/:variantId",
    authenticate,
    requireRoles("vendor"),
    inventoryWriteLimit,
    requireCsrf,
    validateRequest({ params: variantIdSchema, body: inventoryUpdateSchema }),
    controller.updateVendorInventory,
  );
  router.get(
    "/inventory/reservations/me",
    authenticate,
    requireRoles("customer"),
    controller.listOwnReservations,
  );
  router.post(
    "/inventory/reservations",
    authenticate,
    requireRoles("customer"),
    inventoryWriteLimit,
    requireCsrf,
    validateRequest({ body: reservationCreateSchema }),
    controller.createReservation,
  );
  router.delete(
    "/inventory/reservations/:id",
    authenticate,
    requireRoles("customer"),
    inventoryWriteLimit,
    requireCsrf,
    validateRequest({ params: reservationIdSchema }),
    controller.releaseReservation,
  );
  router.get(
    "/admin/inventory/low-stock",
    authenticate,
    requireRoles("admin"),
    validateRequest({ query: inventoryListSchema }),
    controller.listLowStockInventory,
  );
  return router;
}
