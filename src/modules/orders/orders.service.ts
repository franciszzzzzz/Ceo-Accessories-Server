import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";
import type { CheckoutInput } from "./orders.schemas.js";
import * as repository from "./orders.repository.js";
import type { CustomerOrderRecord, VendorSubOrderRecord } from "./orders.repository.js";

export async function checkout(userId: string, idempotencyKey: string, input: CheckoutInput) {
  const normalizedItems = [...input.items].sort((left, right) => left.variantId.localeCompare(right.variantId));
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ shippingAddress: input.shippingAddress, items: normalizedItems }))
    .digest("hex");
  const result = await repository.createCheckoutOrder(userId, idempotencyKey, requestHash, input);
  switch (result.kind) {
    case "ok": return { order: serializeOrder(result.order) };
    case "cart_empty": throw new AppError(422, "UNPROCESSABLE", "The cart is empty.");
    case "cart_changed": throw new AppError(409, "CONFLICT", "The cart changed. Refresh it and retry checkout.");
    case "price_changed": throw new AppError(409, "CONFLICT", "One or more prices changed. Refresh the cart and confirm the updated prices.");
    case "unavailable": throw new AppError(409, "CONFLICT", "A cart item is no longer available.", { variantId: result.variantId });
    case "insufficient_stock": throw new AppError(409, "CONFLICT", "There is not enough available stock for a cart item.", {
      variantId: result.variantId,
      availableQuantity: result.availableQuantity,
    });
    case "idempotency_conflict": throw new AppError(409, "CONFLICT", "This Idempotency-Key was already used for a different checkout request.");
  }
}

export async function listCustomerOrders(userId: string, page: number, limit: number) {
  const result = await repository.listCustomerOrders(userId, page, limit);
  return { items: result.items.map(serializeOrder), total: result.total };
}

export async function getCustomerOrder(userId: string, id: string) {
  const order = await repository.findCustomerOrder(userId, id);
  if (!order) throw new AppError(404, "NOT_FOUND", "Order not found.");
  return serializeOrder(order);
}

export async function cancelCustomerOrder(userId: string, id: string) {
  const result = await repository.cancelCustomerOrder(userId, id);
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Order not found.");
  if (result.kind === "payment_active") throw new AppError(409, "CONFLICT", "An active payment attempt must expire or fail before the order can be cancelled.");
  if (result.kind === "not_cancellable") throw new AppError(409, "CONFLICT", "Only pending-payment orders can be cancelled.");
  return serializeOrder(result.order);
}

export async function listVendorOrders(ownerId: string, page: number, limit: number) {
  const result = await repository.listVendorSubOrders(ownerId, page, limit);
  return { items: result.items.map(serializeVendorSubOrder), total: result.total };
}

export async function getVendorOrder(ownerId: string, id: string) {
  const order = await repository.findVendorSubOrder(ownerId, id);
  if (!order) throw new AppError(404, "NOT_FOUND", "Vendor order not found.");
  return serializeVendorSubOrder(order);
}

function serializeOrder(order: CustomerOrderRecord) {
  return {
    id: order.id,
    status: order.status,
    total: { amount: safeAmount(order.totalAmount), currency: order.currency },
    shippingAddress: order.shippingAddress,
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    subOrders: order.subOrders.map((subOrder) => ({
      id: subOrder.id,
      status: subOrder.status,
      total: { amount: safeAmount(subOrder.totalAmount), currency: subOrder.currency },
      store: { name: subOrder.storeName, slug: subOrder.storeSlug },
      createdAt: subOrder.createdAt,
      items: subOrder.items.map((item) => {
        const { unitPriceAmount, lineTotalAmount, ...snapshot } = item;
        return {
          ...snapshot,
          unitPrice: { amount: unitPriceAmount, currency: item.currency },
          lineTotal: { amount: safeAmount(lineTotalAmount), currency: item.currency },
        };
      }),
    })),
  };
}

function serializeVendorSubOrder(order: VendorSubOrderRecord) {
  return {
    id: order.id,
    status: order.status,
    total: { amount: safeAmount(order.totalAmount), currency: order.currency },
    store: { name: order.storeName, slug: order.storeSlug },
    order: order.order,
    createdAt: order.createdAt,
    items: order.items.map((item) => {
      const { unitPriceAmount, lineTotalAmount, ...snapshot } = item;
      return {
        ...snapshot,
        unitPrice: { amount: unitPriceAmount, currency: item.currency },
        lineTotal: { amount: safeAmount(lineTotalAmount), currency: item.currency },
      };
    }),
  };
}

function safeAmount(amount: bigint): number {
  const value = Number(amount);
  if (!Number.isSafeInteger(value)) throw new AppError(500, "INTERNAL_ERROR", "Stored order amount exceeds the supported API range.");
  return value;
}
