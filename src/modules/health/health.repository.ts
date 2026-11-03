import { checkRedis } from "../../config/redis.js";
import { prisma } from "../../config/database.js";
import type { HealthChecks } from "./health.types.js";

export const healthRepository: HealthChecks = {
  async database() {
    await prisma.$queryRaw`SELECT 1`;
  },
  redis: checkRedis,
};
