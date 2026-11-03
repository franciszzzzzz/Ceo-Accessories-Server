import { Prisma, RoleName, VendorApplicationStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";
import type { ApplicationInput } from "./vendor.schemas.js";

const applicantSelect = {
  id: true,
  status: true,
  businessName: true,
  storeName: true,
  businessDescription: true,
  contactPhone: true,
  rejectionReason: true,
  reviewedAt: true,
  createdAt: true,
} satisfies Prisma.VendorApplicationSelect;

const adminApplicationSelect = {
  id: true,
  userId: true,
  status: true,
  businessName: true,
  storeName: true,
  businessDescription: true,
  contactPhone: true,
  rejectionReason: true,
  reviewedById: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  applicant: { select: { id: true, email: true } },
  reviewer: { select: { id: true, email: true } },
} satisfies Prisma.VendorApplicationSelect;

const storeSelect = {
  id: true,
  ownerId: true,
  name: true,
  slug: true,
  description: true,
  contactPhone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoreSelect;

export class PendingApplicationConflict extends Error {
  constructor() {
    super("A pending vendor application already exists or has already been reviewed.");
    this.name = "PendingApplicationConflict";
  }
}

export class ActiveStoreSlugError extends Error {
  constructor() {
    super("The store slug is already in use.");
    this.name = "ActiveStoreSlugError";
  }
}

export class StoreSlugLockedError extends Error {
  constructor() {
    super("An active store slug cannot be changed.");
    this.name = "StoreSlugLockedError";
  }
}

export async function findApplicantState(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      roles: { select: { role: { select: { name: true } } } },
      store: { select: { id: true } },
    },
  });
}

export async function createApplication(userId: string, input: ApplicationInput) {
  try {
    return await prisma.vendorApplication.create({
      data: { ...input, businessDescription: input.businessDescription ?? null, userId, openUserId: userId },
      select: applicantSelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new PendingApplicationConflict();
    throw error;
  }
}

export async function listOwnApplications(userId: string) {
  return prisma.vendorApplication.findMany({
    where: { userId },
    select: applicantSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function listApplications(input: {
  page: number;
  limit: number;
  status?: VendorApplicationStatus;
}) {
  const where: Prisma.VendorApplicationWhereInput = input.status ? { status: input.status } : {};
  const [items, total] = await Promise.all([
    prisma.vendorApplication.findMany({
      where,
      select: adminApplicationSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.vendorApplication.count({ where }),
  ]);
  return { items, total };
}

export async function findApplication(id: string) {
  return prisma.vendorApplication.findUnique({ where: { id }, select: adminApplicationSelect });
}

export async function approveApplication(id: string, reviewerId: string) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const application = await transaction.vendorApplication.findUnique({ where: { id } });
      if (!application) return null;
      if (application.status !== VendorApplicationStatus.pending || application.openUserId !== application.userId) {
        throw new PendingApplicationConflict();
      }
      const changed = await transaction.vendorApplication.updateMany({
        where: { id, status: VendorApplicationStatus.pending, openUserId: application.userId },
        data: {
          status: VendorApplicationStatus.approved,
          openUserId: null,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
      });
      if (changed.count !== 1) throw new PendingApplicationConflict();

      const role = await transaction.role.upsert({
        where: { name: RoleName.vendor },
        create: { name: RoleName.vendor },
        update: {},
      });
      await transaction.userRole.upsert({
        where: { userId_roleId: { userId: application.userId, roleId: role.id } },
        create: { userId: application.userId, roleId: role.id },
        update: {},
      });

      const slug = await uniqueStoreSlug(transaction, slugify(application.storeName), application.id);
      const store = await transaction.store.create({
        data: {
          ownerId: application.userId,
          name: application.storeName,
          slug,
          description: application.businessDescription,
          contactPhone: application.contactPhone,
        },
        select: storeSelect,
      });
      const updatedApplication = await transaction.vendorApplication.findUniqueOrThrow({
        where: { id },
        select: adminApplicationSelect,
      });
      return { application: updatedApplication, store };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ActiveStoreSlugError();
    throw error;
  }
}

export async function rejectApplication(id: string, reviewerId: string, reason: string) {
  const updated = await prisma.vendorApplication.updateMany({
    where: { id, status: VendorApplicationStatus.pending, openUserId: { not: null } },
    data: {
      status: VendorApplicationStatus.rejected,
      openUserId: null,
      rejectionReason: reason,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  });
  if (updated.count !== 1) return null;
  return findApplication(id);
}

export async function listPendingStores(input: { page: number; limit: number }) {
  const where = { status: "pending" as const };
  const [items, total] = await Promise.all([
    prisma.store.findMany({
      where,
      select: storeSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.store.count({ where }),
  ]);
  return { items, total };
}

export async function activateStore(id: string) {
  const updated = await prisma.store.updateMany({ where: { id, status: "pending" }, data: { status: "active" } });
  if (updated.count !== 1) return null;
  return prisma.store.findUnique({ where: { id }, select: storeSelect });
}

export async function findStoreByOwner(ownerId: string) {
  return prisma.store.findUnique({ where: { ownerId }, select: storeSelect });
}

export async function updateStore(ownerId: string, data: {
  name?: string;
  slug?: string;
  description?: string | null;
  contactPhone?: string;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const store = await transaction.store.findUnique({ where: { ownerId }, select: { id: true, status: true, slug: true } });
      if (!store) return null;
      if (store.status !== "pending" && data.slug !== undefined && data.slug !== store.slug) {
        throw new StoreSlugLockedError();
      }
      const changed = await transaction.store.updateMany({
        where: { ownerId, status: store.status },
        data: { ...data, updatedAt: new Date() },
      });
      if (changed.count !== 1) return null;
      return transaction.store.findUnique({ where: { id: store.id }, select: storeSelect });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ActiveStoreSlugError();
    throw error;
  }
}

export async function findPublicStore(slug: string) {
  return prisma.store.findFirst({
    where: { slug, status: "active" },
    select: { id: true, name: true, slug: true, description: true, createdAt: true },
  });
}

export async function findStoreById(id: string) {
  return prisma.store.findUnique({ where: { id }, select: storeSelect });
}

async function uniqueStoreSlug(
  transaction: Prisma.TransactionClient,
  base: string,
  applicationId: string,
): Promise<string> {
  const existing = await transaction.store.findUnique({ where: { slug: base }, select: { id: true } });
  if (!existing) return base;
  const suffix = applicationId.replaceAll("-", "").slice(0, 10);
  const candidate = `${base.slice(0, 120)}-${suffix}`;
  const collision = await transaction.store.findUnique({ where: { slug: candidate }, select: { id: true } });
  if (collision) throw new ActiveStoreSlugError();
  return candidate;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return !slug || slug === "me" ? "store" : slug;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
