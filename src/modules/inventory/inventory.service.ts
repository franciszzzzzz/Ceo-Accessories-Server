import { AppError } from "../../shared/errors/app-error.js";
import type { InventoryListInput, InventoryUpdateInput, ReservationCreateInput } from "./inventory.schemas.js";
import * as repository from "./inventory.repository.js";

export async function listVendorInventory(ownerId: string, input: InventoryListInput) {
  const result = await repository.listVendorInventory(ownerId, input);
  if (!result) throw new AppError(403, "FORBIDDEN", "An active store is required to manage inventory.");
  return result;
}

export async function updateVendorInventory(ownerId: string, variantId: string, input: InventoryUpdateInput) {
  try {
    const item = await repository.updateVendorInventory(ownerId, variantId, input);
    if (!item) throw new AppError(404, "NOT_FOUND", "Inventory item not found.");
    return item;
  } catch (error) {
    if (error instanceof repository.InventoryConflict) {
      throw new AppError(409, "CONFLICT", error.message);
    }
    throw error;
  }
}

export async function listLowStockInventory(input: { page: number; limit: number }) {
  return repository.listLowStockInventory(input);
}

export async function listOwnReservations(userId: string) {
  return repository.listOwnReservations(userId);
}

export async function reserveStock(userId: string, input: ReservationCreateInput) {
  const result = await repository.reserveStock(userId, input.variantId, input.quantity);
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Sellable inventory was not found.");
  if (result.kind === "insufficient_stock") {
    throw new AppError(409, "CONFLICT", "There is not enough available stock.", { availableQuantity: result.available });
  }
  return result;
}

export async function releaseReservation(userId: string, id: string) {
  const reservation = await repository.releaseReservation(userId, id);
  if (reservation) return reservation;
  const state = await repository.findOwnReservationState(userId, id);
  if (!state) throw new AppError(404, "NOT_FOUND", "Reservation not found.");
  throw new AppError(409, "CONFLICT", "Only an active, unexpired reservation can be released.");
}
