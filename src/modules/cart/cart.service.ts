import { AppError } from "../../shared/errors/app-error.js";
import type { CartItemCreateInput, CartItemUpdateInput } from "./cart.schemas.js";
import * as repository from "./cart.repository.js";

export function getCart(userId: string) {
  return repository.getCart(userId);
}

export async function putCartItem(userId: string, input: CartItemCreateInput) {
  const result = await repository.putCartItem(userId, input.variantId, input.quantity);
  if (result.kind === "unavailable") {
    throw new AppError(409, "CONFLICT", "This product variant is not currently available for purchase.");
  }
  if (result.kind === "insufficient_stock") {
    throw new AppError(409, "CONFLICT", "Requested quantity exceeds available stock.", { availableQuantity: result.availableQuantity });
  }
  return repository.getCart(userId);
}

export async function updateCartItem(userId: string, id: string, input: CartItemUpdateInput) {
  const result = await repository.updateCartItem(userId, id, input.quantity);
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Cart item not found.");
  if (result.kind === "unavailable") {
    throw new AppError(409, "CONFLICT", "This product variant is not currently available for purchase.");
  }
  if (result.kind === "insufficient_stock") {
    throw new AppError(409, "CONFLICT", "Requested quantity exceeds available stock.", { availableQuantity: result.availableQuantity });
  }
  return repository.getCart(userId);
}

export async function removeCartItem(userId: string, id: string) {
  if (!(await repository.removeCartItem(userId, id))) throw new AppError(404, "NOT_FOUND", "Cart item not found.");
  return repository.getCart(userId);
}

export async function clearCart(userId: string) {
  await repository.clearCart(userId);
  return repository.getCart(userId);
}
