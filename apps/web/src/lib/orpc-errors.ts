import type { MailboxScopeRepairRequiredErrorData } from "@quieter/orpc/errors";

type OrpcErrorLike = {
  code?: unknown;
  data?: unknown;
  status?: unknown;
};

export const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() !== ""
    ? error.message
    : fallback;

export const isMailboxScopeRepairRequiredError = (
  error: unknown
): error is Error & { data: MailboxScopeRepairRequiredErrorData } => {
  if (error === null || error === undefined || typeof error !== "object") {
    return false;
  }

  const candidate = error as OrpcErrorLike;
  if (candidate.code !== "MAILBOX_SCOPE_REPAIR_REQUIRED") {
    return false;
  }

  const { data } = candidate;
  return (
    data !== null &&
    data !== undefined &&
    typeof data === "object" &&
    typeof (data as Partial<MailboxScopeRepairRequiredErrorData>).mailboxId ===
      "string" &&
    typeof (data as Partial<MailboxScopeRepairRequiredErrorData>)
      .emailAddress === "string"
  );
};

/**
 * A blocked recipient is a recipient problem, not a temporary outage, so the
 * composer keeps the draft and points at the recipient fields instead.
 */
export const isSuppressedRecipientError = (error: unknown) => {
  if (error === null || error === undefined || typeof error !== "object") {
    return false;
  }

  const candidate = error as OrpcErrorLike;
  return candidate.code === "UNPROCESSABLE_CONTENT" || candidate.status === 422;
};

export const shouldRetryOrpcError = (failureCount: number, error: unknown) => {
  if (isMailboxScopeRepairRequiredError(error)) {
    return false;
  }
  if (error === null || error === undefined || typeof error !== "object") {
    return failureCount < 1;
  }

  const candidate = error as OrpcErrorLike;
  if (candidate.code === "NOT_FOUND") {
    return false;
  }
  if (typeof candidate.status === "number" && candidate.status < 500) {
    return false;
  }

  return failureCount < 1;
};
