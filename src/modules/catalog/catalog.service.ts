import { AppError } from "../../shared/errors/app-error.js";
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
  ProductCreateInput,
  ProductUpdateInput,
  VariantCreateInput,
  VariantUpdateInput,
} from "./catalog.schemas.js";
import * as repository from "./catalog.repository.js";

export async function listCategories(includeArchived = false) {
  return toTree(await repository.listCategories(includeArchived));
}

export async function getCategory(slug: string) {
  const category = await repository.findCategoryBySlug(slug);
  if (!category || category.status !== "active") throw new AppError(404, "NOT_FOUND", "Category not found.");
  return category;
}

export async function createCategory(input: CategoryCreateInput) {
  await validateParent(input.parentId ?? null);
  try {
    return await repository.createCategory(input);
  } catch (error) {
    if (error instanceof repository.CatalogConflict) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
}

export async function updateCategory(id: string, input: CategoryUpdateInput) {
  const category = await repository.findCategory(id);
  if (!category) throw new AppError(404, "NOT_FOUND", "Category not found.");
  if (input.parentId !== undefined) {
    await validateParent(input.parentId);
    if (input.parentId && await repository.hasCategoryCycle(id, input.parentId)) {
      throw new AppError(422, "UNPROCESSABLE", "Category hierarchy cannot contain cycles.");
    }
  }
  try {
    return await repository.updateCategory(id, input);
  } catch (error) {
    if (error instanceof repository.CatalogConflict) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
}

export async function archiveCategory(id: string) {
  if (!(await repository.findCategory(id))) throw new AppError(404, "NOT_FOUND", "Category not found.");
  return repository.archiveCategory(id);
}

export async function createProduct(ownerId: string, input: ProductCreateInput) {
  await requireActiveStore(ownerId);
  await validateCategoryIds(input.categoryIds);
  try {
    const product = await repository.createProduct(ownerId, input);
    if (!product) throw new AppError(409, "CONFLICT", "Products can only be created in an active store.");
    return productWithPrices(product);
  } catch (error) {
    if (error instanceof repository.CatalogConflict) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
}

export async function listVendorProducts(ownerId: string, page: number, limit: number) {
  await requireActiveStore(ownerId);
  const result = await repository.listVendorProducts(ownerId, page, limit);
  return { ...result, items: result.items.map(productWithPrices) };
}

export async function getVendorProduct(ownerId: string, id: string) {
  const product = await repository.findVendorProduct(ownerId, id);
  if (!product) throw new AppError(404, "NOT_FOUND", "Product not found.");
  return productWithPrices(product);
}

export async function updateVendorProduct(ownerId: string, id: string, input: ProductUpdateInput) {
  await requireActiveStore(ownerId);
  const current = await repository.findVendorProduct(ownerId, id);
  if (!current) throw new AppError(404, "NOT_FOUND", "Product not found.");
  if (input.categoryIds !== undefined) {
    await validateCategoryIds(input.categoryIds);
    if (current.status === "active" && input.categoryIds.length === 0) {
      throw new AppError(422, "UNPROCESSABLE", "An active product must retain at least one category.");
    }
  }
  const product = await repository.updateVendorProduct(ownerId, id, input);
  if (!product) throw new AppError(409, "CONFLICT", "The product could not be updated in its current state.");
  return productWithPrices(product);
}

export async function publishProduct(ownerId: string, id: string) {
  const result = await repository.publishProduct(ownerId, id);
  if (!result) throw new AppError(404, "NOT_FOUND", "Product not found in an active store.");
  if ("conflict" in result) throw new AppError(409, "CONFLICT", "Only draft products can be published.");
  if ("incomplete" in result) {
    throw new AppError(422, "UNPROCESSABLE", "A product needs at least one active category and one active variant before publication.");
  }
  if (!result.product) throw new AppError(500, "INTERNAL_ERROR", "The product could not be published.");
  return productWithPrices(result.product);
}

export async function archiveProduct(ownerId: string, id: string) {
  const product = await repository.archiveProduct(ownerId, id);
  if (!product) throw new AppError(404, "NOT_FOUND", "Product not found.");
  return productWithPrices(product);
}

export async function createVariant(ownerId: string, productId: string, input: VariantCreateInput) {
  await requireActiveStore(ownerId);
  try {
    const variant = await repository.createVariant(ownerId, productId, input);
    if (!variant) throw new AppError(404, "NOT_FOUND", "Product not found in an active store.");
    return variantWithPrice(variant);
  } catch (error) {
    if (error instanceof repository.CatalogConflict) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
}

export async function updateVariant(ownerId: string, productId: string, variantId: string, input: VariantUpdateInput) {
  await requireActiveStore(ownerId);
  try {
    const variant = await repository.updateVariant(ownerId, productId, variantId, input);
    if (!variant) throw new AppError(404, "NOT_FOUND", "Variant not found in this store product.");
    return variantWithPrice(variant);
  } catch (error) {
    if (error instanceof repository.CatalogConflict) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
}

export async function archiveVariant(ownerId: string, productId: string, variantId: string) {
  try {
    const variant = await repository.archiveVariant(ownerId, productId, variantId);
    if (!variant) throw new AppError(404, "NOT_FOUND", "Variant not found in this store product.");
    return variantWithPrice(variant);
  } catch (error) {
    if (error instanceof repository.CatalogConflict) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
}

export async function searchPublicProducts(input: {
  page: number;
  limit: number;
  q?: string;
  category?: string;
  sort: "newest" | "name_asc" | "name_desc";
}) {
  const result = await repository.searchPublicProducts(input);
  return { ...result, items: result.items.map(productWithPrices) };
}

export async function getPublicProduct(storeSlug: string, productSlug: string) {
  const product = await repository.findPublicProduct(storeSlug, productSlug);
  if (!product) throw new AppError(404, "NOT_FOUND", "Product not found.");
  return productWithPrices(product);
}

async function validateParent(parentId: string | null): Promise<void> {
  if (!parentId) return;
  const parent = await repository.findCategory(parentId);
  if (!parent || parent.status !== "active") throw new AppError(404, "NOT_FOUND", "Active parent category not found.");
}

async function validateCategoryIds(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length) throw new AppError(400, "VALIDATION_ERROR", "Category IDs must be unique.");
  if ((await repository.findActiveCategoryIds(uniqueIds)).length !== uniqueIds.length) {
    throw new AppError(422, "UNPROCESSABLE", "All assigned categories must exist and be active.");
  }
}

async function requireActiveStore(ownerId: string): Promise<void> {
  const store = await repository.findVendorStore(ownerId);
  if (!store) throw new AppError(404, "NOT_FOUND", "Store not found.");
  if (store.status !== "active") throw new AppError(409, "CONFLICT", "Catalog changes require an active store.");
}

interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  children: CategoryNode[];
}

function toTree(categories: Awaited<ReturnType<typeof repository.listCategories>>): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const category of categories) nodes.set(category.id, { ...category, children: [] });
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function variantWithPrice<T extends { priceAmount: number; currency: string }>(variant: T) {
  const { priceAmount, currency, ...details } = variant;
  return { ...details, price: { amount: priceAmount, currency } };
}

function productWithPrices<T extends { variants: Array<{ priceAmount: number; currency: string }> }>(product: T) {
  return { ...product, variants: product.variants.map(variantWithPrice) };
}
