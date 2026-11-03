import { Prisma, StockReservationStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";
import type { InventoryUpdateInput } from "./inventory.schemas.js";

const reservationLifetimeMs = 15 * 60 * 1000;
const serializationRetries = 3;

const inventorySelect = {
  id: true,
  quantityOnHand: true,
  lowStockThreshold: true,
  updatedAt: true,
  variant: {
    select: {
      id: true,
      sku: true,
      status: true,
      product: { select: { id: true, name: true, slug: true, status: true } },
      store: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.InventoryItemSelect;

export class InventoryConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryConflict";
  }
}

export async function listVendorInventory(ownerId: string, input: { page: number; limit: number; lowStockOnly: boolean }) {
  const store = await prisma.store.findUnique({ where: { ownerId }, select: { id: true, status: true } });
  if (!store || store.status !== "active") return null;
  const items = await prisma.inventoryItem.findMany({
    where: { variant: { storeId: store.id, product: { deletedAt: null } } },
    select: inventorySelect,
    orderBy: [{ variant: { product: { name: "asc" } } }, { variant: { sku: "asc" } }],
  });
  return paginateInventory(items, input, await reservedQuantityMap(items.map(({ id }) => id)));
}

export async function updateVendorInventory(ownerId: string, variantId: string, input: InventoryUpdateInput) {
  try {
    return await withSerializableRetry(async () => prisma.$transaction(async (transaction) => {
      const item = await transaction.inventoryItem.findFirst({
        where: { variantId, variant: { store: { is: { ownerId, status: "active" } } } },
        select: { id: true, quantityOnHand: true },
      });
      if (!item) return null;
      const now = new Date();
      const reservations = await transaction.stockReservation.aggregate({
        where: { inventoryId: item.id, status: StockReservationStatus.active, expiresAt: { gt: now } },
        _sum: { quantity: true },
      });
      const reserved = reservations._sum.quantity ?? 0;
      const quantityOnHand = input.quantityOnHand ?? item.quantityOnHand;
      if (quantityOnHand < reserved) throw new InventoryConflict("On-hand quantity cannot be lower than reserved stock.");
      const data: Prisma.InventoryItemUpdateInput = { updatedAt: now };
      if (input.quantityOnHand !== undefined) data.quantityOnHand = input.quantityOnHand;
      if (input.lowStockThreshold !== undefined) data.lowStockThreshold = input.lowStockThreshold;
      await transaction.inventoryItem.update({
        where: { id: item.id },
        data,
      });
      return transaction.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, select: inventorySelect });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
    throw error;
  }
}

export async function listLowStockInventory(input: { page: number; limit: number }) {
  const items = await prisma.inventoryItem.findMany({
    where: {
      variant: {
        status: "active",
        product: { status: "active", deletedAt: null, store: { is: { status: "active" } } },
      },
    },
    select: inventorySelect,
    orderBy: [{ variant: { store: { name: "asc" } } }, { variant: { product: { name: "asc" } } }],
  });
  const reserved = await reservedQuantityMap(items.map(({ id }) => id));
  const lowStock = items.filter((item) => item.quantityOnHand - (reserved.get(item.id) ?? 0) <= item.lowStockThreshold);
  const start = (input.page - 1) * input.limit;
  return { items: lowStock.slice(start, start + input.limit).map((item) => shapeInventory(item, reserved.get(item.id) ?? 0)), total: lowStock.length };
}

export async function reserveStock(userId: string, variantId: string, quantity: number) {
  return withSerializableRetry(async () => prisma.$transaction(async (transaction) => {
    const item = await transaction.inventoryItem.findFirst({
      where: {
        variantId,
        variant: {
          status: "active",
          product: { status: "active", deletedAt: null, store: { is: { status: "active" } } },
        },
      },
      select: { id: true, quantityOnHand: true },
    });
    if (!item) return { kind: "not_found" as const };
    const now = new Date();
    await transaction.stockReservation.updateMany({
      where: { inventoryId: item.id, status: StockReservationStatus.active, expiresAt: { lte: now } },
      data: { status: StockReservationStatus.expired, updatedAt: now },
    });
    const reservations = await transaction.stockReservation.aggregate({
      where: { inventoryId: item.id, status: StockReservationStatus.active, expiresAt: { gt: now } },
      _sum: { quantity: true },
    });
    const available = item.quantityOnHand - (reservations._sum.quantity ?? 0);
    if (quantity > available) return { kind: "insufficient_stock" as const, available };
    const reservation = await transaction.stockReservation.create({
      data: { userId, inventoryId: item.id, quantity, expiresAt: new Date(now.getTime() + reservationLifetimeMs) },
      select: reservationSelect,
    });
    return { kind: "reserved" as const, reservation, available: available - quantity };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function listOwnReservations(userId: string) {
  const now = new Date();
  return prisma.stockReservation.findMany({
    where: { userId, status: StockReservationStatus.active, expiresAt: { gt: now } },
    select: reservationSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function releaseReservation(userId: string, id: string) {
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    const changed = await transaction.stockReservation.updateMany({
      where: { id, userId, status: StockReservationStatus.active, expiresAt: { gt: now } },
      data: { status: StockReservationStatus.released, releasedAt: now, updatedAt: now },
    });
    if (changed.count !== 1) return null;
    return transaction.stockReservation.findUnique({ where: { id }, select: reservationSelect });
  });
}

export async function findOwnReservationState(userId: string, id: string) {
  return prisma.stockReservation.findFirst({ where: { id, userId }, select: { id: true } });
}

const reservationSelect = {
  id: true,
  quantity: true,
  status: true,
  expiresAt: true,
  releasedAt: true,
  createdAt: true,
  inventory: {
    select: {
      variant: {
        select: {
          id: true,
          sku: true,
          product: { select: { id: true, name: true, slug: true } },
          store: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  },
} satisfies Prisma.StockReservationSelect;

async function reservedQuantityMap(inventoryIds: string[]): Promise<Map<string, number>> {
  if (inventoryIds.length === 0) return new Map();
  const grouped = await prisma.stockReservation.groupBy({
    by: ["inventoryId"],
    where: { inventoryId: { in: inventoryIds }, status: StockReservationStatus.active, expiresAt: { gt: new Date() } },
    _sum: { quantity: true },
  });
  return new Map(grouped.map((entry) => [entry.inventoryId, entry._sum.quantity ?? 0]));
}

function paginateInventory<T extends { id: string; quantityOnHand: number; lowStockThreshold: number; updatedAt: Date; variant: unknown }>(
  items: T[],
  input: { page: number; limit: number; lowStockOnly: boolean },
  reserved: Map<string, number>,
) {
  const filtered = input.lowStockOnly
    ? items.filter((item) => item.quantityOnHand - (reserved.get(item.id) ?? 0) <= item.lowStockThreshold)
    : items;
  const start = (input.page - 1) * input.limit;
  return {
    items: filtered.slice(start, start + input.limit).map((item) => shapeInventory(item, reserved.get(item.id) ?? 0)),
    total: filtered.length,
  };
}

function shapeInventory<T extends { id: string; quantityOnHand: number; lowStockThreshold: number; updatedAt: Date; variant: unknown }>(
  item: T,
  reservedQuantity: number,
) {
  return {
    ...item,
    reservedQuantity,
    availableQuantity: item.quantityOnHand - reservedQuantity,
    isLowStock: item.quantityOnHand - reservedQuantity <= item.lowStockThreshold,
  };
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt >= serializationRetries - 1) throw error;
    }
  }
}
