import { createHmac, timingSafeEqual } from "node:crypto";
import { parse } from "cookie";
import type { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { authCookieNames } from "./auth.cookies.js";
import { AuthService, type Identity } from "./auth.service.js";

const authService = new AuthService();

export const authenticate: RequestHandler = async (request, response, next) => {
  try {
    const cookies = parse(request.headers.cookie ?? "");
    response.locals.auth = await authService.authenticate(cookies[authCookieNames.access]);
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRoles(...allowedRoles: string[]): RequestHandler {
  return (request, response, next) => {
    const identity = response.locals.auth as Identity | undefined;
    if (!identity) {
      next(new AppError(401, "UNAUTHENTICATED", "Authentication is required."));
      return;
    }
    if (!identity.roles.some((role) => allowedRoles.includes(role))) {
      next(new AppError(403, "FORBIDDEN", "You are not allowed to perform this action."));
      return;
    }
    next();
  };
}

export const requireCsrf: RequestHandler = (request, _response, next) => {
  const cookies = parse(request.headers.cookie ?? "");
  const cookieToken = cookies[authCookieNames.csrf];
  const headerToken = request.get("X-CSRF-Token");
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken) || !isValidCsrf(cookieToken)) {
    next(new AppError(403, "FORBIDDEN", "A valid CSRF token is required."));
    return;
  }
  next();
};

function isValidCsrf(token: string): boolean {
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const nonce = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", env.csrfSecret).update(nonce).digest("base64url");
  return safeEqual(signature, expected);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
