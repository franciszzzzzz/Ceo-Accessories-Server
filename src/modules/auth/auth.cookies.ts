import { serialize } from "cookie";
import type { Response } from "express";
import { env } from "../../config/env.js";
import type { IssuedTokens } from "./auth.service.js";

export const authCookieNames = {
  access: "access_token",
  refresh: "refresh_token",
  csrf: "csrf_token",
} as const;

const secure = env.nodeEnv === "production";

export function setAuthCookies(response: Response, tokens: IssuedTokens): void {
  response.append("Set-Cookie", serialize(authCookieNames.access, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/v1",
    maxAge: 15 * 60,
  }));
  response.append("Set-Cookie", serialize(authCookieNames.refresh, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: 30 * 24 * 60 * 60,
  }));
  setCsrfCookie(response, tokens.csrfToken);
}

export function setCsrfCookie(response: Response, token: string): void {
  response.append("Set-Cookie", serialize(authCookieNames.csrf, token, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/api/v1",
    maxAge: 30 * 24 * 60 * 60,
  }));
}

export function clearAuthCookies(response: Response): void {
  for (const [name, path, httpOnly] of [
    [authCookieNames.access, "/api/v1", true],
    [authCookieNames.refresh, "/api/v1/auth", true],
    [authCookieNames.csrf, "/api/v1", false],
  ] as const) {
    response.append("Set-Cookie", serialize(name, "", {
      httpOnly,
      secure,
      sameSite: "lax",
      path,
      maxAge: 0,
    }));
  }
}
