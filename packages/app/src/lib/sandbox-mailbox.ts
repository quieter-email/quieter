export const DEMO_MAILBOX_ID = "demo:mailbox";
export const LANDING_DEMO_MAILBOX_ID = "landing:mailbox";
export const DEMO_MANAGED_MAILBOX_ID = "demo:managed-mailbox";

export const isGmailSandboxMailboxId = (mailboxId: string) =>
  mailboxId === DEMO_MAILBOX_ID || mailboxId === LANDING_DEMO_MAILBOX_ID;

export const isManagedSandboxMailboxId = (mailboxId: string) =>
  mailboxId === DEMO_MANAGED_MAILBOX_ID;

export const isSandboxMailboxId = (mailboxId: string) =>
  isGmailSandboxMailboxId(mailboxId) || isManagedSandboxMailboxId(mailboxId);
