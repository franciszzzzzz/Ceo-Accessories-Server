import { Router } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import { authenticate, requireCsrf, requireRoles } from "../auth/auth.middleware.js";
import * as controller from "./cart.controller.js";
import { cartItemCreateSchema, cartItemIdSchema, cartItemUpdateSchema } from "./cart.schemas.js";

const cartWriteLimit = createRateLimit({ prefix: "cart-write", limit: 120, windowSeconds: 900 });

export function createCartRouter(): Router {
  const router = Router();
  router.get("/cart", authenticate, requireRoles("customer"), controller.getCart);
  router.put(
    "/cart/items",
    authenticate,
    requireRoles("customer"),
    cartWriteLimit,
    requireCsrf,
    validateRequest({ body: cartItemCreateSchema }),
    controller.putCartItem,
  );
  router.patch(
    "/cart/items/:id",
    authenticate,
    requireRoles("customer"),
    cartWriteLimit,
    requireCsrf,
    validateRequest({ params: cartItemIdSchema, body: cartItemUpdateSchema }),
    controller.updateCartItem,
  );
  router.delete(
    "/cart/items/:id",
    authenticate,
    requireRoles("customer"),
    cartWriteLimit,
    requireCsrf,
    validateRequest({ params: cartItemIdSchema }),
    controller.removeCartItem,
  );
  router.delete("/cart", authenticate, requireRoles("customer"), cartWriteLimit, requireCsrf, controller.clearCart);
  return router;
}
