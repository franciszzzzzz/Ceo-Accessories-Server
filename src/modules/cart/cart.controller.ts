import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import type { Identity } from "../auth/auth.service.js";
import * as service from "./cart.service.js";

function userId(responseLocals: Record<string, unknown>): string {
  return (responseLocals.auth as Identity).id;
}

export const getCart: RequestHandler = async (_request, response) => {
  const cart = await service.getCart(userId(response.locals));
  sendSuccess(response, { cart });
};

export const putCartItem: RequestHandler = async (request, response) => {
  const cart = await service.putCartItem(userId(response.locals), request.body);
  sendSuccess(response, { cart });
};

export const updateCartItem: RequestHandler = async (request, response) => {
  const cart = await service.updateCartItem(userId(response.locals), request.params.id as string, request.body);
  sendSuccess(response, { cart });
};

export const removeCartItem: RequestHandler = async (request, response) => {
  const cart = await service.removeCartItem(userId(response.locals), request.params.id as string);
  sendSuccess(response, { cart });
};

export const clearCart: RequestHandler = async (_request, response) => {
  const cart = await service.clearCart(userId(response.locals));
  sendSuccess(response, { cart });
};
