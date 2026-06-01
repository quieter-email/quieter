import type { MailboxScopeRepairRequiredErrorData } from "@quieter/orpc/errors";

type OrpcErrorLike = {
  code?: unknown;
  data?: unknown;
};

export const isMailboxScopeRepairRequiredError = (
  error: unknown,
): error is Error & { data: MailboxScopeRepairRequiredErrorData } => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as OrpcErrorLike;
  if (candidate.code !== "MAILBOX_SCOPE_REPAIR_REQUIRED") {
    return false;
  }

  const data = candidate.data;
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as Partial<MailboxScopeRepairRequiredErrorData>).mailboxId === "string" &&
    typeof (data as Partial<MailboxScopeRepairRequiredErrorData>).providerAccountId === "string" &&
    typeof (data as Partial<MailboxScopeRepairRequiredErrorData>).emailAddress === "string"
  );
};

export const shouldRetryOrpcError = (failureCount: number, error: unknown) =>
  !isMailboxScopeRepairRequiredError(error) && failureCount < 3;
