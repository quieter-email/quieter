import { serverEnv } from "@quieter/env/server";
import { prepareReportedEvent } from "@quieter/observability";
import * as Sentry from "@sentry/tanstackstart-react";

const isSentryEnabled =
  (serverEnv.NODE_ENV !== "development" ||
    serverEnv.VITE_QUIETER_LOCAL_TELEMETRY === true) &&
  (serverEnv.SENTRY_DSN ?? "") !== "";

if (isSentryEnabled) {
  Sentry.init({
    beforeSend: (event, hint) =>
      prepareReportedEvent(event, hint.originalException),
    dsn: serverEnv.SENTRY_DSN,
    enableLogs: false,
    environment:
      serverEnv.SENTRY_ENVIRONMENT ??
      serverEnv.QUIETER_DEPLOYMENT_ENV ??
      serverEnv.NODE_ENV,
    tracesSampleRate: 0,
  });
}
