import type { MailboxGrantRole } from "#/features/mailbox/components/mailbox-access-pill";

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

export const mailboxGrantRoleOptions = [
  { label: "Reader", value: "reader" },
  { label: "Responder", value: "responder" },
  { label: "Manager", value: "manager" },
] as const;

export const mailboxGrantSelectItems = [
  { label: "No access", value: "none" },
  ...mailboxGrantRoleOptions,
];

export const getProviderLabel = (
  provider: string,
  accessMode?: string | null
) => {
  if (provider === "gmail") {
    return "Gmail";
  }
  if (provider === "managed") {
    return accessMode === "private" ? "Private mailbox" : "Shared inbox";
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
