import type { HealthChecks, ReadinessResult } from "./health.types.js";

const dependencyCheckTimeoutMs = 1_500;

export async function getReadiness(checks: HealthChecks): Promise<ReadinessResult> {
  const [databaseUp, redisUp] = await Promise.all([
    checkWithTimeout(checks.database, dependencyCheckTimeoutMs),
    checkWithTimeout(checks.redis, dependencyCheckTimeoutMs),
  ]);
  const states = {
    database: databaseUp ? "up" : "down",
    redis: redisUp ? "up" : "down",
  } as const;

  return {
    ready: databaseUp && redisUp,
    checks: states,
  };
}

function checkWithTimeout(check: () => Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    void Promise.resolve().then(check).then(
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
      () => {
        clearTimeout(timeout);
        resolve(false);
      },
    );
  });
}
