import { z } from "zod";

export const storeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine((value) => value !== "me", "The 'me' slug is reserved.").optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  contactPhone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use an international E.164 phone number.").optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const storeIdSchema = z.object({ id: z.string().uuid() }).strict();
export const storeListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const storeSlugSchema = z.object({
  slug: z.string().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine((value) => value !== "me"),
}).strict();
