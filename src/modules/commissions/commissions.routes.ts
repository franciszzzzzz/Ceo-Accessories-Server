import type { RequestHandler } from "express";
import { Router } from "express";
import { createRateLimit } from "../../middleware/rate-limit.js";
import { AppError } from "../../shared/errors/app-error.js";
import { validateRequest } from "../../shared/middleware/validate.js";
import { authenticate, requireCsrf, requireRoles } from "../auth/auth.middleware.js";
import * as controller from "./commissions.controller.js";
import { commissionRuleSchema, idempotencySchema, pageSchema, payoutCompleteSchema, payoutCreateSchema, payoutIdSchema, payoutRejectSchema, ruleEndSchema, ruleIdSchema } from "./commissions.schemas.js";

const writeRateLimit = createRateLimit({ prefix: "commission-payout-write", limit: 30, windowSeconds: 900 });
const idempotencyKey: RequestHandler = (request, response, next) => {
  const parsed = idempotencySchema.safeParse({ key: request.get("Idempotency-Key") });
  if (!parsed.success) {
    next(new AppError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required."));
    return;
  }
  response.locals.idempotencyKey = parsed.data.key;
  next();
};

export function createCommissionsRouter(rateLimiter?: RequestHandler): Router {
  const router = Router();
  const limit = rateLimiter ?? writeRateLimit;
  router.get("/admin/commission-rules", authenticate, requireRoles("admin"), validateRequest({ query: pageSchema }), controller.listRules);
  router.post("/admin/commission-rules", authenticate, requireRoles("admin"), limit, requireCsrf, validateRequest({ body: commissionRuleSchema }), controller.createRule);
  router.patch("/admin/commission-rules/:id/end", authenticate, requireRoles("admin"), limit, requireCsrf, validateRequest({ params: ruleIdSchema, body: ruleEndSchema }), controller.endRule);
  router.get("/vendor/earnings", authenticate, requireRoles("vendor"), controller.earnings);
  router.get("/vendor/ledger", authenticate, requireRoles("vendor"), validateRequest({ query: pageSchema }), controller.ledger);
  router.post("/vendor/payouts", authenticate, requireRoles("vendor"), limit, requireCsrf, idempotencyKey, validateRequest({ body: payoutCreateSchema }), controller.createPayout);
  router.get("/vendor/payouts", authenticate, requireRoles("vendor"), validateRequest({ query: pageSchema }), controller.vendorPayouts);
  router.get("/admin/payouts", authenticate, requireRoles("admin"), validateRequest({ query: pageSchema }), controller.adminPayouts);
  router.post("/admin/payouts/:id/approve", authenticate, requireRoles("admin"), limit, requireCsrf, validateRequest({ params: payoutIdSchema }), controller.approvePayout);
  router.post("/admin/payouts/:id/reject", authenticate, requireRoles("admin"), limit, requireCsrf, validateRequest({ params: payoutIdSchema, body: payoutRejectSchema }), controller.rejectPayout);
  router.post("/admin/payouts/:id/mark-paid", authenticate, requireRoles("admin"), limit, requireCsrf, validateRequest({ params: payoutIdSchema, body: payoutCompleteSchema }), controller.markPayoutPaid);
  return router;
}
