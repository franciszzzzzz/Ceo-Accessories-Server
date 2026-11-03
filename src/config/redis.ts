import { createClient } from "redis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const redis = createClient({ url: env.redisUrl });
let connectionErrorReported = false;

redis.on("error", (error: Error) => {
  if (connectionErrorReported) return;
  connectionErrorReported = true;
  logger.warn({ errorName: error.name }, "Redis is unavailable; reconnecting");
});

redis.on("ready", () => {
  connectionErrorReported = false;
});

export async function connectRedis(): Promise<void> {
  if (!redis.isOpen) await redis.connect();
}

export async function checkRedis(): Promise<void> {
  await redis.ping();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.isReady) {
    await redis.quit();
  } else if (redis.isOpen) {
    redis.destroy();
  }
  logger.info("Redis connection closed");
}
