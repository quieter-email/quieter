import type { MailboxGrantRole } from "@quieter/database/schema";

export type MailboxGroupMetadata = {
  groupId: string;
  groupKind: "division" | "organization" | "unassigned";
  groupName: string;
};

export type MailboxDivisionGrantSummary = {
  divisionId: string;
  divisionName: string;
  role: MailboxGrantRole;
};

export type MailboxListItem = MailboxGroupMetadata & {
  connectionStatus: "connected" | "needs_reconnect";
  directGrantRole: MailboxGrantRole | null;
  displayName: string | null;
  divisionGrantRoles: MailboxDivisionGrantSummary[];
  divisionId: string | null;
  divisionName: string | null;
  emailAddress: string;
  grantRole: MailboxGrantRole | null;
  gmailAutoLabelEnabled: boolean;
  gmailUsefulDetailsEnabled: boolean;
  id: string;
  includeApiSentMessages: boolean;
  organizationId: string;
  ownerUserId: string | null;
  provider: "api" | "gmail" | "managed";
  unreadNonSpamCount: number;
};

export type MailboxGroup = {
  id: string;
  kind: "division" | "organization" | "unassigned";
  mailboxes: MailboxListItem[];
  name: string;
  organizationId: string;
  slug: string | null;
};
