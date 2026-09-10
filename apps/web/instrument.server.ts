import { prepareReportedEvent } from "@quieter/observability";
import * as Sentry from "@sentry/tanstackstart-react";

const isSentryEnabled =
  (process.env.NODE_ENV !== "development" ||
    process.env.VITE_QUIETER_LOCAL_TELEMETRY === "true") &&
  (process.env.SENTRY_DSN ?? "") !== "";

if (isSentryEnabled) {
  Sentry.init({
    beforeSend: (event, hint) =>
      prepareReportedEvent(event, hint.originalException),
    dsn: process.env.SENTRY_DSN,
    enableLogs: false,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.QUIETER_DEPLOYMENT_ENV ??
      process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}
