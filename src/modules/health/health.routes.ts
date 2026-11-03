import { Router } from "express";
import { createHealthController } from "./health.controller.js";
import type { HealthChecks } from "./health.types.js";

export function createHealthRouter(checks: HealthChecks): Router {
  const router = Router();
  const controller = createHealthController(checks);

  router.get("/health", controller.health);
  router.get("/ready", controller.ready);

  return router;
}
