import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body",
      "res.headers.set-cookie",
      'res.headers["set-cookie"]',
      "password",
      "token",
      "*.password",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
});
