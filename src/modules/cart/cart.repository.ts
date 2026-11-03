import { Prisma, StockReservationStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";

const serializationRetries = 3;

function cartSelect(now: Date) {
  return {
  items: {
    select: {
      id: true,
      quantity: true,
      quotedPriceAmount: true,
      currency: true,
      updatedAt: true,
      variant: {
        select: {
          id: true,
          sku: true,
          status: true,
          priceAmount: true,
          currency: true,
          product: { select: { id: true, name: true, slug: true, status: true, deletedAt: true } },
          store: { select: { id: true, name: true, slug: true, status: true } },
          inventory: {
            select: {
              quantityOnHand: true,
              reservations: {
                where: { status: StockReservationStatus.active, expiresAt: { gt: now } },
                select: { quantity: true },
              },
            },
          },
        },
      },
    },
  },
  } satisfies Prisma.CartSelect;
}

type CartItemResult = { kind: "saved" } | { kind: "not_found" } | { kind: "unavailable" } | { kind: "insufficient_stock"; availableQuantity: number };

export async function getCart(userId: string) {
  const cart = await prisma.cart.findUnique({ where: { userId }, select: cartSelect(new Date()) });
  const items = (cart?.items ?? []).map((item) => {
    const variant = item.variant;
    const reserved = variant.inventory?.reservations.reduce((total, reservation) => total + reservation.quantity, 0) ?? 0;
    const availableQuantity = Math.max(0, (variant.inventory?.quantityOnHand ?? 0) - reserved);
    const isListingActive = variant.status === "active"
      && variant.product.status === "active"
      && variant.product.deletedAt === null
      && variant.store.status === "active";
    const lineTotalAmount = variant.priceAmount * item.quantity;
    return {
      id: item.id,
      quantity: item.quantity,
      quotedPrice: { amount: item.quotedPriceAmount, currency: item.currency },
      currentPrice: { amount: variant.priceAmount, currency: variant.currency },
      lineTotal: { amount: lineTotalAmount, currency: variant.currency },
      priceChanged: item.quotedPriceAmount !== variant.priceAmount || item.currency !== variant.currency,
      availableQuantity,
      isAvailable: isListingActive && availableQuantity >= item.quantity,
      updatedAt: item.updatedAt,
      variant: {
        id: variant.id,
        sku: variant.sku,
        product: { id: variant.product.id, name: variant.product.name, slug: variant.product.slug },
        store: { id: variant.store.id, name: variant.store.name, slug: variant.store.slug },
      },
    };
  }).sort((left, right) => left.variant.store.name.localeCompare(right.variant.store.name)
    || left.variant.product.name.localeCompare(right.variant.product.name));

  const storeTotals = new Map<string, { store: { id: string; name: string; slug: string }; amount: number }>();
  for (const item of items) {
    const current = storeTotals.get(item.variant.store.id) ?? { store: item.variant.store, amount: 0 };
    current.amount += item.lineTotal.amount;
    storeTotals.set(item.variant.store.id, current);
  }
  const totalAmount = items.reduce((total, item) => total + item.lineTotal.amount, 0);
  return {
    items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    total: { amount: totalAmount, currency: "NGN" },
    storeSubtotals: [...storeTotals.values()].map(({ store, amount }) => ({ store, subtotal: { amount, currency: "NGN" } })),
  };
}

export async function putCartItem(userId: string, variantId: string, quantity: number): Promise<CartItemResult> {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const variant = await transaction.productVariant.findFirst({
      where: {
        id: variantId,
        status: "active",
        product: { is: { status: "active", deletedAt: null, store: { is: { status: "active" } } } },
      },
      select: { id: true, priceAmount: true, currency: true, inventory: { select: { id: true, quantityOnHand: true } } },
    });
    if (!variant?.inventory) return { kind: "unavailable" as const };
    const reservations = await transaction.stockReservation.aggregate({
      where: {
        inventoryId: variant.inventory.id,
        status: StockReservationStatus.active,
        expiresAt: { gt: new Date() },
      },
      _sum: { quantity: true },
    });
    const availableQuantity = Math.max(0, variant.inventory.quantityOnHand - (reservations._sum.quantity ?? 0));
    if (quantity > availableQuantity) return { kind: "insufficient_stock" as const, availableQuantity };

    const cart = await transaction.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    await transaction.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      create: {
        cartId: cart.id,
        variantId,
        quantity,
        quotedPriceAmount: variant.priceAmount,
        currency: variant.currency,
      },
      update: { quantity, quotedPriceAmount: variant.priceAmount, currency: variant.currency },
    });
    return { kind: "saved" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateCartItem(userId: string, id: string, quantity: number): Promise<CartItemResult> {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const item = await transaction.cartItem.findFirst({
      where: { id, cart: { is: { userId } } },
      select: { id: true, variantId: true },
    });
    if (!item) return { kind: "not_found" as const };
    const variant = await transaction.productVariant.findFirst({
      where: {
        id: item.variantId,
        status: "active",
        product: { is: { status: "active", deletedAt: null, store: { is: { status: "active" } } } },
      },
      select: { id: true, priceAmount: true, currency: true, inventory: { select: { id: true, quantityOnHand: true } } },
    });
    if (!variant?.inventory) return { kind: "unavailable" as const };
    const reservations = await transaction.stockReservation.aggregate({
      where: { inventoryId: variant.inventory.id, status: StockReservationStatus.active, expiresAt: { gt: new Date() } },
      _sum: { quantity: true },
    });
    const availableQuantity = Math.max(0, variant.inventory.quantityOnHand - (reservations._sum.quantity ?? 0));
    if (quantity > availableQuantity) return { kind: "insufficient_stock" as const, availableQuantity };
    await transaction.cartItem.update({
      where: { id: item.id },
      data: { quantity, quotedPriceAmount: variant.priceAmount, currency: variant.currency },
    });
    return { kind: "saved" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function removeCartItem(userId: string, id: string): Promise<boolean> {
  const deleted = await prisma.cartItem.deleteMany({ where: { id, cart: { is: { userId } } } });
  return deleted.count === 1;
}

export async function clearCart(userId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cart: { is: { userId } } } });
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
