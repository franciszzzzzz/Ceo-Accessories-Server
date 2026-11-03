import { z } from "zod";

const slugSchema = z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const idList = z.array(z.string().uuid()).max(20).refine((ids) => new Set(ids).size === ids.length, "Category IDs must be unique.");

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema.max(140),
  description: z.string().trim().max(1000).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
}).strict();

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: slugSchema.max(140).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const categoryIdSchema = z.object({ id: z.string().uuid() }).strict();
export const categorySlugSchema = z.object({ slug: slugSchema.max(140) }).strict();
export const categoryListSchema = z.object({ includeArchived: z.enum(["true", "false"]).default("false") }).strict();

export const productCreateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().min(1).max(10_000),
  categoryIds: idList.default([]),
}).strict();

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().min(1).max(10_000).optional(),
  categoryIds: idList.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const productIdSchema = z.object({ id: z.string().uuid() }).strict();
export const productParamsSchema = z.object({ productId: z.string().uuid() }).strict();
export const productVariantParamsSchema = z.object({ productId: z.string().uuid(), variantId: z.string().uuid() }).strict();

const optionKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
const optionsSchema = z.record(optionKey, z.string().trim().min(1).max(80)).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 12);

export const variantCreateSchema = z.object({
  sku: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).transform((value) => value.toUpperCase()),
  options: optionsSchema,
  priceAmount: z.number().int().min(1).max(2_147_483_647),
  currency: z.literal("NGN").default("NGN"),
}).strict();

export const variantUpdateSchema = z.object({
  sku: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).transform((value) => value.toUpperCase()).optional(),
  options: optionsSchema.optional(),
  priceAmount: z.number().int().min(1).max(2_147_483_647).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const productListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const publicProductListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(120).optional(),
  category: slugSchema.max(140).optional(),
  sort: z.enum(["newest", "name_asc", "name_desc"]).default("newest"),
}).strict();

export const publicProductParamsSchema = z.object({ storeSlug: slugSchema.max(140), productSlug: slugSchema }).strict();

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type VariantCreateInput = z.infer<typeof variantCreateSchema>;
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>;
