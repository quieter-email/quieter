import { toast } from "@quieter/ui/toast";
import { cva } from "class-variance-authority";

import type { MailboxGrantRole } from "#/features/mailbox/components/mailbox-access-pill";

export const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const getSettingsReturnTo = (mailboxId = "") => {
  if (mailboxId === "") {
    return "/settings?tab=mailboxes";
  }
  return `/settings?tab=mailboxes&mailboxId=${encodeURIComponent(mailboxId)}`;
};

export const parseMailboxGrantRole = (
  value: string
): MailboxGrantRole | null => {
  if (value === "manager" || value === "reader" || value === "responder") {
    return value;
  }
  return null;
};

export const showMutationError = (fallback: string) => (error: unknown) => {
  toast.error(getMutationErrorMessage(error, fallback));
};

export const mailboxGrantRoleOptions = [
  { label: "Reader", value: "reader" },
  { label: "Responder", value: "responder" },
  { label: "Manager", value: "manager" },
] as const;

export const mailboxGrantSelectItems = [
  { label: "No access", value: "none" },
  ...mailboxGrantRoleOptions,
];

export const switchVariants = cva(
  "h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
);

export const getProviderLabel = (provider: string) => {
  if (provider === "gmail") {
    return "Gmail";
  }
  if (provider === "managed") {
    return "Shared inbox";
  }
  return "Send-only mailbox";
};

export const getMailboxDisplayTitle = (
  displayName: string | null | undefined,
  emailAddress: string
) => {
  const trimmed = displayName?.trim() ?? "";
  if (trimmed !== "") {
    return trimmed;
  }
  return emailAddress;
};

export const hasTrimmedDisplayName = (displayName: string | null | undefined) =>
  (displayName?.trim() ?? "") !== "";

export const runDetached = (task: () => Promise<void>): void => {
  void (async () => {
    try {
      await task();
    } catch {
      /* detached task failures are surfaced by the underlying operation */
    }
  })();
};
