import { serverEnv } from "@quieter/env/server";
import { configureErrorReporter } from "@quieter/observability";
import * as Sentry from "@sentry/cloudflare";

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- Installs a synchronous reporting hook.
configureErrorReporter((error, context) => {
  // oxlint-disable-next-line no-console -- Keep failure reporting available when local telemetry is disabled.
  console.error("Mail synchronization failed", {
    operation: context.operation,
  });
  if (Sentry.getClient() !== undefined) {
    Sentry.captureException(error, {
      tags: { operation: String(context.operation ?? "mail_sync") },
    });
  }
});

export const withSyncReporting = <Handler extends ExportedHandler<SyncEnv>>(
  handler: Handler
): Handler =>
  Sentry.withSentry(
    () => ({
      beforeSend(event) {
        delete event.request;
        delete event.user;
        return event;
      },
      dsn:
        serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
        serverEnv.VITE_QUIETER_LOCAL_TELEMETRY !== true
          ? undefined
          : serverEnv.SENTRY_DSN,
      environment: serverEnv.SENTRY_ENVIRONMENT,
      tracesSampleRate: 0,
    }),
    handler
  );
