import { z } from "zod";

export const applicationSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  storeName: z.string().trim().min(2).max(120),
  businessDescription: z.string().trim().max(1000).optional(),
  contactPhone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use an international E.164 phone number."),
}).strict();

export const rejectionSchema = z.object({
  reason: z.string().trim().min(10).max(500),
}).strict();

export const applicationIdSchema = z.object({ id: z.string().uuid() }).strict();

export const applicationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
}).strict();

export type ApplicationInput = z.infer<typeof applicationSchema>;
