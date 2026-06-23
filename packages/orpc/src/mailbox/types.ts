import type { MailboxGrantRole } from "@quieter/database";

export type MailboxGroupMetadata = {
  groupId: string;
  groupKind: "organization";
  groupName: string;
};

export type MailboxListItem = MailboxGroupMetadata & {
  connectionStatus: "connected" | "needs_reconnect";
  displayName: string | null;
  emailAddress: string;
  grantRole: MailboxGrantRole | null;
  gmailAutoLabelEnabled: boolean;
  gmailUsefulDetailsEnabled: boolean;
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  provider: "gmail" | "managed";
};

export type MailboxGroup = {
  id: string;
  kind: "organization";
  mailboxes: MailboxListItem[];
  name: string;
  slug: string | null;
};
