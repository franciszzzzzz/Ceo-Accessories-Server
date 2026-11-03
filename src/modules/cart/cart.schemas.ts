import { z } from "zod";

export const cartItemCreateSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
}).strict();

export const cartItemIdSchema = z.object({ id: z.string().uuid() }).strict();
export const cartItemUpdateSchema = z.object({
  quantity: z.number().int().min(1).max(1000),
}).strict();

export type CartItemCreateInput = z.infer<typeof cartItemCreateSchema>;
export type CartItemUpdateInput = z.infer<typeof cartItemUpdateSchema>;
