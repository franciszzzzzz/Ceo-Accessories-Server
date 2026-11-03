import { Prisma, OrderStatus, StockReservationStatus, SubOrderStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";
import type { CheckoutInput } from "./orders.schemas.js";

const serializationRetries = 3;

const orderSelect = {
  id: true,
  status: true,
  totalAmount: true,
  currency: true,
  shippingAddress: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  subOrders: {
    select: {
      id: true,
      status: true,
      totalAmount: true,
      currency: true,
      storeName: true,
      storeSlug: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          variantId: true,
          productName: true,
          productSlug: true,
          sku: true,
          options: true,
          quantity: true,
          unitPriceAmount: true,
          lineTotalAmount: true,
          currency: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { storeName: "asc" },
  },
} satisfies Prisma.OrderSelect;

const vendorSubOrderSelect = {
  id: true,
  status: true,
  totalAmount: true,
  currency: true,
  storeName: true,
  storeSlug: true,
  createdAt: true,
  order: { select: { id: true, status: true, createdAt: true } },
  items: {
    select: {
      id: true,
      variantId: true,
      productName: true,
      productSlug: true,
      sku: true,
      options: true,
      quantity: true,
      unitPriceAmount: true,
      lineTotalAmount: true,
      currency: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.SubOrderSelect;

type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
export type CustomerOrderRecord = OrderRecord;
export type VendorSubOrderRecord = Prisma.SubOrderGetPayload<{ select: typeof vendorSubOrderSelect }>;
type CheckoutResult = { kind: "ok"; order: OrderRecord } | { kind: "cart_empty" | "cart_changed" | "price_changed" }
  | { kind: "unavailable"; variantId: string }
  | { kind: "insufficient_stock"; variantId: string; availableQuantity: number }
  | { kind: "idempotency_conflict" };

class CheckoutAbort extends Error {
  constructor(readonly result: Extract<CheckoutResult, { kind: "unavailable" | "insufficient_stock" }>) {
    super(result.kind);
    this.name = "CheckoutAbort";
  }
}

export async function createCheckoutOrder(
  userId: string,
  idempotencyKey: string,
  requestHash: string,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const priorOrder = await prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { requestHash: true, ...orderSelect },
  });
  if (priorOrder) {
    if (priorOrder.requestHash !== requestHash) return { kind: "idempotency_conflict" };
    return { kind: "ok", order: priorOrder };
  }

  try {
    return await withSerializableRetry(() => prisma.$transaction(async (transaction): Promise<CheckoutResult> => {
      const existing = await transaction.order.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { requestHash: true, ...orderSelect },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) return { kind: "idempotency_conflict" };
        return { kind: "ok", order: existing };
      }

      const cart = await transaction.cart.findUnique({
        where: { userId },
        select: { id: true, items: { select: { id: true, variantId: true, quantity: true, quotedPriceAmount: true, currency: true } } },
      });
      if (!cart || cart.items.length === 0) return { kind: "cart_empty" };
      const requested = [...input.items].sort((left, right) => left.variantId.localeCompare(right.variantId));
      const cartItems = [...cart.items].sort((left, right) => left.variantId.localeCompare(right.variantId));
      if (requested.length !== cartItems.length || requested.some((item, index) => {
        const current = cartItems[index];
        return !current || current.variantId !== item.variantId || current.quantity !== item.quantity
          || current.quotedPriceAmount !== item.quotedPriceAmount || current.currency !== "NGN";
      })) return { kind: "cart_changed" };

      const variants = await transaction.productVariant.findMany({
        where: { id: { in: requested.map(({ variantId }) => variantId) } },
        select: {
          id: true,
          sku: true,
          options: true,
          status: true,
          priceAmount: true,
          currency: true,
          product: { select: { name: true, slug: true, status: true, deletedAt: true, categories: { select: { id: true } } } },
          store: { select: { id: true, name: true, slug: true, status: true } },
          inventory: { select: { id: true, quantityOnHand: true } },
        },
      });
      const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
      const prepared: Array<{
        variant: (typeof variants)[number];
        quantity: number;
        unitPriceAmount: number;
        lineTotalAmount: bigint;
      }> = [];
      const checkoutTime = new Date();

      for (const item of requested) {
        const variant = variantsById.get(item.variantId);
        if (!variant || !variant.inventory || variant.status !== "active" || variant.product.status !== "active"
          || variant.product.deletedAt !== null || variant.store.status !== "active") {
          return { kind: "unavailable", variantId: item.variantId };
        }
        if (variant.currency !== "NGN" || item.quotedPriceAmount !== variant.priceAmount) return { kind: "price_changed" };
        const held = await transaction.stockReservation.aggregate({
          where: { inventoryId: variant.inventory.id, status: StockReservationStatus.active, expiresAt: { gt: checkoutTime } },
          _sum: { quantity: true },
        });
        const heldByCustomer = await transaction.stockReservation.aggregate({
          where: {
            inventoryId: variant.inventory.id,
            userId,
            status: StockReservationStatus.active,
            expiresAt: { gt: checkoutTime },
          },
          _sum: { quantity: true },
        });
        const availableToCustomer = Math.max(0, variant.inventory.quantityOnHand
          - (held._sum.quantity ?? 0) + (heldByCustomer._sum.quantity ?? 0));
        if (item.quantity > availableToCustomer) {
          return { kind: "insufficient_stock", variantId: item.variantId, availableQuantity: availableToCustomer };
        }
        prepared.push({
          variant,
          quantity: item.quantity,
          unitPriceAmount: variant.priceAmount,
          lineTotalAmount: BigInt(variant.priceAmount) * BigInt(item.quantity),
        });
      }

      const grouped = new Map<string, { storeId: string; storeName: string; storeSlug: string; totalAmount: bigint; items: typeof prepared }>();
      let totalAmount = 0n;
      for (const item of prepared) {
        const storeId = item.variant.store.id;
        const group = grouped.get(storeId) ?? {
          storeId,
          storeName: item.variant.store.name,
          storeSlug: item.variant.store.slug,
          totalAmount: 0n,
          items: [],
        };
        group.totalAmount += item.lineTotalAmount;
        group.items.push(item);
        grouped.set(storeId, group);
        totalAmount += item.lineTotalAmount;
      }

      for (const item of prepared) {
        const inventory = item.variant.inventory;
        if (!inventory) throw new Error("Validated inventory disappeared during checkout.");
        const changed = await transaction.inventoryItem.updateMany({
          where: { id: inventory.id, quantityOnHand: { gte: item.quantity } },
          data: { quantityOnHand: { decrement: item.quantity }, updatedAt: checkoutTime },
        });
        if (changed.count !== 1) {
          const availableQuantity = Math.max(0, inventory.quantityOnHand - item.quantity);
          throw new CheckoutAbort({ kind: "insufficient_stock", variantId: item.variant.id, availableQuantity });
        }
        await transaction.stockReservation.updateMany({
          where: {
            inventoryId: inventory.id,
            userId,
            status: StockReservationStatus.active,
            expiresAt: { gt: checkoutTime },
          },
          data: { status: StockReservationStatus.converted, updatedAt: checkoutTime },
        });
      }

      const order = await transaction.order.create({
        data: {
          userId,
          idempotencyKey,
          requestHash,
          totalAmount,
          currency: "NGN",
          shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
          subOrders: {
            create: [...grouped.values()].map((group) => ({
              storeId: group.storeId,
              storeName: group.storeName,
              storeSlug: group.storeSlug,
              totalAmount: group.totalAmount,
              currency: "NGN",
              status: SubOrderStatus.pending,
              items: {
                create: group.items.map((item) => ({
                  variantId: item.variant.id,
                  productName: item.variant.product.name,
                  productSlug: item.variant.product.slug,
                  sku: item.variant.sku,
                  options: item.variant.options as Prisma.InputJsonValue,
                  categoryIds: item.variant.product.categories.map(({ id }) => id),
                  quantity: item.quantity,
                  unitPriceAmount: item.unitPriceAmount,
                  lineTotalAmount: item.lineTotalAmount,
                  currency: "NGN",
                })),
              },
            })),
          },
        },
        select: orderSelect,
      });
      await transaction.cartItem.deleteMany({ where: { cartId: cart.id } });
      return { kind: "ok", order };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).catch((error: unknown) => {
      if (error instanceof CheckoutAbort) return error.result;
      throw error;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.order.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { requestHash: true, ...orderSelect },
      });
      if (raced) return raced.requestHash === requestHash ? { kind: "ok", order: raced } : { kind: "idempotency_conflict" };
    }
    throw error;
  }
}

export async function listCustomerOrders(userId: string, page: number, limit: number) {
  const where = { userId };
  const items = await prisma.order.findMany({
    where,
    select: orderSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await prisma.order.count({ where });
  return { items, total };
}

export function findCustomerOrder(userId: string, id: string) {
  return prisma.order.findFirst({ where: { id, userId }, select: orderSelect });
}

export async function cancelCustomerOrder(userId: string, id: string) {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        payment: { select: { id: true, attempts: { where: { status: { in: ["initializing", "pending"] } }, select: { id: true, expiresAt: true } } } },
        subOrders: { select: { items: { select: { variantId: true, quantity: true } } } },
      },
    });
    if (!order) return { kind: "not_found" as const };
    if (order.status !== OrderStatus.pending_payment) return { kind: "not_cancellable" as const };
    const now = new Date();
    const activeAttempt = order.payment?.attempts.some(({ expiresAt }) => expiresAt > now) ?? false;
    if (activeAttempt) return { kind: "payment_active" as const };
    if (order.payment) {
      await transaction.paymentAttempt.updateMany({
        where: { paymentId: order.payment.id, status: { in: ["initializing", "pending"] }, expiresAt: { lte: now } },
        data: { status: "expired", updatedAt: now },
      });
      await transaction.payment.updateMany({ where: { id: order.payment.id, status: "pending" }, data: { status: "failed", updatedAt: now } });
    }
    const changed = await transaction.order.updateMany({
      where: { id, userId, status: OrderStatus.pending_payment },
      data: { status: OrderStatus.cancelled, cancelledAt: now },
    });
    if (changed.count !== 1) return { kind: "not_cancellable" as const };
    for (const item of order.subOrders.flatMap(({ items }) => items)) {
      if (!item.variantId) continue;
      await transaction.inventoryItem.updateMany({
        where: { variantId: item.variantId },
        data: { quantityOnHand: { increment: item.quantity }, updatedAt: new Date() },
      });
    }
    await transaction.subOrder.updateMany({
      where: { orderId: id, status: SubOrderStatus.pending },
      data: { status: SubOrderStatus.cancelled, updatedAt: new Date() },
    });
    const cancelled = await transaction.order.findUniqueOrThrow({ where: { id }, select: orderSelect });
    return { kind: "cancelled" as const, order: cancelled };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function listVendorSubOrders(ownerId: string, page: number, limit: number) {
  const where = { store: { is: { ownerId } } };
  const items = await prisma.subOrder.findMany({
    where,
    select: vendorSubOrderSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await prisma.subOrder.count({ where });
  return { items, total };
}

export function findVendorSubOrder(ownerId: string, id: string) {
  return prisma.subOrder.findFirst({ where: { id, store: { is: { ownerId } } }, select: vendorSubOrderSelect });
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2034" || error.code === "P2002");
      if (!retryable || attempt >= serializationRetries - 1) throw error;
    }
  }
}
