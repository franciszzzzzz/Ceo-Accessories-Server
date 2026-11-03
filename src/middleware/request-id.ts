import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  const supplied = request.get("X-Request-Id");
  const requestId = supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  next();
};
