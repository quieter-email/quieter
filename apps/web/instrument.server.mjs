import * as Sentry from "@sentry/tanstackstart-react";

const isSentryEnabled = process.env.NODE_ENV !== "development" && !!process.env.SENTRY_DSN;

if (isSentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enableLogs: false,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.QUIETER_DEPLOYMENT_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}
