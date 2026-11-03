import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import type { Identity } from "../auth/auth.service.js";
import { inventoryListSchema } from "./inventory.schemas.js";
import * as service from "./inventory.service.js";

function userId(responseLocals: Record<string, unknown>): string {
  return (responseLocals.auth as Identity).id;
}

export const listVendorInventory: RequestHandler = async (request, response) => {
  const query = inventoryListSchema.parse(request.query);
  const result = await service.listVendorInventory(userId(response.locals), query);
  sendSuccess(response, { inventory: result.items }, 200, {
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / query.limit),
  });
};

export const updateVendorInventory: RequestHandler = async (request, response) => {
  const item = await service.updateVendorInventory(userId(response.locals), request.params.variantId as string, request.body);
  sendSuccess(response, { inventory: item });
};

export const listLowStockInventory: RequestHandler = async (request, response) => {
  const query = inventoryListSchema.parse(request.query);
  const result = await service.listLowStockInventory({ page: query.page, limit: query.limit });
  sendSuccess(response, { inventory: result.items }, 200, {
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / query.limit),
  });
};

export const listOwnReservations: RequestHandler = async (_request, response) => {
  const reservations = await service.listOwnReservations(userId(response.locals));
  sendSuccess(response, { reservations });
};

export const createReservation: RequestHandler = async (request, response) => {
  const result = await service.reserveStock(userId(response.locals), request.body);
  sendSuccess(response, { reservation: result.reservation, availableQuantity: result.available }, 201);
};

export const releaseReservation: RequestHandler = async (request, response) => {
  const reservation = await service.releaseReservation(userId(response.locals), request.params.id as string);
  sendSuccess(response, { reservation });
};
