import { Router } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import { authenticate, requireCsrf, requireRoles } from "../auth/auth.middleware.js";
import * as controller from "./catalog.controller.js";
import {
  categoryCreateSchema,
  categoryIdSchema,
  categoryListSchema,
  categorySlugSchema,
  categoryUpdateSchema,
  productCreateSchema,
  productIdSchema,
  productParamsSchema,
  productListSchema,
  productUpdateSchema,
  publicProductListSchema,
  publicProductParamsSchema,
  variantCreateSchema,
  variantUpdateSchema,
  productVariantParamsSchema,
} from "./catalog.schemas.js";

const catalogWriteLimit = createRateLimit({ prefix: "catalog-write", limit: 120, windowSeconds: 900 });
const categoryWriteLimit = createRateLimit({ prefix: "category-write", limit: 60, windowSeconds: 900 });

export function createCatalogRouter(): Router {
  const router = Router();

  router.get("/categories", controller.listPublicCategories);
  router.get("/categories/:slug", validateRequest({ params: categorySlugSchema }), controller.getCategory);
  router.get("/admin/categories", authenticate, requireRoles("admin"), validateRequest({ query: categoryListSchema }), controller.listAdminCategories);
  router.post(
    "/admin/categories",
    authenticate,
    requireRoles("admin"),
    categoryWriteLimit,
    requireCsrf,
    validateRequest({ body: categoryCreateSchema }),
    controller.createCategory,
  );
  router.patch(
    "/admin/categories/:id",
    authenticate,
    requireRoles("admin"),
    categoryWriteLimit,
    requireCsrf,
    validateRequest({ params: categoryIdSchema, body: categoryUpdateSchema }),
    controller.updateCategory,
  );
  router.post(
    "/admin/categories/:id/archive",
    authenticate,
    requireRoles("admin"),
    categoryWriteLimit,
    requireCsrf,
    validateRequest({ params: categoryIdSchema }),
    controller.archiveCategory,
  );

  router.get("/vendor/products", authenticate, requireRoles("vendor"), validateRequest({ query: productListSchema }), controller.listVendorProducts);
  router.post(
    "/vendor/products",
    authenticate,
    requireRoles("vendor"),
    catalogWriteLimit,
    requireCsrf,
    validateRequest({ body: productCreateSchema }),
    controller.createProduct,
  );
  router.get("/vendor/products/:id", authenticate, requireRoles("vendor"), validateRequest({ params: productIdSchema }), controller.getVendorProduct);
  router.patch(
    "/vendor/products/:id",
    authenticate,
    requireRoles("vendor"),
    catalogWriteLimit,
    requireCsrf,
    validateRequest({ params: productIdSchema, body: productUpdateSchema }),
    controller.updateVendorProduct,
  );
  router.post(
    "/vendor/products/:id/publish",
    authenticate,
    requireRoles("vendor"),
    catalogWriteLimit,
    requireCsrf,
    validateRequest({ params: productIdSchema }),
    controller.publishProduct,
  );
  router.post(
    "/vendor/products/:id/archive",
    authenticate,
    requireRoles("vendor"),
    catalogWriteLimit,
    requireCsrf,
    validateRequest({ params: productIdSchema }),
    controller.archiveProduct,
  );
  router.post(
    "/vendor/products/:productId/variants",
    authenticate,
    requireRoles("vendor"),
    catalogWriteLimit,
    requireCsrf,
    validateRequest({ params: productParamsSchema, body: variantCreateSchema }),
    controller.createVariant,
  );
  router.patch(
    "/vendor/products/:productId/variants/:variantId",
    authenticate,
    requireRoles("vendor"),
    catalogWriteLimit,
    requireCsrf,
    validateRequest({ params: productVariantParamsSchema, body: variantUpdateSchema }),
    controller.updateVariant,
  );
  router.post(
    "/vendor/products/:productId/variants/:variantId/archive",
    authenticate,
    requireRoles("vendor"),
    catalogWriteLimit,
    requireCsrf,
    validateRequest({ params: productVariantParamsSchema }),
    controller.archiveVariant,
  );

  router.get("/products", validateRequest({ query: publicProductListSchema }), controller.searchProducts);
  router.get("/stores/:storeSlug/products/:productSlug", validateRequest({ params: publicProductParamsSchema }), controller.getPublicProduct);
  return router;
}
