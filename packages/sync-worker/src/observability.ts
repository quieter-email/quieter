import { serverEnv } from "@quieter/env/server";
import {
  configureErrorReporter,
  prepareReportedEvent,
} from "@quieter/observability";
import { isGmailRateLimitedError } from "@quieter/sync-server/gmail";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";

const safeErrorNamePattern = /^[A-Za-z][\w.]{0,63}$/u;

// Provider throttling and lease contention are expected and retried by the queue.
export const isExpectedSyncReport = (error: unknown) =>
  (error instanceof Error && error.name === "SyncProviderBusyError") ||
  isGmailRateLimitedError(error);

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- Installs a synchronous reporting hook.
configureErrorReporter((error, context) => {
  if (isExpectedSyncReport(error)) {
    return;
  }
  // oxlint-disable-next-line no-console -- Keep failure reporting available when local telemetry is disabled.
  console.error("Mail synchronization failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
    operation: context.operation,
    ...(serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
    error instanceof z.ZodError
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
    // Exception values are sanitized by beforeSend, so the safe error identity
    // travels as tags instead of the message.
    const tags: Record<string, string> = {
      operation: String(context.operation ?? "mail_sync"),
    };
    if (
      error instanceof Error &&
      error.name !== "Error" &&
      safeErrorNamePattern.test(error.name)
    ) {
      tags.error_type = error.name;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
    ) {
      tags.error_status = String(error.status);
    }
    Sentry.captureException(error, { tags });
  }
});

export const withSyncReporting = <Handler extends ExportedHandler<SyncEnv>>(
  handler: Handler
): Handler =>
  Sentry.withSentry(
    () => ({
      beforeSend(event, hint) {
        const prepared = prepareReportedEvent(event, hint.originalException);
        if (prepared === null) {
          return null;
        }
        for (const exception of prepared.exception?.values ?? []) {
          exception.value = "Mail synchronization failed.";
          for (const frame of exception.stacktrace?.frames ?? []) {
            delete frame.vars;
          }
        }
        return prepared;
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
