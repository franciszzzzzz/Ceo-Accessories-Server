import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import type { Identity } from "../auth/auth.service.js";
import { pageSchema } from "./commissions.schemas.js";
import * as service from "./commissions.service.js";

function userId(locals: Record<string, unknown>): string { return (locals.auth as Identity).id; }

export const createRule: RequestHandler = async (request, response) => {
  sendSuccess(response, await service.createRule(userId(response.locals), request.body), 201);
};
export const listRules: RequestHandler = async (request, response) => {
  const query = pageSchema.parse(request.query);
  const result = await service.listRules(query.page, query.limit);
  sendSuccess(response, { rules: result.rules }, 200, { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) });
};
export const endRule: RequestHandler = async (request, response) => {
  sendSuccess(response, await service.endRule(request.params.id as string, request.body.effectiveUntil as string));
};
export const earnings: RequestHandler = async (_request, response) => sendSuccess(response, await service.getEarnings(userId(response.locals)));
export const ledger: RequestHandler = async (request, response) => {
  const query = pageSchema.parse(request.query);
  const result = await service.listLedger(userId(response.locals), query.page, query.limit);
  sendSuccess(response, { entries: result.entries }, 200, { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) });
};
export const createPayout: RequestHandler = async (request, response) => {
  const result = await service.requestPayout(userId(response.locals), request.body.amount as number, response.locals.idempotencyKey as string);
  sendSuccess(response, result, 201);
};
export const vendorPayouts: RequestHandler = async (request, response) => {
  const query = pageSchema.parse(request.query);
  const result = await service.listVendorPayouts(userId(response.locals), query.page, query.limit);
  sendSuccess(response, { payouts: result.payouts }, 200, { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) });
};
export const adminPayouts: RequestHandler = async (request, response) => {
  const query = pageSchema.parse(request.query);
  const result = await service.listAdminPayouts(query.page, query.limit);
  sendSuccess(response, { payouts: result.payouts }, 200, { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) });
};
export const approvePayout: RequestHandler = async (request, response) => {
  sendSuccess(response, await service.transitionPayout(request.params.id as string, userId(response.locals), "approve"));
};
export const rejectPayout: RequestHandler = async (request, response) => {
  sendSuccess(response, await service.transitionPayout(request.params.id as string, userId(response.locals), "reject", request.body.reason as string));
};
export const markPayoutPaid: RequestHandler = async (request, response) => {
  sendSuccess(response, await service.transitionPayout(request.params.id as string, userId(response.locals), "paid", request.body.externalReference as string));
};
