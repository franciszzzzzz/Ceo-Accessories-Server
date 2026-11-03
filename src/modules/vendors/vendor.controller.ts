import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import type { Identity } from "../auth/auth.service.js";
import * as service from "./vendor.service.js";
import { applicationListSchema } from "./vendor.schemas.js";
import { storeListSchema } from "./store.schemas.js";

function identity(responseLocals: Record<string, unknown>): Identity {
  return responseLocals.auth as Identity;
}

export const submitApplication: RequestHandler = async (request, response) => {
  const application = await service.submitApplication(identity(response.locals).id, request.body);
  sendSuccess(response, { application }, 201);
};

export const listOwnApplications: RequestHandler = async (_request, response) => {
  const applications = await service.listOwnApplications(identity(response.locals).id);
  sendSuccess(response, { applications });
};

export const listApplications: RequestHandler = async (request, response) => {
  const { page, limit, status } = applicationListSchema.parse(request.query);
  const result = await service.listApplications({ page, limit, ...(status ? { status } : {}) });
  sendSuccess(response, { applications: result.items }, 200, {
    page,
    limit,
    total: result.total,
    totalPages: Math.ceil(result.total / limit),
  });
};

export const getApplication: RequestHandler = async (request, response) => {
  const application = await service.getApplication(request.params.id as string);
  sendSuccess(response, { application });
};

export const approveApplication: RequestHandler = async (request, response) => {
  const result = await service.approveApplication(request.params.id as string, identity(response.locals).id);
  sendSuccess(response, result);
};

export const rejectApplication: RequestHandler = async (request, response) => {
  const application = await service.rejectApplication(
    request.params.id as string,
    identity(response.locals).id,
    request.body.reason,
  );
  sendSuccess(response, { application });
};

export const listPendingStores: RequestHandler = async (request, response) => {
  const { page, limit } = storeListSchema.parse(request.query);
  const result = await service.listPendingStores({ page, limit });
  sendSuccess(response, { stores: result.items }, 200, {
    page,
    limit,
    total: result.total,
    totalPages: Math.ceil(result.total / limit),
  });
};

export const activateStore: RequestHandler = async (request, response) => {
  const store = await service.activateStore(request.params.id as string);
  sendSuccess(response, { store });
};

export const getOwnStore: RequestHandler = async (_request, response) => {
  const store = await service.getOwnStore(identity(response.locals).id);
  sendSuccess(response, { store });
};

export const updateOwnStore: RequestHandler = async (request, response) => {
  const store = await service.updateOwnStore(identity(response.locals).id, request.body);
  sendSuccess(response, { store });
};

export const getPublicStore: RequestHandler = async (request, response) => {
  const store = await service.getPublicStore(request.params.slug as string);
  sendSuccess(response, { store });
};
