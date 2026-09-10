export type ErrorContext = Readonly<
  Record<string, boolean | number | string | undefined>
>;

export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

export type ReportedEvent = {
  breadcrumbs?: unknown;
  contexts?: unknown;
  exception?: { values?: { value?: unknown }[] };
  extra?: unknown;
  message?: unknown;
  request?: unknown;
  transaction?: unknown;
  user?: unknown;
};

let errorReporter: ErrorReporter | null = null;

export const configureErrorReporter = (reporter: ErrorReporter): void => {
  errorReporter = reporter;
};

export const reportError = (
  error: unknown,
  context: ErrorContext = {}
): void => {
  try {
    errorReporter?.(error, context);
  } catch {
    // oxlint-disable-next-line no-console -- Keep the original failure visible without disabling future reports.
    console.error("Error reporting failed", error, context);
  }
};

const databaseQueryMessagePattern = /failed query:/iu;
const databaseQueryMessage = "Database query failed.";
const gmailReauthorizationMessage =
  "Google access needs to be reconnected for this mailbox.";
const mailboxScopeRepairRequired = "MAILBOX_SCOPE_REPAIR_REQUIRED";

const isErrorLike = (
  value: unknown
): value is { cause?: unknown; code?: unknown; message?: unknown } =>
  typeof value === "object" && value !== null;

const isExpectedReportedError = (error: unknown, event: ReportedEvent) => {
  let current: unknown = error;
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

// Database errors embed SQL and parameter values, which can include mailbox
// addresses and message identifiers. Only sanitized failures leave the process.
export const prepareReportedEvent = <Event extends ReportedEvent>(
  event: Event,
  originalException: unknown
): Event | null => {
  if (isExpectedReportedError(originalException, event)) {
    return null;
  }

  delete event.breadcrumbs;
  delete event.contexts;
  delete event.extra;
  delete event.request;
  delete event.transaction;
  delete event.user;

  const reported = event as ReportedEvent;
  if (
    typeof reported.message === "string" &&
    databaseQueryMessagePattern.test(reported.message)
  ) {
    reported.message = databaseQueryMessage;
  }
  for (const exception of reported.exception?.values ?? []) {
    if (
      typeof exception.value === "string" &&
      databaseQueryMessagePattern.test(exception.value)
    ) {
      exception.value = databaseQueryMessage;
    }
  }

  return event;
};
