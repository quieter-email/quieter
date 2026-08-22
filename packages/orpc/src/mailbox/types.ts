import type {
  MailboxAccessMode,
  MailboxGrantRole,
  PersistedMailboxProvider,
} from "@quieter/database/schema";
import type { MailboxCapabilities } from "@quieter/mail/data-plane";

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
  accessMode: MailboxAccessMode | null;
  capabilities: MailboxCapabilities;
  connectionStatus: "connected" | "needs_reconnect";
  directGrantRole: MailboxGrantRole | null;
  displayName: string | null;
  divisionGrantRoles: MailboxDivisionGrantSummary[];
  divisionId: string | null;
  divisionName: string | null;
  emailAddress: string;
  grantRole: MailboxGrantRole | null;
  autoLabelEnabled: boolean;
  usefulDetailsEnabled: boolean;
  id: string;
  includeApiSentMessages: boolean;
  signatureHtml?: string | null;
  signatureText?: string | null;
  organizationId: string;
  ownerUserId: string | null;
  provider: "api" | PersistedMailboxProvider;
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
