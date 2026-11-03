import { z } from "zod";

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const commissionRuleSchema = z.object({
  storeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  rateBasisPoints: z.number().int().min(0).max(10_000),
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
  effectiveUntil: z.iso.datetime({ offset: true }).optional(),
}).strict().refine((value) => !value.effectiveUntil || !value.effectiveFrom || value.effectiveUntil > value.effectiveFrom, {
  message: "effectiveUntil must be after effectiveFrom.",
  path: ["effectiveUntil"],
});

export const payoutIdSchema = z.object({ id: z.string().uuid() }).strict();
export const ruleIdSchema = z.object({ id: z.string().uuid() }).strict();
export const ruleEndSchema = z.object({ effectiveUntil: z.iso.datetime({ offset: true }) }).strict();
export const payoutCreateSchema = z.object({ amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
export const payoutRejectSchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
export const payoutCompleteSchema = z.object({ externalReference: z.string().trim().min(3).max(160) }).strict();
export const idempotencySchema = z.object({ key: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).strict();

export type CommissionRuleInput = z.infer<typeof commissionRuleSchema>;
