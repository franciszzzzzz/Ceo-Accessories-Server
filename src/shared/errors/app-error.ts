export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(details: unknown) {
    super(503, "SERVICE_UNAVAILABLE", "One or more required services are unavailable.", details);
    this.name = "ServiceUnavailableError";
  }
}
