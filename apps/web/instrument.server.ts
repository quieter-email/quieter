import * as Sentry from "@sentry/tanstackstart-react";

const isSentryEnabled =
  (process.env.NODE_ENV !== "development" ||
    process.env.VITE_QUIETER_LOCAL_TELEMETRY === "true") &&
  (process.env.SENTRY_DSN ?? "") !== "";
const gmailReauthorizationMessage =
  "Google access needs to be reconnected for this mailbox.";
const mailboxScopeRepairRequired = "MAILBOX_SCOPE_REPAIR_REQUIRED";

const isErrorLike = (
  value: unknown
): value is { code?: string; message?: string; cause?: unknown } =>
  typeof value === "object" && value !== null;

const isExpectedServerError = (
  event: Sentry.ErrorEvent,
  originalException: unknown
): boolean => {
  let current: unknown = originalException;
  const visited = new Set<unknown>();

  while (isErrorLike(current) && !visited.has(current)) {
    visited.add(current);
    if (
      current.code === mailboxScopeRepairRequired ||
      current.message === gmailReauthorizationMessage
    ) {
      return true;
    }
    current = current.cause;
  }

  return (
    event.message === gmailReauthorizationMessage ||
    event.exception?.values?.some(
      ({ value }) => value === gmailReauthorizationMessage
    ) === true
  );
};

if (isSentryEnabled) {
  Sentry.init({
    beforeSend: (event, hint) =>
      isExpectedServerError(event, hint.originalException) ? null : event,
    dsn: process.env.SENTRY_DSN,
    enableLogs: false,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.QUIETER_DEPLOYMENT_ENV ??
      process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}
