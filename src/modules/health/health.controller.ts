import type { RequestHandler } from "express";
import { ServiceUnavailableError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/envelopes.js";
import { getReadiness } from "./health.service.js";
import type { HealthChecks } from "./health.types.js";

export function createHealthController(checks: HealthChecks): {
  health: RequestHandler;
  ready: RequestHandler;
} {
  return {
    health: (_request, response) => {
      sendSuccess(response, {
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    },
    ready: async (_request, response, next) => {
      const readiness = await getReadiness(checks);
      if (!readiness.ready) {
        next(new ServiceUnavailableError({ status: "not_ready", checks: readiness.checks }));
        return;
      }
      sendSuccess(response, { status: "ready", checks: readiness.checks });
    },
  };
}
