import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
  ProductCreateInput,
  ProductUpdateInput,
  VariantCreateInput,
  VariantUpdateInput,
} from "./catalog.schemas.js";

const categorySelect = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  description: true,
  sortOrder: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

const vendorProductSelect = {
  id: true,
  storeId: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  categories: { select: categorySelect },
  variants: { orderBy: { sku: "asc" }, select: variantSelect() },
} satisfies Prisma.ProductSelect;

function variantSelect() {
  return {
    id: true,
    productId: true,
    sku: true,
    options: true,
    priceAmount: true,
    currency: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.ProductVariantSelect;
}

const publicProductSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  createdAt: true,
  store: { select: { name: true, slug: true } },
  categories: { where: { status: "active" }, select: { id: true, name: true, slug: true } },
  variants: {
    where: { status: "active" },
    orderBy: { sku: "asc" },
    select: { sku: true, options: true, priceAmount: true, currency: true },
  },
} satisfies Prisma.ProductSelect;

export class CatalogConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogConflict";
  }
}

export async function findCategory(id: string) {
  return prisma.category.findUnique({ where: { id }, select: categorySelect });
}

export async function findCategoryBySlug(slug: string) {
  return prisma.category.findUnique({ where: { slug }, select: categorySelect });
}

export async function listCategories(includeArchived: boolean) {
  return prisma.category.findMany({
    where: includeArchived ? {} : { status: "active" },
    select: categorySelect,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

export async function hasCategoryCycle(categoryId: string, proposedParentId: string): Promise<boolean> {
  let currentId: string | null = proposedParentId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === categoryId || visited.has(currentId)) return true;
    visited.add(currentId);
    const current: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = current?.parentId ?? null;
  }
  return false;
}

export async function createCategory(input: CategoryCreateInput) {
  try {
    return await prisma.category.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder,
      },
      select: categorySelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new CatalogConflict("A category with this slug already exists.");
    throw error;
  }
}

export async function updateCategory(id: string, input: CategoryUpdateInput) {
  const data: Prisma.CategoryUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.description !== undefined) data.description = input.description;
  if (input.parentId !== undefined) data.parent = input.parentId
    ? { connect: { id: input.parentId } }
    : { disconnect: true };
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  try {
    return await prisma.category.update({ where: { id }, data, select: categorySelect });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new CatalogConflict("A category with this slug already exists.");
    throw error;
  }
}

export async function archiveCategory(id: string) {
  return prisma.category.update({ where: { id }, data: { status: "archived" }, select: categorySelect });
}

export async function findActiveCategoryIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const categories = await prisma.category.findMany({
    where: { id: { in: ids }, status: "active" },
    select: { id: true },
  });
  return categories.map(({ id }) => id);
}

export async function findVendorStore(ownerId: string) {
  return prisma.store.findUnique({ where: { ownerId }, select: { id: true, status: true } });
}

export async function createProduct(ownerId: string, input: ProductCreateInput) {
  const store = await findVendorStore(ownerId);
  if (!store || store.status !== "active") return null;
  const id = randomUUID();
  const base = slugify(input.name);
  try {
    const slug = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.product.findUnique({
        where: { storeId_slug: { storeId: store.id, slug: base } },
        select: { id: true },
      });
      if (!existing) return base;
      const suffixSlug = `${base.slice(0, 160)}-${id.replaceAll("-", "").slice(0, 10)}`;
      const collision = await transaction.product.findUnique({
        where: { storeId_slug: { storeId: store.id, slug: suffixSlug } },
        select: { id: true },
      });
      if (collision) throw new CatalogConflict("A unique product slug could not be generated.");
      return suffixSlug;
    });
    return await prisma.product.create({
      data: {
        id,
        storeId: store.id,
        name: input.name,
        slug,
        description: input.description,
        categories: { connect: input.categoryIds.map((categoryId) => ({ id: categoryId })) },
      },
      select: vendorProductSelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new CatalogConflict("A product with this slug already exists in the store.");
    throw error;
  }
}

export async function listVendorProducts(ownerId: string, page: number, limit: number) {
  const where: Prisma.ProductWhereInput = { store: { is: { ownerId } }, deletedAt: null };
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: vendorProductSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);
  return { items, total };
}

export async function findVendorProduct(ownerId: string, id: string) {
  return prisma.product.findFirst({
    where: { id, deletedAt: null, store: { is: { ownerId } } },
    select: vendorProductSelect,
  });
}

export async function updateVendorProduct(ownerId: string, id: string, input: ProductUpdateInput) {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, store: { is: { ownerId } } },
    select: { id: true, storeId: true, status: true },
  });
  if (!product || product.status === "archived") return null;
  const data: Prisma.ProductUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.categoryIds !== undefined) data.categories = { set: input.categoryIds.map((categoryId) => ({ id: categoryId })) };
  await prisma.product.update({ where: { id }, data });
  return findVendorProduct(ownerId, id);
}

