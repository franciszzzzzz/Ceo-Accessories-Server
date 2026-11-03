import { z } from "zod";

export const inventoryListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  lowStockOnly: z.union([
    z.boolean(),
    z.enum(["true", "false"]).transform((value) => value === "true"),
  ]).default(false),
}).strict();

export const inventoryUpdateSchema = z.object({
  quantityOnHand: z.number().int().min(0).max(2_147_483_647).optional(),
  lowStockThreshold: z.number().int().min(0).max(2_147_483_647).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const variantIdSchema = z.object({ variantId: z.string().uuid() }).strict();
export const reservationIdSchema = z.object({ id: z.string().uuid() }).strict();
export const reservationCreateSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
}).strict();

export type InventoryListInput = z.infer<typeof inventoryListSchema>;
export type InventoryUpdateInput = z.infer<typeof inventoryUpdateSchema>;
export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;
