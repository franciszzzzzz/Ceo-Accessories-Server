import { Prisma, RoleName } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";

export async function grantAdminRole(email: string): Promise<"granted" | "already_admin" | "not_found"> {
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return "not_found";
    const role = await transaction.role.upsert({ where: { name: RoleName.admin }, create: { name: RoleName.admin }, update: {} });
    const existing = await transaction.userRole.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      select: { userId: true },
    });
    if (existing) return "already_admin";
    await transaction.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return "granted";
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "already_admin";
    throw error;
  });
}
