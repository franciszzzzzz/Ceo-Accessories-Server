import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { initializeSentry } from "./config/sentry.js";

const shutdownTimeoutMs = 10_000;
const startupDependencyTimeoutMs = 2_000;

export async function startServer(): Promise<Server> {
  initializeSentry();
  const { createApp } = await import("./app.js");

  await Promise.all([
    connectWithTimeout("PostgreSQL", connectDatabase),
    connectWithTimeout("Redis", connectRedis),
  ]);

  const app = createApp();
  const server = await new Promise<Server>((resolve, reject) => {
    const httpServer = app.listen(env.port, () => resolve(httpServer));
    httpServer.once("error", reject);
  });

  logger.info({ port: env.port }, "Marketplace API is listening");
  registerShutdownHandlers(server);
  return server;
}

async function connectWithTimeout(name: string, connect: () => Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      connect(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Connection attempt timed out")), startupDependencyTimeoutMs);
      }),
    ]);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    logger.warn({ dependency: name, errorName }, "Dependency is not ready; readiness will report down");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function registerShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");

    void shutdownServer(server);
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export async function shutdownServer(
  server: Server,
  closeRedis: () => Promise<void> = disconnectRedis,
  closeDatabase: () => Promise<void> = disconnectDatabase,
): Promise<void> {
  const timeout = setTimeout(() => {
    logger.error("Graceful shutdown timed out; closing active HTTP connections");
    server.closeAllConnections();
  }, shutdownTimeoutMs);
  timeout.unref();

  try {
    await closeServer(server);
    const failures = await closeDependenciesSequentially(closeRedis, closeDatabase);
    if (failures > 0) {
      logger.error({ failureCount: failures }, "One or more dependencies did not close cleanly");
      process.exitCode = 1;
    } else {
      logger.info("Graceful shutdown complete");
    }
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Graceful shutdown failed");
    await closeDependenciesSequentially(closeRedis, closeDatabase);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

async function closeDependenciesSequentially(
  closeRedis: () => Promise<void>,
  closeDatabase: () => Promise<void>,
): Promise<number> {
  let failures = 0;
  try {
    await closeRedis();
  } catch {
    failures += 1;
  }
  try {
    await closeDatabase();
  } catch {
    failures += 1;
  }
  return failures;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startServer().catch((error: unknown) => {
    logger.fatal({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Server startup failed");
    process.exitCode = 1;
  });
}
