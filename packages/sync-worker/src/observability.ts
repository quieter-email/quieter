import { serverEnv } from "@quieter/env/server";
import { configureErrorReporter } from "@quieter/observability";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- Installs a synchronous reporting hook.
configureErrorReporter((error, context) => {
  // oxlint-disable-next-line no-console -- Keep failure reporting available when local telemetry is disabled.
  console.error("Mail synchronization failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
    operation: context.operation,
    ...(error instanceof z.ZodError
      ? {
          validation: error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join("."),
          })),
        }
      : {}),
    ...(serverEnv.QUIETER_DEPLOYMENT_ENV === "local" && error instanceof Error
      ? {
          code:
            "code" in error &&
            typeof error.code === "string" &&
            /^[A-Z_0-9]{2,64}$/u.test(error.code)
              ? error.code
              : undefined,
          stack: error.stack
            ?.split("\n")
            .filter((line) => /^\s+at /u.test(line))
            .slice(0, 8)
            .join("\n"),
        }
      : {}),
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
