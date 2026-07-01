import { DEMO_MAILBOX_ID, LANDING_DEMO_MAILBOX_ID } from "~/lib/gmail/demo-mail";
import { DEMO_MANAGED_MAILBOX_ID } from "~/lib/managed-mail/demo-managed-mail";

export const isGmailSandboxMailboxId = (mailboxId: string) =>
  mailboxId === DEMO_MAILBOX_ID || mailboxId === LANDING_DEMO_MAILBOX_ID;

export const isManagedSandboxMailboxId = (mailboxId: string) =>
  mailboxId === DEMO_MANAGED_MAILBOX_ID;

export const isSandboxMailboxId = (mailboxId: string) =>
  isGmailSandboxMailboxId(mailboxId) || isManagedSandboxMailboxId(mailboxId);
