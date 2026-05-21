export const MAILBOX_WORKSPACE_VIEWS = ["inbox", "chat"] as const;

export type MailboxWorkspaceView = (typeof MAILBOX_WORKSPACE_VIEWS)[number];
