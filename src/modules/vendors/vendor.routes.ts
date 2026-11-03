import { Router, type RequestHandler } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import { authenticate, requireCsrf, requireRoles } from "../auth/auth.middleware.js";
import * as controller from "./vendor.controller.js";
import {
  applicationIdSchema,
  applicationListSchema,
  applicationSchema,
  rejectionSchema,
} from "./vendor.schemas.js";
import { storeIdSchema, storeListSchema, storeSlugSchema, storeUpdateSchema } from "./store.schemas.js";

export interface VendorRateLimiters {
  onboarding?: RequestHandler;
  adminMutation?: RequestHandler;
}

export function createVendorRouter(rateLimiters: VendorRateLimiters = {}): Router {
  const onboardingLimit = rateLimiters.onboarding ?? createRateLimit({ prefix: "vendor-onboarding", limit: 10, windowSeconds: 900 });
  const adminMutationLimit = rateLimiters.adminMutation ?? createRateLimit({ prefix: "vendor-admin", limit: 30, windowSeconds: 900 });
  const router = Router();
  router.post(
    "/vendor-applications",
    authenticate,
    requireRoles("customer"),
    onboardingLimit,
    requireCsrf,
    validateRequest({ body: applicationSchema }),
    controller.submitApplication,
  );
  router.get("/vendor-applications/me", authenticate, requireRoles("customer"), controller.listOwnApplications);

  router.get(
    "/admin/vendor-applications",
    authenticate,
    requireRoles("admin"),
    validateRequest({ query: applicationListSchema }),
    controller.listApplications,
  );
  router.get(
    "/admin/vendor-applications/:id",
    authenticate,
    requireRoles("admin"),
    validateRequest({ params: applicationIdSchema }),
    controller.getApplication,
  );
  router.post(
    "/admin/vendor-applications/:id/approve",
    authenticate,
    requireRoles("admin"),
    adminMutationLimit,
    requireCsrf,
    validateRequest({ params: applicationIdSchema }),
    controller.approveApplication,
  );
  router.post(
    "/admin/vendor-applications/:id/reject",
    authenticate,
    requireRoles("admin"),
    adminMutationLimit,
    requireCsrf,
    validateRequest({ params: applicationIdSchema, body: rejectionSchema }),
    controller.rejectApplication,
  );
  router.get("/admin/stores", authenticate, requireRoles("admin"), validateRequest({ query: storeListSchema }), controller.listPendingStores);
  router.post(
    "/admin/stores/:id/activate",
    authenticate,
    requireRoles("admin"),
    adminMutationLimit,
    requireCsrf,
    validateRequest({ params: storeIdSchema }),
    controller.activateStore,
  );

  router.get("/stores/me", authenticate, requireRoles("vendor"), controller.getOwnStore);
  router.patch(
    "/stores/me",
    authenticate,
    requireRoles("vendor"),
    requireCsrf,
    validateRequest({ body: storeUpdateSchema }),
    controller.updateOwnStore,
  );
  router.get("/stores/:slug", validateRequest({ params: storeSlugSchema }), controller.getPublicStore);
  return router;
}
