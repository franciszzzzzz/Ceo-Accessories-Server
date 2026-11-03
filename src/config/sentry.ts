import * as Sentry from "@sentry/node";
import { env } from "./env.js";

export function initializeSentry(): void {
  if (!env.sentryDsn) return;

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.extra;
      return event;
    },
  });
}
