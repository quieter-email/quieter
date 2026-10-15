export const MAILBOX_WORKSPACE_VIEWS = [
  "inbox",
  "labels",
  "all-inboxes",
  "daily-brief",
] as const;

export type MailboxWorkspaceView = (typeof MAILBOX_WORKSPACE_VIEWS)[number];
