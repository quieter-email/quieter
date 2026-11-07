export const MAILBOX_WORKSPACE_VIEWS = [
  "inbox",
  "labels",
  "rules",
  "all-inboxes",
] as const;

export type MailboxWorkspaceView = (typeof MAILBOX_WORKSPACE_VIEWS)[number];
