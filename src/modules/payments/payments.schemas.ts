import { z } from "zod";

export const paymentIdSchema = z.object({ id: z.string().uuid() }).strict();
export const paymentReferenceSchema = z.object({
  reference: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export const idempotencyHeaderSchema = z.object({
  key: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export const refundCreateSchema = z.object({
  amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  reason: z.string().trim().min(10).max(500),
}).strict();

export const paystackWebhookSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.object({
    id: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
    reference: z.string().min(1).max(128).optional(),
    transaction_reference: z.string().min(1).max(128).optional(),
    refund_reference: z.union([z.string().min(1), z.number().int().nonnegative()]).nullable().optional(),
    amount: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
    status: z.string().max(100).optional(),
  }).passthrough(),
}).passthrough();

export type RefundCreateInput = z.infer<typeof refundCreateSchema>;
export type PaystackWebhookInput = z.infer<typeof paystackWebhookSchema>;
