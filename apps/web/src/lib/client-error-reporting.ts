const GMAIL_REAUTHORIZATION_MESSAGE = "Google access needs to be reconnected for this mailbox.";
const MAILBOX_SCOPE_REPAIR_REQUIRED = "MAILBOX_SCOPE_REPAIR_REQUIRED";

type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

type SentryEventLike = {
  exception?: {
    values?: Array<{ value?: string }>;
  };
  message?: string;
};

export const isExpectedClientError = (error: unknown): boolean => {
  let current = error;
  const visited = new Set<unknown>();

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as ErrorLike;
    if (
      candidate.code === MAILBOX_SCOPE_REPAIR_REQUIRED ||
      candidate.message === GMAIL_REAUTHORIZATION_MESSAGE
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
};

export const shouldDiscardClientError = (event: SentryEventLike, originalException: unknown) =>
  isExpectedClientError(originalException) ||
  event.message === GMAIL_REAUTHORIZATION_MESSAGE ||
  event.exception?.values?.some(({ value }) => value === GMAIL_REAUTHORIZATION_MESSAGE) === true;
