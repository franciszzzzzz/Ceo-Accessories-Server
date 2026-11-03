import { Prisma, RoleName } from "../../generated/prisma/client.js";
import type { UserStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  roles: RoleName[];
}

export interface RefreshRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export class RefreshReplayError extends Error {
  constructor() {
    super("Refresh token was already rotated");
    this.name = "RefreshReplayError";
  }
}

const userSelect = {
  id: true,
  email: true,
  passwordHash: true,
  status: true,
  roles: { select: { role: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

function asAuthUser(user: Prisma.UserGetPayload<{ select: typeof userSelect }>): AuthUser {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    status: user.status,
    roles: user.roles.map(({ role }) => role.name),
  };
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email }, select: userSelect });
  return user ? asAuthUser(user) : null;
}

export async function findUserById(id: string): Promise<Omit<AuthUser, "passwordHash"> | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!user) return null;
  const identity = asAuthUser(user);
  return { id: identity.id, email: identity.email, status: identity.status, roles: identity.roles };
}

export async function createCustomer(email: string, passwordHash: string): Promise<AuthUser> {
  return prisma.$transaction(async (transaction) => {
    const role = await transaction.role.upsert({
      where: { name: RoleName.customer },
      create: { name: RoleName.customer },
      update: {},
    });
    const user = await transaction.user.create({
      data: { email, passwordHash, roles: { create: { role: { connect: { id: role.id } } } } },
      select: userSelect,
    });
    return asAuthUser(user);
  });
}

export async function createRefreshSession(input: {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.refreshSession.create({ data: input });
}

export async function findRefreshSession(tokenHash: string): Promise<RefreshRecord | null> {
  return prisma.refreshSession.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, familyId: true, expiresAt: true, revokedAt: true },
  });
}

export async function rotateRefreshSession(input: {
  previousId: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const update = await transaction.refreshSession.updateMany({
      where: { id: input.previousId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (update.count !== 1) throw new RefreshReplayError();
    await transaction.refreshSession.create({
      data: {
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  });
}

export async function revokeRefreshSession(id: string): Promise<void> {
  await prisma.refreshSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeRefreshFamily(familyId: string): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function hasActiveRefreshFamily(userId: string, familyId: string): Promise<boolean> {
  return (await prisma.refreshSession.count({
    where: { userId, familyId, revokedAt: null, expiresAt: { gt: new Date() } },
  })) > 0;
}

export async function createPasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.passwordResetToken.updateMany({
    where: { userId: input.userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.passwordResetToken.create({ data: input });
}

export async function completePasswordReset(tokenHash: string, passwordHash: string): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const token = await transaction.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!token || token.usedAt || token.expiresAt <= new Date()) return false;
    const updated = await transaction.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (updated.count !== 1) return false;
    await transaction.user.update({
      where: { id: token.userId },
      data: { passwordHash, passwordUpdatedAt: new Date() },
    });
    await transaction.refreshSession.updateMany({
      where: { userId: token.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return true;
  });
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
