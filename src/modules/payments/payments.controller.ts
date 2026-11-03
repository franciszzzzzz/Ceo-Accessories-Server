import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import type { Identity } from "../auth/auth.service.js";
import * as service from "./payments.service.js";

function userId(responseLocals: Record<string, unknown>): string {
  return (responseLocals.auth as Identity).id;
}

export const initiatePayment: RequestHandler = async (request, response) => {
  const result = await service.initiatePayment(userId(response.locals), request.params.id as string, response.locals.idempotencyKey as string);
  sendSuccess(response, result, 201);
};

export const getOrderPayment: RequestHandler = async (request, response) => {
  const payment = await service.getCustomerPayment(userId(response.locals), request.params.id as string);
  sendSuccess(response, { payment });
};

export const verifyPayment: RequestHandler = async (request, response) => {
  const payment = await service.verifyCustomerPayment(userId(response.locals), request.body.reference as string);
  sendSuccess(response, { payment });
};

export const paystackWebhook: RequestHandler = async (request, response) => {
  await service.handlePaystackWebhook(request.rawBody ?? Buffer.alloc(0), request.get("x-paystack-signature"), request.body);
  response.status(200).end();
};

export const createRefund: RequestHandler = async (request, response) => {
  const result = await service.createAdminRefund(
    request.params.id as string,
    userId(response.locals),
    response.locals.idempotencyKey as string,
    request.body,
  );
  sendSuccess(response, result, 201);
};

export const listRefunds: RequestHandler = async (request, response) => {
  const result = await service.listAdminRefunds(request.params.id as string);
  sendSuccess(response, result);
};
