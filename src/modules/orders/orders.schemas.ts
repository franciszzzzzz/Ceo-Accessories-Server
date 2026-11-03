import { z } from "zod";

const checkoutItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
  quotedPriceAmount: z.number().int().min(0).max(2_147_483_647),
}).strict();

export const shippingAddressSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  addressLine1: z.string().trim().min(5).max(240),
  addressLine2: z.string().trim().max(240).optional(),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(120),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z.literal("NG").default("NG"),
}).strict();

export const checkoutSchema = z.object({
  shippingAddress: shippingAddressSchema,
  items: z.array(checkoutItemSchema).min(1).max(100)
    .refine((items) => new Set(items.map(({ variantId }) => variantId)).size === items.length, "Checkout items must not contain duplicate variants."),
}).strict();

export const idempotencyHeaderSchema = z.object({
  key: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export const orderIdSchema = z.object({ id: z.string().uuid() }).strict();
export const orderListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type CheckoutInput = z.infer<typeof checkoutSchema>;