export async function publishProduct(ownerId: string, id: string) {
  return prisma.$transaction(async (transaction) => {
    const product = await transaction.product.findFirst({
      where: { id, deletedAt: null, store: { is: { ownerId, status: "active" } } },
      select: {
        id: true,
        storeId: true,
        status: true,
        categories: { where: { status: "active" }, select: { id: true } },
        variants: { where: { status: "active" }, select: { id: true }, take: 1 },
      },
    });
    if (!product) return null;
    if (product.status !== "draft") return { conflict: true as const };
    if (product.categories.length === 0 || product.variants.length === 0) return { incomplete: true as const };
    const updated = await transaction.product.updateMany({
      where: { id, storeId: product.storeId, status: "draft", deletedAt: null },
      data: { status: "active" },
    });
    if (updated.count !== 1) return { conflict: true as const };
    return { product: await transaction.product.findUnique({ where: { id }, select: vendorProductSelect }) };
  });
}

export async function archiveProduct(ownerId: string, id: string) {
  const updated = await prisma.product.updateMany({
    where: { id, deletedAt: null, store: { is: { ownerId } } },
    data: { status: "archived", deletedAt: new Date() },
  });
  if (updated.count !== 1) return null;
  return findVendorProductIncludingArchived(ownerId, id);
}

export async function createVariant(ownerId: string, productId: string, input: VariantCreateInput) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, status: { not: "archived" }, store: { is: { ownerId, status: "active" } } },
    select: { id: true, storeId: true },
  });
  if (!product) return null;
  try {
    return await prisma.productVariant.create({
      data: {
        productId,
        storeId: product.storeId,
        sku: input.sku,
        options: input.options,
        priceAmount: input.priceAmount,
        currency: input.currency,
        inventory: { create: {} },
      },
      select: variantSelect(),
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new CatalogConflict("A variant with this SKU already exists in the store.");
    throw error;
  }
}

export async function updateVariant(ownerId: string, productId: string, variantId: string, input: VariantUpdateInput) {
  const store = await findVendorStore(ownerId);
  if (!store || store.status !== "active") return null;
  const data: Prisma.ProductVariantUpdateManyMutationInput = {};
  if (input.sku !== undefined) data.sku = input.sku;
  if (input.options !== undefined) data.options = input.options;
  if (input.priceAmount !== undefined) data.priceAmount = input.priceAmount;
  try {
    const updated = await prisma.productVariant.updateMany({
      where: { id: variantId, productId, storeId: store.id, product: { is: { deletedAt: null, status: { not: "archived" } } } },
      data,
    });
    if (updated.count !== 1) return null;
    return prisma.productVariant.findUnique({ where: { id: variantId }, select: variantSelect() });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new CatalogConflict("A variant with this SKU already exists in the store.");
    throw error;
  }
}

export async function archiveVariant(ownerId: string, productId: string, variantId: string) {
  const store = await findVendorStore(ownerId);
  if (!store) return null;
  return prisma.$transaction(async (transaction) => {
    const variant = await transaction.productVariant.findFirst({
      where: { id: variantId, productId, storeId: store.id },
      select: { id: true, status: true, product: { select: { status: true } } },
    });
    if (!variant) return null;
    if (variant.status === "active" && variant.product.status === "active") {
      const activeCount = await transaction.productVariant.count({ where: { productId, status: "active" } });
      if (activeCount <= 1) throw new CatalogConflict("Archive the product before archiving its last active variant.");
    }
    await transaction.productVariant.updateMany({
      where: { id: variantId, productId, storeId: store.id },
      data: { status: "archived" },
    });
    return transaction.productVariant.findUnique({ where: { id: variantId }, select: variantSelect() });
  });
}

export async function searchPublicProducts(input: {
  page: number;
  limit: number;
  q?: string;
  category?: string;
  sort: "newest" | "name_asc" | "name_desc";
}) {
  const where: Prisma.ProductWhereInput = {
    status: "active",
    deletedAt: null,
    store: { is: { status: "active" } },
    variants: { some: { status: "active" } },
    ...(input.q ? { OR: [
      { name: { contains: input.q, mode: "insensitive" } },
      { description: { contains: input.q, mode: "insensitive" } },
    ] } : {}),
    ...(input.category ? { categories: { some: { slug: input.category, status: "active" } } } : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = input.sort === "newest"
    ? [{ createdAt: "desc" }, { id: "desc" }]
    : [{ name: input.sort === "name_asc" ? "asc" : "desc" }, { id: "asc" }];
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: publicProductSelect,
      orderBy,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.product.count({ where }),
  ]);
  return { items, total };
}

export async function findPublicProduct(storeSlug: string, productSlug: string) {
  return prisma.product.findFirst({
    where: {
      slug: productSlug,
      status: "active",
      deletedAt: null,
      store: { is: { slug: storeSlug, status: "active" } },
      variants: { some: { status: "active" } },
    },
    select: publicProductSelect,
  });
}

async function findVendorProductIncludingArchived(ownerId: string, id: string) {
  return prisma.product.findFirst({
    where: { id, store: { is: { ownerId } } },
    select: vendorProductSelect,
  });
}

function slugify(value: string): string {
  const slug = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160).replace(/-+$/g, "");
  return slug || "product";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
