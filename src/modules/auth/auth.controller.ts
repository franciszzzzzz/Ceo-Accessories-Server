import { parse } from "cookie";
import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import { authCookieNames, clearAuthCookies, setAuthCookies, setCsrfCookie } from "./auth.cookies.js";
import { AuthService, createCsrfToken } from "./auth.service.js";
import type { Identity } from "./auth.service.js";

const authService = new AuthService();

export const issueCsrf: RequestHandler = (_request, response) => {
  const csrfToken = createCsrfToken();
  setCsrfCookie(response, csrfToken);
  sendSuccess(response, { csrfToken });
};

export const register: RequestHandler = async (request, response) => {
  await authService.register(request.body.email, request.body.password);
  sendSuccess(response, { status: "accepted" }, 202);
};

export const login: RequestHandler = async (request, response) => {
  const tokens = await authService.login(request.body.email, request.body.password);
  setAuthCookies(response, tokens);
  sendSuccess(response, { user: tokens.identity });
};

export const refresh: RequestHandler = async (request, response) => {
  const cookies = parse(request.headers.cookie ?? "");
  const tokens = await authService.refresh(cookies[authCookieNames.refresh]);
  setAuthCookies(response, tokens);
  sendSuccess(response, { user: tokens.identity });
};

export const logout: RequestHandler = async (request, response) => {
  const cookies = parse(request.headers.cookie ?? "");
  await authService.logout(cookies[authCookieNames.refresh]);
  clearAuthCookies(response);
  response.status(204).end();
};

export const currentUser: RequestHandler = (_request, response) => {
  sendSuccess(response, { user: response.locals.auth as Identity });
};

export const requestPasswordReset: RequestHandler = async (request, response) => {
  await authService.requestPasswordReset(request.body.email);
  sendSuccess(response, { status: "accepted" }, 202);
};

export const completePasswordReset: RequestHandler = async (request, response) => {
  await authService.completePasswordReset(request.body.token, request.body.password);
  clearAuthCookies(response);
  sendSuccess(response, { status: "password_updated" });
};
