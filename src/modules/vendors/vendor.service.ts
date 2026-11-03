import { VendorApplicationStatus } from "../../generated/prisma/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { ApplicationInput } from "./vendor.schemas.js";
import * as repository from "./vendor.repository.js";

export async function submitApplication(userId: string, input: ApplicationInput) {
  const applicant = await repository.findApplicantState(userId);
  if (!applicant || applicant.status !== "active") {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
  }
  if (!applicant.roles.some(({ role }) => role.name === "customer")) {
    throw new AppError(403, "FORBIDDEN", "Only customer accounts may apply to become vendors.");
  }
  if (applicant.roles.some(({ role }) => role.name === "vendor") || applicant.store) {
    throw new AppError(409, "CONFLICT", "This account already has vendor access or a store.");
  }

  try {
    return await repository.createApplication(userId, input);
  } catch (error) {
    if (error instanceof repository.PendingApplicationConflict) {
      throw new AppError(409, "CONFLICT", "A pending vendor application already exists.");
    }
    throw error;
  }
}

export function listOwnApplications(userId: string) {
  return repository.listOwnApplications(userId);
}

export function listApplications(input: { page: number; limit: number; status?: "pending" | "approved" | "rejected" }) {
  return repository.listApplications({
    ...input,
    ...(input.status ? { status: VendorApplicationStatus[input.status] } : {}),
  });
}

export async function getApplication(id: string) {
  const application = await repository.findApplication(id);
  if (!application) throw new AppError(404, "NOT_FOUND", "Vendor application not found.");
  return application;
}

export async function approveApplication(id: string, reviewerId: string) {
  try {
    const result = await repository.approveApplication(id, reviewerId);
    if (!result) throw new AppError(404, "NOT_FOUND", "Vendor application not found.");
    return result;
  } catch (error) {
    if (error instanceof repository.PendingApplicationConflict) {
      throw new AppError(409, "CONFLICT", "This vendor application is no longer pending.");
    }
    if (error instanceof repository.ActiveStoreSlugError) {
      throw new AppError(409, "CONFLICT", "A unique store slug could not be generated.");
    }
    throw error;
  }
}

export async function rejectApplication(id: string, reviewerId: string, reason: string) {
  const application = await repository.rejectApplication(id, reviewerId, reason);
  if (application) return application;
  if (!(await repository.findApplication(id))) throw new AppError(404, "NOT_FOUND", "Vendor application not found.");
  throw new AppError(409, "CONFLICT", "This vendor application is no longer pending.");
}

export async function listPendingStores(input: { page: number; limit: number }) {
  return repository.listPendingStores(input);
}

export async function activateStore(id: string) {
  const store = await repository.activateStore(id);
  if (store) return store;
  const existing = await repository.findStoreById(id);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Store not found.");
  throw new AppError(409, "CONFLICT", "Only pending stores can be activated.");
}

export async function getOwnStore(ownerId: string) {
  const store = await repository.findStoreByOwner(ownerId);
  if (!store) throw new AppError(404, "NOT_FOUND", "Store not found.");
  return store;
}

export async function updateOwnStore(ownerId: string, input: {
  name?: string;
  slug?: string;
  description?: string | null;
  contactPhone?: string;
}) {
  try {
    const store = await repository.updateStore(ownerId, input);
    if (!store) {
      if (!(await repository.findStoreByOwner(ownerId))) throw new AppError(404, "NOT_FOUND", "Store not found.");
      throw new AppError(409, "CONFLICT", "Store status changed while this update was being saved.");
    }
    return store;
  } catch (error) {
    if (error instanceof repository.ActiveStoreSlugError) {
      throw new AppError(409, "CONFLICT", "The requested store slug is already in use.");
    }
    if (error instanceof repository.StoreSlugLockedError) {
      throw new AppError(409, "CONFLICT", "An active store slug cannot be changed.");
    }
    throw error;
  }
}

export async function getPublicStore(slug: string) {
  const store = await repository.findPublicStore(slug);
  if (!store) throw new AppError(404, "NOT_FOUND", "Store not found.");
  return store;
}
