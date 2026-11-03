import type { Request, RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";
import { AppError } from "../errors/app-error.js";

export interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request, _response, next) => {
    try {
      if (schemas.body) request.body = schemas.body.parse(request.body);
      if (schemas.query) assignParsedQuery(request, schemas.query.parse(request.query));
      if (schemas.params) Object.assign(request.params, schemas.params.parse(request.params));
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.map(String).join("."),
          message: issue.message,
        }));
        next(new AppError(400, "VALIDATION_ERROR", "Request validation failed.", details));
        return;
      }
      next(error);
    }
  };
}

function assignParsedQuery(request: Request, parsed: unknown): void {
  Object.defineProperty(request, "query", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: parsed,
  });
}
