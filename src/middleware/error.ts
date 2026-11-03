import * as Sentry from "@sentry/node";
import type { ErrorRequestHandler } from "express";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { AppError } from "../shared/errors/app-error.js";
import { sendError } from "../shared/http/envelopes.js";

export function createErrorHandler(isProduction = env.nodeEnv === "production"): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    void next;
    const requestId = String(response.locals.requestId ?? "unknown");

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        logger.error({ code: error.code, requestId }, "Application error");
        Sentry.withScope((scope) => {
          scope.setTag("requestId", requestId);
          Sentry.captureException(error);
        });
      }
      const internalFailure = error.code === "INTERNAL_ERROR";
      const message = isProduction && internalFailure
        ? "An unexpected error occurred."
        : error.message;
      const details = isProduction && internalFailure ? undefined : error.details;
      sendError(response, error.statusCode, error.code, message, requestId, details);
      return;
    }

    const safeError = error instanceof Error ? error : new Error("Unknown error");
    if (isProduction) {
      logger.error({ errorName: safeError.name, requestId }, "Unexpected request error");
    } else {
      logger.error({ err: safeError, requestId }, "Unexpected request error");
    }
    Sentry.withScope((scope) => {
      scope.setTag("requestId", requestId);
      Sentry.captureException(safeError);
    });

    sendError(
      response,
      500,
      "INTERNAL_ERROR",
      isProduction ? "An unexpected error occurred." : safeError.message,
      requestId,
    );
  };
}

export const errorHandler = createErrorHandler();
