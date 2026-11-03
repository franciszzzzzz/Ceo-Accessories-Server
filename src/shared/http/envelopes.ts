import type { Response } from "express";

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export function sendSuccess<T>(response: Response, data: T, status = 200, meta?: Record<string, unknown>): void {
  const envelope: SuccessEnvelope<T> = meta ? { success: true, data, meta } : { success: true, data };
  response.status(status).json(envelope);
}

export function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): void {
  const error: ErrorEnvelope["error"] = { code, message, requestId };
  if (details !== undefined) error.details = details;
  response.status(status).json({ success: false, error } satisfies ErrorEnvelope);
}
