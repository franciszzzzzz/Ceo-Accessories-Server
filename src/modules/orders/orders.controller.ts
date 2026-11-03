import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import type { Identity } from "../auth/auth.service.js";
import { orderListSchema } from "./orders.schemas.js";
import * as service from "./orders.service.js";

function userId(responseLocals: Record<string, unknown>): string {
  return (responseLocals.auth as Identity).id;
}

export const checkout: RequestHandler = async (request, response) => {
  const result = await service.checkout(userId(response.locals), response.locals.idempotencyKey as string, request.body);
  sendSuccess(response, result, 201);
};

export const listCustomerOrders: RequestHandler = async (request, response) => {
  const query = orderListSchema.parse(request.query);
  const result = await service.listCustomerOrders(userId(response.locals), query.page, query.limit);
  sendSuccess(response, { orders: result.items }, 200, {
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / query.limit),
  });
};

export const getCustomerOrder: RequestHandler = async (request, response) => {
  const order = await service.getCustomerOrder(userId(response.locals), request.params.id as string);
  sendSuccess(response, { order });
};

export const cancelCustomerOrder: RequestHandler = async (request, response) => {
  const order = await service.cancelCustomerOrder(userId(response.locals), request.params.id as string);
  sendSuccess(response, { order });
};

export const listVendorOrders: RequestHandler = async (request, response) => {
  const query = orderListSchema.parse(request.query);
  const result = await service.listVendorOrders(userId(response.locals), query.page, query.limit);
  sendSuccess(response, { orders: result.items }, 200, {
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / query.limit),
  });
};

export const getVendorOrder: RequestHandler = async (request, response) => {
  const order = await service.getVendorOrder(userId(response.locals), request.params.id as string);
  sendSuccess(response, { order });
};
