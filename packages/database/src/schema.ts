import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { defineRelations } from "drizzle-orm/relations";

export type MailDomainStatus = "failed" | "pending_dns" | "verified";
export type ConnectorConnectionStatus = "connected" | "needs_reconnect";
export type ConnectorProvider = "google_calendar" | "linear";
export type MailboxConnectionStatus = "connected" | "needs_reconnect";
export type MailboxGrantRole = "manager" | "reader" | "responder";
export type MailboxProvider = "gmail" | "managed";
export type MailboxAccessSource = "direct" | "division";
export type MailboxActionStatus = "needs_attention" | "ready";
export type MailboxActionRevisionValidationStatus = "invalid" | "valid";
export type MailboxActionRunStatus =
  | "failed"
  | "needs_attention"
  | "needs_review"
  | "queued"
  | "running"
  | "skipped"
  | "succeeded";
export type MailboxActionStepStatus =
  | "failed"
  | "needs_review"
  | "queued"
  | "running"
  | "skipped"
  | "succeeded";
export type MailboxActionExternalProvider = "linear";
export type GmailDeliveryStatus =
  | "delayed"
  | "delivered"
  | "in_transit"
  | "ordered"
  | "out_for_delivery"
  | "ready_for_pickup"
  | "shipped"
  | "unknown";
export type GmailUsefulDetailKind =
  | "application"
  | "appointment"
  | "bill"
  | "delivery"
  | "document_expiry"
  | "reservation"
  | "return"
  | "security_alert"
  | "task"
  | "travel"
  | "verification_code";
export type GmailUsefulDetailRelevanceSource = "explicit" | "inferred";
export type GmailUsefulDetailFeedbackSignal = "not_useful" | "useful";
export type MailAutomationAgent = "auto_label" | "useful_detail";
export type MailAutoLabelFeedbackSignal = "added" | "removed";
export type ManagedMailDirection = "inbound" | "outbound";
export type ManagedMailMailboxState = "active" | "draft" | "spam" | "trash";
export type ManagedMailRawObjectProvider = "r2" | "s3";
export type ManagedMailLabelAssignmentSource =
  | "ai_auto_label"
  | "backfill"
  | "inherited"
  | "manual"
  | "rule";
export type ManagedMailRuleBackfillStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "pending"
  | "running";
export type ManagedMailRuleMatchMode = "all" | "any";
export type ManagedMailSavedViewSort = "newest" | "oldest" | "relevance";
export type ManagedMailHeader = {
  name: string;
  value: string;
};
export type OrganizationApiMailHeader = ManagedMailHeader;
export type BillingPlan = "managed" | "pro";
export type BillingProvider = "polar";
export type BillingScope = "team";
export type BillingSubscriptionStatus =
  | "active"
  | "canceled"
  | "expired"
  | "past_due"
  | "pending"
  | "trialing";
export type BillingUsageCategory = "ai" | "mail";
export type OrganizationMailUsageAlertTarget = "included_usage" | "overage_limit";
export type OrganizationMailUsageDirection = "inbound" | "outbound";

export type MailDomainDnsRecord = {
  name: string;
  priority?: number;
  purpose: "dkim" | "dmarc" | "inbound_mx" | "mail_from_mx" | "mail_from_spf" | "ownership";
  required: true;
  type: "CNAME" | "MX" | "TXT";
  value: string;
};

export type MailDomainCheckResult = {
  checks: Array<{
    expected?: string[];
    found?: string[];
    message: string;
    ok: boolean;
    purpose:
      | "dkim"
      | "dmarc"
      | "inbound_mx"
      | "mail_from_mx"
      | "mail_from_spf"
      | "ownership"
      | "receipt_rule"
      | "ses_identity"
      | "ses_mail_from";
  }>;
  checkedAt: string;
};

export type MailboxSwitcherOrder = {
  groupIds: string[];
  mailboxIdsByGroupId: Record<string, string[]>;
};
export type MailboxActionGraph = {
  edges: Array<{
    id: string;
    label?: string;
    source: string;
    sourcePort: string;
    target: string;
    targetPort: string;
  }>;
  nodes: Array<{
    config: Record<string, unknown>;
    id: string;
    position: { x: number; y: number };
    type: string;
  }>;
  version: 1;
};
export type MailboxActionJsonObject = Record<string, unknown>;

export type ChatMessageRole = "system" | "user" | "assistant";
export type ChatMessageStatus = "draft" | "streaming" | "complete" | "failed";
export type ChatRunStatus =
  | "queued"
  | "running"
  | "waiting_on_tool"
  | "complete"
  | "failed"
  | "cancelled";
export type ChatMessagePart = {
  type: string;
  content?: string;
  [key: string]: unknown;
};
export type UserAiContextEventKind =
  | "auto_label_feedback"
  | "chat_discovery"
  | "explicit_preference"
  | "useful_detail_feedback";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  defaultMailboxId: text("defaultMailboxId"),
  mailboxSwitcherOrder: jsonb("mailboxSwitcherOrder").$type<MailboxSwitcherOrder>(),
  termsAcceptedAt: timestamp("termsAcceptedAt"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const userAiContext = pgTable(
  "userAiContext",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    autoLabelModel: text("autoLabelModel").notNull().default("deepseek/deepseek-v4-flash"),
    usefulDetailModel: text("usefulDetailModel").notNull().default("deepseek/deepseek-v4-flash"),
    markdown: text("markdown").notNull(),
    revision: integer("revision").notNull().default(1),
    lastEditedAt: timestamp("lastEditedAt").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check("user_ai_context_markdown_length_check", sql`char_length(${table.markdown}) <= 12000`),
    unique("user_ai_context_user_id_unique").on(table.userId),
  ],
);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    billingOwnerUserId: text("billingOwnerUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [unique("organization_slug_unique").on(table.slug)],
);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  activeOrganizationId: text("activeOrganizationId").references(() => organization.id, {
    onDelete: "set null",
  }),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [unique().on(table.providerId, table.accountId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("publicKey").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credentialID").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull(),
    deviceType: text("deviceType").notNull(),
    backedUp: boolean("backedUp").notNull(),
    transports: text("transports"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_user_id_idx").on(table.userId),
    unique("passkey_credential_id_unique").on(table.credentialID),
  ],
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
    unique("member_organization_id_user_id_unique").on(table.organizationId, table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const organizationDivision = pgTable(
  "organizationDivision",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("organization_division_organization_position_idx").on(
      table.organizationId,
      table.position,
    ),
    unique("organization_division_organization_name_unique").on(
      table.organizationId,
      table.normalizedName,
    ),
  ],
);

export const organizationDivisionMember = pgTable(
  "organizationDivisionMember",
  {
    id: text("id").primaryKey(),
    divisionId: text("divisionId")
      .notNull()
      .references(() => organizationDivision.id, { onDelete: "cascade" }),
    memberId: text("memberId")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("organization_division_member_division_id_idx").on(table.divisionId),
    index("organization_division_member_member_id_idx").on(table.memberId),
    unique("organization_division_member_division_member_unique").on(
      table.divisionId,
      table.memberId,
    ),
  ],
);

export const mailbox = pgTable(
  "mailbox",
  {
    id: text("id").primaryKey(),
    provider: text("provider").$type<MailboxProvider>().notNull(),
    emailAddress: text("emailAddress").notNull(),
    displayName: text("displayName"),
    ownerUserId: text("ownerUserId").references(() => user.id, {
      onDelete: "cascade",
    }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    divisionId: text("divisionId").references(() => organizationDivision.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<MailboxConnectionStatus>().notNull().default("connected"),
    includeApiSentMessages: boolean("includeApiSentMessages").notNull().default(false),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_provider_ownership_check",
      sql`(
        (${table.provider} = 'gmail' and ${table.ownerUserId} is not null)
        or
        (${table.provider} = 'managed' and ${table.ownerUserId} is null and ${table.organizationId} is not null)
      )`,
    ),
    check("mailbox_provider_check", sql`${table.provider} in ('gmail', 'managed')`),
    check("mailbox_status_check", sql`${table.status} in ('connected', 'needs_reconnect')`),
    index("mailbox_owner_user_id_idx").on(table.ownerUserId),
    index("mailbox_organization_id_idx").on(table.organizationId),
    index("mailbox_division_id_idx").on(table.divisionId),
    unique("mailbox_email_address_unique").on(table.emailAddress),
  ],
);

export const userAiContextEvent = pgTable(
  "userAiContextEvent",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").$type<UserAiContextEventKind>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull(),
    mergedAt: timestamp("mergedAt"),
    skippedAt: timestamp("skippedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "user_ai_context_event_kind_check",
      sql`${table.kind} in ('auto_label_feedback', 'chat_discovery', 'explicit_preference', 'useful_detail_feedback')`,
    ),
    index("user_ai_context_event_organization_merge_idx").on(
      table.organizationId,
      table.mergedAt,
      table.skippedAt,
      table.createdAt,
    ),
    index("user_ai_context_event_user_merge_idx").on(table.userId, table.mergedAt, table.createdAt),
    index("user_ai_context_event_mailbox_created_idx").on(table.mailboxId, table.createdAt),
  ],
);

export const gmailCredential = pgTable(
  "gmailCredential",
  {
    mailboxId: text("mailboxId")
      .primaryKey()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    googleSubject: text("googleSubject").notNull(),
    encryptedAccessToken: text("encryptedAccessToken"),
    encryptedRefreshToken: text("encryptedRefreshToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    scopes: text("scopes").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [unique("gmail_credential_google_subject_unique").on(table.googleSubject)],
);

export const connectorCredential = pgTable(
  "connectorCredential",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ConnectorProvider>().notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    providerWorkspaceId: text("providerWorkspaceId"),
    providerWorkspaceName: text("providerWorkspaceName"),
    accountEmail: text("accountEmail"),
    displayName: text("displayName"),
    metadata: jsonb("metadata").$type<MailboxActionJsonObject>(),
    encryptedAccessToken: text("encryptedAccessToken"),
    encryptedRefreshToken: text("encryptedRefreshToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    scopes: text("scopes").notNull(),
    status: text("status").$type<ConnectorConnectionStatus>().notNull().default("connected"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "connector_credential_provider_check",
      sql`${table.provider} in ('google_calendar', 'linear')`,
    ),
    check(
      "connector_credential_status_check",
      sql`${table.status} in ('connected', 'needs_reconnect')`,
    ),
    index("connector_credential_user_id_idx").on(table.userId),
    index("connector_credential_user_provider_idx").on(table.userId, table.provider),
    unique("connector_credential_user_provider_account_unique").on(
      table.userId,
      table.provider,
      table.providerAccountId,
    ),
  ],
);

export const gmailLabel = pgTable(
  "gmailLabel",
  {
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    labelId: text("labelId").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("gray"),
    description: text("description"),
    inclusionCriteria: text("inclusionCriteria"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("gmail_label_mailbox_id_idx").on(table.mailboxId),
    unique("gmail_label_mailbox_id_label_id_unique").on(table.mailboxId, table.labelId),
  ],
);

export const gmailWatchState = pgTable(
  "gmailWatchState",
  {
    mailboxId: text("mailboxId")
      .primaryKey()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    historyId: text("historyId"),
    historyPageToken: text("historyPageToken"),
    watchExpirationAt: timestamp("watchExpirationAt"),
    watchRenewedAt: timestamp("watchRenewedAt"),
    lastNotificationAt: timestamp("lastNotificationAt"),
    lastProcessedAt: timestamp("lastProcessedAt"),
    lastReconciledAt: timestamp("lastReconciledAt"),
    recoveryAfter: timestamp("recoveryAfter"),
    recoveryBefore: timestamp("recoveryBefore"),
    recoveryPageToken: text("recoveryPageToken"),
    processingLeaseId: text("processingLeaseId"),
    processingLeaseExpiresAt: timestamp("processingLeaseExpiresAt"),
    lastError: text("lastError"),
    lastErrorAt: timestamp("lastErrorAt"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("gmail_watch_state_watch_expiration_at_idx").on(table.watchExpirationAt),
    index("gmail_watch_state_processing_lease_expires_at_idx").on(table.processingLeaseExpiresAt),
  ],
);

export const gmailAutoLabelSettings = pgTable("gmailAutoLabelSettings", {
  mailboxId: text("mailboxId")
    .primaryKey()
    .references(() => mailbox.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const gmailAutoLabelEvent = pgTable(
  "gmailAutoLabelEvent",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmailMessageId").notNull(),
    labelIds: jsonb("labelIds").$type<string[]>(),
    model: text("model"),
    costUsd: doublePrecision("costUsd"),
    promptTokens: integer("promptTokens"),
    completionTokens: integer("completionTokens"),
    cachedTokens: integer("cachedTokens"),
    cacheWriteTokens: integer("cacheWriteTokens"),
    attemptCount: integer("attemptCount").notNull().default(0),
    nextAttemptAt: timestamp("nextAttemptAt"),
    appliedAt: timestamp("appliedAt"),
    usageReportedAt: timestamp("usageReportedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("gmail_auto_label_event_mailbox_created_at_idx").on(table.mailboxId, table.createdAt),
    index("gmail_auto_label_event_mailbox_retry_idx").on(
      table.mailboxId,
      table.appliedAt,
      table.nextAttemptAt,
    ),
    unique("gmail_auto_label_event_mailbox_message_unique").on(
      table.mailboxId,
      table.gmailMessageId,
    ),
  ],
);

export const gmailUsefulDetailSettings = pgTable("gmailUsefulDetailSettings", {
  mailboxId: text("mailboxId")
    .primaryKey()
    .references(() => mailbox.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const gmailUsefulDetailEvent = pgTable(
  "gmailUsefulDetailEvent",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmailMessageId").notNull(),
    model: text("model"),
    costUsd: doublePrecision("costUsd"),
    promptTokens: integer("promptTokens"),
    completionTokens: integer("completionTokens"),
    cachedTokens: integer("cachedTokens"),
    cacheWriteTokens: integer("cacheWriteTokens"),
    attemptCount: integer("attemptCount").notNull().default(0),
    nextAttemptAt: timestamp("nextAttemptAt"),
    processedAt: timestamp("processedAt"),
    usageReportedAt: timestamp("usageReportedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("gmail_useful_detail_event_mailbox_created_at_idx").on(table.mailboxId, table.createdAt),
    index("gmail_useful_detail_event_mailbox_retry_idx").on(
      table.mailboxId,
      table.processedAt,
      table.nextAttemptAt,
    ),
    unique("gmail_useful_detail_event_mailbox_message_unique").on(
      table.mailboxId,
      table.gmailMessageId,
    ),
  ],
);

export const gmailUsefulDetail = pgTable(
  "gmailUsefulDetail",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    kind: text("kind").$type<GmailUsefulDetailKind>().notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    gmailMessageId: text("gmailMessageId").notNull(),
    gmailThreadId: text("gmailThreadId"),
    title: text("title").notNull(),
    summary: text("summary"),
    encryptedCode: text("encryptedCode"),
    carrier: text("carrier"),
    trackingNumber: text("trackingNumber"),
    deliveryStatus: text("deliveryStatus").$type<GmailDeliveryStatus>(),
    expectedAt: timestamp("expectedAt"),
    eventAt: timestamp("eventAt"),
    relevantFrom: timestamp("relevantFrom").notNull(),
    relevanceSource: text("relevanceSource").$type<GmailUsefulDetailRelevanceSource>().notNull(),
    reference: text("reference"),
    location: text("location"),
    source: text("source"),
    receivedAt: timestamp("receivedAt").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    dismissedAt: timestamp("dismissedAt"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "gmail_useful_detail_kind_check",
      sql`${table.kind} in ('application', 'appointment', 'bill', 'delivery', 'document_expiry', 'reservation', 'return', 'security_alert', 'task', 'travel', 'verification_code')`,
    ),
    check(
      "gmail_useful_detail_relevance_source_check",
      sql`${table.relevanceSource} in ('explicit', 'inferred')`,
    ),
    check(
      "gmail_useful_detail_delivery_status_check",
      sql`${table.deliveryStatus} is null or ${table.deliveryStatus} in ('delayed', 'delivered', 'in_transit', 'ordered', 'out_for_delivery', 'ready_for_pickup', 'shipped', 'unknown')`,
    ),
    check(
      "gmail_useful_detail_payload_check",
      sql`(
        (${table.kind} = 'verification_code' and ${table.encryptedCode} is not null and ${table.deliveryStatus} is null)
        or
        (${table.kind} = 'delivery' and ${table.encryptedCode} is null and ${table.deliveryStatus} is not null)
        or
        (${table.kind} not in ('delivery', 'verification_code') and ${table.encryptedCode} is null and ${table.deliveryStatus} is null)
      )`,
    ),
    index("gmail_useful_detail_mailbox_active_idx").on(
      table.mailboxId,
      table.dismissedAt,
      table.expiresAt,
    ),
    unique("gmail_useful_detail_mailbox_kind_dedupe_unique").on(
      table.mailboxId,
      table.kind,
      table.dedupeKey,
    ),
  ],
);

export const gmailUsefulDetailFeedback = pgTable(
  "gmailUsefulDetailFeedback",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    detailId: text("detailId").notNull(),
    kind: text("kind").$type<GmailUsefulDetailKind>().notNull(),
    signal: text("signal").$type<GmailUsefulDetailFeedbackSignal>().notNull(),
    source: text("source"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "gmail_useful_detail_feedback_signal_check",
      sql`${table.signal} in ('not_useful', 'useful')`,
    ),
    index("gmail_useful_detail_feedback_profile_idx").on(
      table.mailboxId,
      table.source,
      table.kind,
      table.signal,
    ),
    unique("gmail_useful_detail_feedback_mailbox_detail_unique").on(
      table.mailboxId,
      table.detailId,
    ),
  ],
);

export const mailboxAutomationSettings = pgTable("mailboxAutomationSettings", {
  mailboxId: text("mailboxId")
    .primaryKey()
    .references(() => mailbox.id, { onDelete: "cascade" }),
  autoLabelEnabled: boolean("autoLabelEnabled").notNull().default(false),
  usefulDetailsEnabled: boolean("usefulDetailsEnabled").notNull().default(false),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const mailboxAction = pgTable(
  "mailboxAction",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    status: text("status").$type<MailboxActionStatus>().notNull().default("ready"),
    statusReason: text("statusReason"),
    draftRevisionId: text("draftRevisionId"),
    publishedRevisionId: text("publishedRevisionId"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check("mailbox_action_status_check", sql`${table.status} in ('ready', 'needs_attention')`),
    index("mailbox_action_mailbox_id_idx").on(table.mailboxId),
    index("mailbox_action_organization_id_idx").on(table.organizationId),
    index("mailbox_action_published_enabled_idx").on(
      table.mailboxId,
      table.enabled,
      table.publishedRevisionId,
    ),
  ],
);

export const mailboxActionRevision = pgTable(
  "mailboxActionRevision",
  {
    id: text("id").primaryKey(),
    actionId: text("actionId")
      .notNull()
      .references(() => mailboxAction.id, { onDelete: "cascade" }),
    revisionNumber: integer("revisionNumber").notNull(),
    graph: jsonb("graph").$type<MailboxActionGraph>().notNull(),
    validationStatus: text("validationStatus")
      .$type<MailboxActionRevisionValidationStatus>()
      .notNull()
      .default("invalid"),
    validationErrors: jsonb("validationErrors").$type<string[]>().notNull().default([]),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_action_revision_validation_status_check",
      sql`${table.validationStatus} in ('valid', 'invalid')`,
    ),
    index("mailbox_action_revision_action_id_idx").on(table.actionId),
    unique("mailbox_action_revision_action_number_unique").on(table.actionId, table.revisionNumber),
  ],
);

export const mailboxActionRun = pgTable(
  "mailboxActionRun",
  {
    id: text("id").primaryKey(),
    actionId: text("actionId")
      .notNull()
      .references(() => mailboxAction.id, { onDelete: "cascade" }),
    revisionId: text("revisionId")
      .notNull()
      .references(() => mailboxActionRevision.id, { onDelete: "cascade" }),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    triggerNodeId: text("triggerNodeId").notNull(),
    sourceMessageId: text("sourceMessageId").notNull(),
    sourceThreadId: text("sourceThreadId"),
    dedupeKey: text("dedupeKey").notNull(),
    status: text("status").$type<MailboxActionRunStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    leasedUntil: timestamp("leasedUntil"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_action_run_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_attention', 'needs_review')`,
    ),
    index("mailbox_action_run_action_created_idx").on(table.actionId, table.createdAt),
    index("mailbox_action_run_mailbox_created_idx").on(table.mailboxId, table.createdAt),
    index("mailbox_action_run_status_lease_idx").on(table.status, table.leasedUntil),
    unique("mailbox_action_run_dedupe_key_unique").on(table.dedupeKey),
  ],
);

export const mailboxActionRunFrame = pgTable(
  "mailboxActionRunFrame",
  {
    id: text("id").primaryKey(),
    runId: text("runId")
      .notNull()
      .references(() => mailboxActionRun.id, { onDelete: "cascade" }),
    parentFrameId: text("parentFrameId"),
    status: text("status").$type<MailboxActionRunStatus>().notNull().default("running"),
    path: jsonb("path").$type<string[]>().notNull().default([]),
    variables: jsonb("variables").$type<MailboxActionJsonObject>().notNull().default({}),
    mergeState: jsonb("mergeState").$type<MailboxActionJsonObject>(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_action_run_frame_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_attention', 'needs_review')`,
    ),
    index("mailbox_action_run_frame_run_id_idx").on(table.runId),
  ],
);

export const mailboxActionStepRun = pgTable(
  "mailboxActionStepRun",
  {
    id: text("id").primaryKey(),
    runId: text("runId")
      .notNull()
      .references(() => mailboxActionRun.id, { onDelete: "cascade" }),
    frameId: text("frameId").references(() => mailboxActionRunFrame.id, { onDelete: "set null" }),
    nodeId: text("nodeId").notNull(),
    nodeType: text("nodeType").notNull(),
    status: text("status").$type<MailboxActionStepStatus>().notNull().default("queued"),
    input: jsonb("input").$type<MailboxActionJsonObject>().notNull().default({}),
    output: jsonb("output").$type<MailboxActionJsonObject>(),
    model: text("model"),
    toolCalls: jsonb("toolCalls").$type<Array<MailboxActionJsonObject>>(),
    error: text("error"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_action_step_run_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_review')`,
    ),
    index("mailbox_action_step_run_run_id_idx").on(table.runId),
    index("mailbox_action_step_run_frame_id_idx").on(table.frameId),
  ],
);

export const mailboxActionExternalEffect = pgTable(
  "mailboxActionExternalEffect",
  {
    id: text("id").primaryKey(),
    runId: text("runId")
      .notNull()
      .references(() => mailboxActionRun.id, { onDelete: "cascade" }),
    stepRunId: text("stepRunId").references(() => mailboxActionStepRun.id, {
      onDelete: "set null",
    }),
    actionId: text("actionId")
      .notNull()
      .references(() => mailboxAction.id, { onDelete: "cascade" }),
    revisionId: text("revisionId")
      .notNull()
      .references(() => mailboxActionRevision.id, { onDelete: "cascade" }),
    provider: text("provider").$type<MailboxActionExternalProvider>().notNull(),
    connectorCredentialId: text("connectorCredentialId").references(() => connectorCredential.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotencyKey").notNull(),
    externalId: text("externalId").notNull(),
    externalUrl: text("externalUrl"),
    metadata: jsonb("metadata").$type<MailboxActionJsonObject>(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    check("mailbox_action_external_effect_provider_check", sql`${table.provider} in ('linear')`),
    index("mailbox_action_external_effect_action_created_idx").on(table.actionId, table.createdAt),
    index("mailbox_action_external_effect_run_id_idx").on(table.runId),
    unique("mailbox_action_external_effect_idempotency_unique").on(table.idempotencyKey),
  ],
);

export const mailAutomationMemoryProfile = pgTable(
  "mailAutomationMemoryProfile",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    agent: text("agent").$type<MailAutomationAgent>().notNull(),
    profile: jsonb("profile").$type<unknown>().notNull(),
    revision: integer("revision").notNull().default(1),
    lastMergedAt: timestamp("lastMergedAt").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mail_automation_memory_profile_agent_check",
      sql`${table.agent} in ('auto_label', 'useful_detail')`,
    ),
    index("mail_automation_memory_profile_mailbox_agent_idx").on(table.mailboxId, table.agent),
    unique("mail_automation_memory_profile_mailbox_agent_unique").on(table.mailboxId, table.agent),
  ],
);

export const mailAutoLabelFeedback = pgTable(
  "mailAutoLabelFeedback",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    provider: text("provider").$type<MailboxProvider>().notNull(),
    providerMessageId: text("providerMessageId").notNull(),
    labelId: text("labelId").notNull(),
    labelName: text("labelName"),
    signal: text("signal").$type<MailAutoLabelFeedbackSignal>().notNull(),
    source: text("source"),
    createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mail_auto_label_feedback_provider_check",
      sql`${table.provider} in ('gmail', 'managed')`,
    ),
    check("mail_auto_label_feedback_signal_check", sql`${table.signal} in ('added', 'removed')`),
    index("mail_auto_label_feedback_profile_idx").on(
      table.mailboxId,
      table.labelId,
      table.source,
      table.signal,
    ),
    index("mail_auto_label_feedback_mailbox_updated_idx").on(
      table.mailboxId,
      table.updatedAt.desc(),
    ),
    unique("mail_auto_label_feedback_message_label_unique").on(
      table.mailboxId,
      table.providerMessageId,
      table.labelId,
    ),
  ],
);

export const gmailOAuthState = pgTable(
  "gmailOAuthState",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mailboxId: text("mailboxId").references(() => mailbox.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    codeVerifier: text("codeVerifier").notNull(),
    returnTo: text("returnTo").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("gmail_oauth_state_user_id_idx").on(table.userId),
    index("gmail_oauth_state_expires_at_idx").on(table.expiresAt),
  ],
);

export const connectorOAuthState = pgTable(
  "connectorOAuthState",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ConnectorProvider>().notNull(),
    codeVerifier: text("codeVerifier").notNull(),
    returnTo: text("returnTo").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    check(
      "connector_oauth_state_provider_check",
      sql`${table.provider} in ('google_calendar', 'linear')`,
    ),
    index("connector_oauth_state_user_id_idx").on(table.userId),
    index("connector_oauth_state_expires_at_idx").on(table.expiresAt),
  ],
);

export const mailboxGrant = pgTable(
  "mailboxGrant",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<MailboxGrantRole>().notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check("mailbox_grant_role_check", sql`${table.role} in ('reader', 'responder', 'manager')`),
    index("mailbox_grant_mailbox_id_idx").on(table.mailboxId),
    index("mailbox_grant_user_id_idx").on(table.userId),
    unique("mailbox_grant_mailbox_id_user_id_unique").on(table.mailboxId, table.userId),
  ],
);

export const mailboxDivisionGrant = pgTable(
  "mailboxDivisionGrant",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    divisionId: text("divisionId")
      .notNull()
      .references(() => organizationDivision.id, { onDelete: "cascade" }),
    role: text("role").$type<MailboxGrantRole>().notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_division_grant_role_check",
      sql`${table.role} in ('reader', 'responder', 'manager')`,
    ),
    index("mailbox_division_grant_mailbox_id_idx").on(table.mailboxId),
    index("mailbox_division_grant_division_id_idx").on(table.divisionId),
    unique("mailbox_division_grant_mailbox_division_unique").on(table.mailboxId, table.divisionId),
  ],
);

export const managedMailMessage = pgTable(
  "managedMailMessage",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    direction: text("direction").$type<ManagedMailDirection>().notNull(),
    mailboxState: text("mailboxState").$type<ManagedMailMailboxState>().notNull().default("active"),
    providerMessageId: text("providerMessageId").notNull(),
    threadId: text("threadId").notNull(),
    messageHeaderId: text("messageHeaderId"),
    inReplyTo: text("inReplyTo"),
    references: text("references"),
    from: text("from").notNull(),
    fromNormalized: text("fromNormalized").notNull().default(""),
    to: text("to"),
    toNormalized: text("toNormalized").notNull().default(""),
    cc: text("cc"),
    ccNormalized: text("ccNormalized").notNull().default(""),
    bcc: text("bcc"),
    bccNormalized: text("bccNormalized").notNull().default(""),
    replyTo: text("replyTo"),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyHtml: text("bodyHtml"),
    bodyText: text("bodyText"),
    searchText: text("searchText").notNull().default(""),
    headers: jsonb("headers").$type<ManagedMailHeader[]>().notNull().default([]),
    isRead: boolean("isRead").notNull().default(false),
    sentAt: timestamp("sentAt").notNull(),
    s3Bucket: text("s3Bucket"),
    s3Key: text("s3Key"),
    rawObjectProvider: text("rawObjectProvider").$type<ManagedMailRawObjectProvider>(),
    rawObjectBucket: text("rawObjectBucket"),
    rawObjectKey: text("rawObjectKey"),
    rawSizeBytes: integer("rawSizeBytes"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "managed_mail_message_direction_check",
      sql`${table.direction} in ('inbound', 'outbound')`,
    ),
    check(
      "managed_mail_message_mailbox_state_check",
      sql`${table.mailboxState} in ('active', 'draft', 'spam', 'trash')`,
    ),
    check(
      "managed_mail_message_raw_object_provider_check",
      sql`${table.rawObjectProvider} is null or ${table.rawObjectProvider} in ('r2', 's3')`,
    ),
    index("managed_mail_message_mailbox_direction_sent_at_idx").on(
      table.mailboxId,
      table.direction,
      table.sentAt,
    ),
    index("managed_mail_message_mailbox_state_sent_at_idx").on(
      table.mailboxId,
      table.mailboxState,
      table.sentAt,
    ),
    index("managed_mail_message_mailbox_thread_id_idx").on(table.mailboxId, table.threadId),
    index("managed_mail_message_mailbox_from_normalized_idx").on(
      table.mailboxId,
      table.fromNormalized,
    ),
    index("managed_mail_message_mailbox_sent_at_id_idx").on(
      table.mailboxId,
      table.sentAt,
      table.id,
    ),
    index("managed_mail_message_raw_object_idx").on(
      table.rawObjectProvider,
      table.rawObjectBucket,
      table.rawObjectKey,
    ),
    index("managed_mail_message_s3_bucket_key_idx").on(table.s3Bucket, table.s3Key),
    unique("managed_mail_message_mailbox_provider_message_unique").on(
      table.mailboxId,
      table.providerMessageId,
    ),
  ],
);

export const organizationApiMailMessage = pgTable(
  "organizationApiMailMessage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerMessageId: text("providerMessageId").notNull(),
    messageHeaderId: text("messageHeaderId"),
    from: text("from").notNull(),
    fromNormalized: text("fromNormalized").notNull().default(""),
    senderAddress: text("senderAddress").notNull(),
    to: text("to"),
    toNormalized: text("toNormalized").notNull().default(""),
    cc: text("cc"),
    ccNormalized: text("ccNormalized").notNull().default(""),
    bcc: text("bcc"),
    bccNormalized: text("bccNormalized").notNull().default(""),
    replyTo: text("replyTo"),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyHtml: text("bodyHtml"),
    bodyText: text("bodyText"),
    searchText: text("searchText").notNull().default(""),
    headers: jsonb("headers").$type<OrganizationApiMailHeader[]>().notNull().default([]),
    rawSizeBytes: integer("rawSizeBytes"),
    sentAt: timestamp("sentAt").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("organization_api_mail_message_org_sent_at_idx").on(
      table.organizationId,
      table.sentAt,
      table.id,
    ),
    index("organization_api_mail_message_org_sender_idx").on(
      table.organizationId,
      table.senderAddress,
    ),
    unique("organization_api_mail_message_org_provider_unique").on(
      table.organizationId,
      table.providerMessageId,
    ),
  ],
);

export const organizationApiMailAttachment = pgTable(
  "organizationApiMailAttachment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    messageId: text("messageId")
      .notNull()
      .references(() => organizationApiMailMessage.id, { onDelete: "cascade" }),
    fileName: text("fileName").notNull(),
    normalizedFileName: text("normalizedFileName").notNull().default(""),
    mimeType: text("mimeType").notNull(),
    size: integer("size").notNull(),
    inline: boolean("inline").notNull().default(false),
    contentId: text("contentId"),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("organization_api_mail_attachment_org_name_idx").on(
      table.organizationId,
      table.normalizedFileName,
    ),
    index("organization_api_mail_attachment_message_idx").on(table.messageId),
  ],
);

export const managedMailLabel = pgTable(
  "managedMailLabel",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    color: text("color").notNull().default("gray"),
    description: text("description"),
    visible: boolean("visible").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
    updatedByUserId: text("updatedByUserId").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("managed_mail_label_mailbox_position_idx").on(table.mailboxId, table.position),
    unique("managed_mail_label_mailbox_normalized_name_unique").on(
      table.mailboxId,
      table.normalizedName,
    ),
  ],
);

export const managedMailSavedView = pgTable(
  "managedMailSavedView",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    ownerUserId: text("ownerUserId").references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    search: jsonb("search").$type<unknown>().notNull(),
    sort: text("sort").$type<ManagedMailSavedViewSort>().notNull().default("newest"),
    color: text("color"),
    icon: text("icon"),
    position: integer("position").notNull().default(0),
    disabledReason: text("disabledReason"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "managed_mail_saved_view_sort_check",
      sql`${table.sort} in ('newest', 'oldest', 'relevance')`,
    ),
    index("managed_mail_saved_view_mailbox_owner_position_idx").on(
      table.mailboxId,
      table.ownerUserId,
      table.position,
    ),
    uniqueIndex("managed_mail_saved_view_shared_name_unique")
      .on(table.mailboxId, table.normalizedName)
      .where(sql`${table.ownerUserId} is null`),
    uniqueIndex("managed_mail_saved_view_personal_name_unique")
      .on(table.mailboxId, table.ownerUserId, table.normalizedName)
      .where(sql`${table.ownerUserId} is not null`),
  ],
);

export const managedMailRule = pgTable(
  "managedMailRule",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    matchMode: text("matchMode").$type<ManagedMailRuleMatchMode>().notNull().default("all"),
    search: jsonb("search").$type<unknown>().notNull(),
    labelIds: jsonb("labelIds").$type<string[]>().notNull(),
    priority: integer("priority").notNull().default(0),
    createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
    updatedByUserId: text("updatedByUserId").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check("managed_mail_rule_match_mode_check", sql`${table.matchMode} in ('all', 'any')`),
    index("managed_mail_rule_mailbox_enabled_priority_idx").on(
      table.mailboxId,
      table.enabled,
      table.priority,
    ),
    unique("managed_mail_rule_mailbox_normalized_name_unique").on(
      table.mailboxId,
      table.normalizedName,
    ),
  ],
);

export const managedMailMessageLabel = pgTable(
  "managedMailMessageLabel",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    messageId: text("messageId")
      .notNull()
      .references(() => managedMailMessage.id, { onDelete: "cascade" }),
    labelId: text("labelId")
      .notNull()
      .references(() => managedMailLabel.id, { onDelete: "cascade" }),
    source: text("source").$type<ManagedMailLabelAssignmentSource>().notNull(),
    ruleId: text("ruleId").references(() => managedMailRule.id, { onDelete: "set null" }),
    assignedByUserId: text("assignedByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    check(
      "managed_mail_message_label_source_check",
      sql`${table.source} in ('manual', 'rule', 'inherited', 'backfill', 'ai_auto_label')`,
    ),
    index("managed_mail_message_label_mailbox_label_idx").on(table.mailboxId, table.labelId),
    index("managed_mail_message_label_message_idx").on(table.messageId),
    unique("managed_mail_message_label_message_label_unique").on(table.messageId, table.labelId),
  ],
);

export const managedMailAttachment = pgTable(
  "managedMailAttachment",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    messageId: text("messageId")
      .notNull()
      .references(() => managedMailMessage.id, { onDelete: "cascade" }),
    fileName: text("fileName").notNull(),
    normalizedFileName: text("normalizedFileName").notNull(),
    mimeType: text("mimeType").notNull(),
    size: integer("size").notNull(),
    inline: boolean("inline").notNull().default(false),
    contentId: text("contentId"),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("managed_mail_attachment_mailbox_name_idx").on(table.mailboxId, table.normalizedFileName),
    index("managed_mail_attachment_message_idx").on(table.messageId),
  ],
);

export const managedMailRuleApplication = pgTable(
  "managedMailRuleApplication",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    ruleId: text("ruleId")
      .notNull()
      .references(() => managedMailRule.id, { onDelete: "cascade" }),
    messageId: text("messageId")
      .notNull()
      .references(() => managedMailMessage.id, { onDelete: "cascade" }),
    matched: boolean("matched").notNull(),
    error: text("error"),
    appliedAt: timestamp("appliedAt"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("managed_mail_rule_application_mailbox_created_idx").on(table.mailboxId, table.createdAt),
    unique("managed_mail_rule_application_rule_message_unique").on(table.ruleId, table.messageId),
  ],
);

export const managedMailRuleBackfill = pgTable(
  "managedMailRuleBackfill",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    ruleId: text("ruleId")
      .notNull()
      .references(() => managedMailRule.id, { onDelete: "cascade" }),
    status: text("status").$type<ManagedMailRuleBackfillStatus>().notNull().default("pending"),
    cursor: text("cursor"),
    processedCount: integer("processedCount").notNull().default(0),
    matchedCount: integer("matchedCount").notNull().default(0),
    updatedCount: integer("updatedCount").notNull().default(0),
    errorCount: integer("errorCount").notNull().default(0),
    lastError: text("lastError"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    cancelledAt: timestamp("cancelledAt"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "managed_mail_rule_backfill_status_check",
      sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    index("managed_mail_rule_backfill_rule_status_idx").on(table.ruleId, table.status),
  ],
);

export const mailDomain = pgTable(
  "mailDomain",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    mailFromDomain: text("mailFromDomain").notNull(),
    status: text("status").$type<MailDomainStatus>().notNull(),
    requiredDnsRecords: jsonb("requiredDnsRecords").$type<MailDomainDnsRecord[]>().notNull(),
    lastCheckResult: jsonb("lastCheckResult").$type<MailDomainCheckResult>(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    verifiedAt: timestamp("verifiedAt"),
  },
  (table) => [
    index("mail_domain_organization_id_idx").on(table.organizationId),
    unique("mail_domain_domain_unique").on(table.domain),
  ],
);

export const billingSubscription = pgTable(
  "billingSubscription",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    scope: text("scope").$type<BillingScope>().notNull().default("team"),
    provider: text("provider").$type<BillingProvider>().notNull(),
    providerSubscriptionId: text("providerSubscriptionId").notNull(),
    providerCustomerId: text("providerCustomerId"),
    providerProductId: text("providerProductId").notNull(),
    plan: text("plan").$type<BillingPlan>().notNull(),
    status: text("status").$type<BillingSubscriptionStatus>().notNull(),
    currentPeriodStart: timestamp("currentPeriodStart").notNull(),
    currentPeriodEnd: timestamp("currentPeriodEnd").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("billing_subscription_user_id_idx").on(table.userId),
    index("billing_subscription_organization_id_idx").on(table.organizationId),
    index("billing_subscription_scope_target_idx").on(
      table.scope,
      table.userId,
      table.organizationId,
    ),
    index("billing_subscription_provider_subscription_id_idx").on(table.providerSubscriptionId),
    unique("billing_subscription_provider_subscription_unique").on(
      table.provider,
      table.providerSubscriptionId,
    ),
  ],
);

export const billingCreditUsageEvent = pgTable(
  "billingCreditUsageEvent",
  {
    id: text("id").primaryKey(),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    scope: text("scope").$type<BillingScope>().notNull().default("team"),
    category: text("category").$type<BillingUsageCategory>().notNull(),
    costMicroCents: bigint("costMicroCents", { mode: "number" }).notNull(),
    billableCostMicroCents: bigint("billableCostMicroCents", { mode: "number" }).notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    polarEventReportedAt: timestamp("polarEventReportedAt"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    check(
      "billing_credit_usage_event_target_check",
      sql`${table.scope} = 'team' and ${table.userId} is null and ${table.organizationId} is not null`,
    ),
    check("billing_credit_usage_event_cost_check", sql`${table.costMicroCents} >= 0`),
    check(
      "billing_credit_usage_event_billable_cost_check",
      sql`${table.billableCostMicroCents} >= 0`,
    ),
    index("billing_credit_usage_event_personal_period_idx").on(table.userId, table.createdAt),
    index("billing_credit_usage_event_team_period_idx").on(table.organizationId, table.createdAt),
    unique("billing_credit_usage_event_dedupe_key_unique").on(table.dedupeKey),
  ],
);

export const billingEntitlementOverride = pgTable(
  "billingEntitlementOverride",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    plan: text("plan").$type<BillingPlan>().notNull(),
    reason: text("reason").notNull(),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("billing_entitlement_override_user_id_idx").on(table.userId),
    index("billing_entitlement_override_active_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

export const organizationMailUsageEvent = pgTable(
  "organizationMailUsageEvent",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    direction: text("direction").$type<OrganizationMailUsageDirection>().notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("providerMessageId").notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    recipientCount: integer("recipientCount").notNull(),
    messageCount: integer("messageCount").notNull(),
    messageSizeBytes: integer("messageSizeBytes").notNull(),
    attachmentSizeBytes: integer("attachmentSizeBytes").notNull(),
    incomingChunkCount: integer("incomingChunkCount").notNull(),
    sesCostMicroCents: bigint("sesCostMicroCents", { mode: "number" }).notNull(),
    includedSesCostMicroCents: bigint("includedSesCostMicroCents", { mode: "number" }).notNull(),
    billableCostMicroCents: bigint("billableCostMicroCents", { mode: "number" }).notNull(),
    polarEventReportedAt: timestamp("polarEventReportedAt"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("organization_mail_usage_event_organization_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    unique("organization_mail_usage_event_dedupe_key_unique").on(table.dedupeKey),
  ],
);

export const organizationMailSendIdempotency = pgTable(
  "organizationMailSendIdempotency",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotencyKey").notNull(),
    requestHash: text("requestHash").notNull(),
    response: jsonb("response").$type<{
      messageId: string | null;
      sent: true;
    }>(),
    status: text("status").default("completed").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("organization_mail_send_idempotency_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    unique("organization_mail_send_idempotency_organization_key_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
  ],
);

export const rateLimitBucket = pgTable(
  "rateLimitBucket",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    windowStart: timestamp("windowStart").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
  },
  (table) => [index("rate_limit_bucket_expires_at_idx").on(table.expiresAt)],
);

export const organizationMailUsageSettings = pgTable("organizationMailUsageSettings", {
  organizationId: text("organizationId")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  overageEnabled: boolean("overageEnabled").notNull().default(true),
  monthlyOverageLimitMicroCents: bigint("monthlyOverageLimitMicroCents", {
    mode: "number",
  }),
  alertMilestonePercents: jsonb("alertMilestonePercents")
    .$type<number[]>()
    .notNull()
    .default([50, 80, 100]),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const organizationMailUsageAlertEvent = pgTable(
  "organizationMailUsageAlertEvent",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    periodStart: timestamp("periodStart").notNull(),
    periodEnd: timestamp("periodEnd").notNull(),
    target: text("target").$type<OrganizationMailUsageAlertTarget>().notNull(),
    milestonePercent: integer("milestonePercent").notNull(),
    thresholdMicroCents: bigint("thresholdMicroCents", { mode: "number" }).notNull(),
    usageMicroCents: bigint("usageMicroCents", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("organization_mail_usage_alert_event_organization_period_idx").on(
      table.organizationId,
      table.periodStart,
    ),
    unique("organization_mail_usage_alert_event_period_milestone_unique").on(
      table.organizationId,
      table.periodStart,
      table.target,
      table.milestonePercent,
    ),
  ],
);

export const chat = pgTable(
  "chat",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("chat_mailbox_id_user_id_updated_at_idx").on(
      table.mailboxId,
      table.userId,
      table.updatedAt,
    ),
    unique("chat_id_user_id_unique").on(table.id, table.userId),
    unique("chat_id_mailbox_id_user_id_unique").on(table.id, table.mailboxId, table.userId),
  ],
);

export const chatMessage = pgTable(
  "chatMessage",
  {
    id: text("id").primaryKey(),
    chatId: text("chatId").notNull(),
    userId: text("userId").notNull(),
    position: integer("position").notNull(),
    role: text("role").$type<ChatMessageRole>().notNull(),
    parts: jsonb("parts").$type<ChatMessagePart[]>().notNull(),
    status: text("status").$type<ChatMessageStatus>().notNull().default("complete"),
    error: text("error"),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chatId, table.userId],
      foreignColumns: [chat.id, chat.userId],
      name: "chat_message_chat_id_user_id_fkey",
    }).onDelete("cascade"),
    unique("chat_message_id_chat_id_unique").on(table.id, table.chatId),
    unique("chat_message_chat_id_position_unique").on(table.chatId, table.position),
  ],
);

export const chatRun = pgTable(
  "chatRun",
  {
    id: text("id").primaryKey(),
    chatId: text("chatId").notNull(),
    userId: text("userId").notNull(),
    assistantMessageId: text("assistantMessageId").notNull(),
    status: text("status").$type<ChatRunStatus>().notNull(),
    mailboxId: text("mailboxId").notNull(),
    mailboxCategory: text("mailboxCategory").notNull(),
    model: text("model").notNull().default("openai/gpt-5.6-luna"),
    cancelRequestedAt: timestamp("cancelRequestedAt"),
    lastHeartbeatAt: timestamp("lastHeartbeatAt"),
    error: text("error"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.assistantMessageId, table.chatId],
      foreignColumns: [chatMessage.id, chatMessage.chatId],
      name: "chat_run_assistant_message_id_chat_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.chatId, table.mailboxId, table.userId],
      foreignColumns: [chat.id, chat.mailboxId, chat.userId],
      name: "chat_run_chat_id_mailbox_id_user_id_fkey",
    }).onDelete("cascade"),
    index("chat_run_chat_id_status_idx").on(table.chatId, table.status),
    uniqueIndex("chat_run_one_active_per_chat")
      .on(table.chatId)
      .where(sql`${table.status} in ('queued', 'running', 'waiting_on_tool')`),
  ],
);

export const waitlistSignup = pgTable("waitlistSignup", {
  email: text("email").primaryKey(),
  createdAt: timestamp("createdAt").notNull(),
});

export const apikey = pgTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("configId").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("referenceId").notNull(),
    refillInterval: integer("refillInterval"),
    refillAmount: integer("refillAmount"),
    lastRefillAt: timestamp("lastRefillAt"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rateLimitEnabled").default(true),
    rateLimitTimeWindow: integer("rateLimitTimeWindow"),
    rateLimitMax: integer("rateLimitMax"),
    requestCount: integer("requestCount").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("lastRequest"),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_config_id_idx").on(table.configId),
    index("apikey_reference_id_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

export const tables = {
  apikey,
  billingCreditUsageEvent,
  billingEntitlementOverride,
  billingSubscription,
  chat,
  chatMessage,
  chatRun,
  connectorCredential,
  connectorOAuthState,
  mailboxAction,
  mailboxActionExternalEffect,
  mailboxActionRevision,
  mailboxActionRun,
  mailboxActionRunFrame,
  mailboxActionStepRun,
  user,
  userAiContext,
  userAiContextEvent,
  organization,
  session,
  account,
  verification,
  passkey,
  rateLimitBucket,
  member,
  invitation,
  organizationDivision,
  organizationDivisionMember,
  gmailCredential,
  gmailAutoLabelEvent,
  gmailAutoLabelSettings,
  gmailUsefulDetail,
  gmailUsefulDetailEvent,
  gmailUsefulDetailFeedback,
  gmailUsefulDetailSettings,
  mailAutomationMemoryProfile,
  mailAutoLabelFeedback,
  mailboxAutomationSettings,
  gmailLabel,
  gmailOAuthState,
  gmailWatchState,
  mailbox,
  mailboxDivisionGrant,
  mailboxGrant,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  managedMailRule,
  managedMailRuleApplication,
  managedMailRuleBackfill,
  managedMailSavedView,
  mailDomain,
  organizationApiMailAttachment,
  organizationApiMailMessage,
  organizationMailUsageAlertEvent,
  organizationMailSendIdempotency,
  organizationMailUsageEvent,
  organizationMailUsageSettings,
  waitlistSignup,
};

export const authRelations = defineRelations(tables, (r) => ({
  user: {
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    billingSubscriptions: r.many.billingSubscription({
      from: r.user.id,
      to: r.billingSubscription.userId,
    }),
    billingCreditUsageEvents: r.many.billingCreditUsageEvent({
      from: r.user.id,
      to: r.billingCreditUsageEvent.userId,
    }),
    aiContext: r.one.userAiContext({
      from: r.user.id,
      to: r.userAiContext.userId,
    }),
    aiContextEvents: r.many.userAiContextEvent({
      from: r.user.id,
      to: r.userAiContextEvent.userId,
    }),
    chats: r.many.chat({ from: r.user.id, to: r.chat.userId }),
    connectorCredentials: r.many.connectorCredential({
      from: r.user.id,
      to: r.connectorCredential.userId,
    }),
    connectorOAuthStates: r.many.connectorOAuthState({
      from: r.user.id,
      to: r.connectorOAuthState.userId,
    }),
    createdMailboxActions: r.many.mailboxAction({
      from: r.user.id,
      to: r.mailboxAction.createdByUserId,
    }),
    createdMailboxActionRevisions: r.many.mailboxActionRevision({
      from: r.user.id,
      to: r.mailboxActionRevision.createdByUserId,
    }),
    invitations: r.many.invitation({ from: r.user.id, to: r.invitation.inviterId }),
    gmailOAuthStates: r.many.gmailOAuthState({
      from: r.user.id,
      to: r.gmailOAuthState.userId,
    }),
    mailboxGrants: r.many.mailboxGrant({ from: r.user.id, to: r.mailboxGrant.userId }),
    ownedMailboxes: r.many.mailbox({ from: r.user.id, to: r.mailbox.ownerUserId }),
    memberships: r.many.member({ from: r.user.id, to: r.member.userId }),
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
    passkeys: r.many.passkey({ from: r.user.id, to: r.passkey.userId }),
  },
  chat: {
    mailbox: r.one.mailbox({
      from: r.chat.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    messages: r.many.chatMessage({ from: r.chat.id, to: r.chatMessage.chatId }),
    runs: r.many.chatRun({ from: r.chat.id, to: r.chatRun.chatId }),
    user: r.one.user({
      from: r.chat.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  chatRun: {
    assistantMessage: r.one.chatMessage({
      from: r.chatRun.assistantMessageId,
      to: r.chatMessage.id,
      optional: false,
    }),
    chat: r.one.chat({
      from: r.chatRun.chatId,
      to: r.chat.id,
      optional: false,
    }),
    mailbox: r.one.mailbox({
      from: r.chatRun.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.chatRun.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  chatMessage: {
    chat: r.one.chat({
      from: r.chatMessage.chatId,
      to: r.chat.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.chatMessage.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  organization: {
    billingCreditUsageEvents: r.many.billingCreditUsageEvent({
      from: r.organization.id,
      to: r.billingCreditUsageEvent.organizationId,
    }),
    userAiContextEvents: r.many.userAiContextEvent({
      from: r.organization.id,
      to: r.userAiContextEvent.organizationId,
    }),
    billingSubscriptions: r.many.billingSubscription({
      from: r.organization.id,
      to: r.billingSubscription.organizationId,
    }),
    gmailOAuthStates: r.many.gmailOAuthState({
      from: r.organization.id,
      to: r.gmailOAuthState.organizationId,
    }),
    mailboxActions: r.many.mailboxAction({
      from: r.organization.id,
      to: r.mailboxAction.organizationId,
    }),
    mailboxActionRuns: r.many.mailboxActionRun({
      from: r.organization.id,
      to: r.mailboxActionRun.organizationId,
    }),
    invitations: r.many.invitation({
      from: r.organization.id,
      to: r.invitation.organizationId,
    }),
    divisions: r.many.organizationDivision({
      from: r.organization.id,
      to: r.organizationDivision.organizationId,
    }),
    mailboxes: r.many.mailbox({ from: r.organization.id, to: r.mailbox.organizationId }),
    mailDomains: r.many.mailDomain({ from: r.organization.id, to: r.mailDomain.organizationId }),
    members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
    organizationApiMailAttachments: r.many.organizationApiMailAttachment({
      from: r.organization.id,
      to: r.organizationApiMailAttachment.organizationId,
    }),
    organizationApiMailMessages: r.many.organizationApiMailMessage({
      from: r.organization.id,
      to: r.organizationApiMailMessage.organizationId,
    }),
    organizationMailUsageEvents: r.many.organizationMailUsageEvent({
      from: r.organization.id,
      to: r.organizationMailUsageEvent.organizationId,
    }),
    organizationMailSendIdempotency: r.many.organizationMailSendIdempotency({
      from: r.organization.id,
      to: r.organizationMailSendIdempotency.organizationId,
    }),
    organizationMailUsageSettings: r.one.organizationMailUsageSettings({
      from: r.organization.id,
      to: r.organizationMailUsageSettings.organizationId,
      optional: true,
    }),
    organizationMailUsageAlertEvents: r.many.organizationMailUsageAlertEvent({
      from: r.organization.id,
      to: r.organizationMailUsageAlertEvent.organizationId,
    }),
  },
  session: {
    activeOrganization: r.one.organization({
      from: r.session.activeOrganizationId,
      to: r.organization.id,
      optional: true,
    }),
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  connectorCredential: {
    actionExternalEffects: r.many.mailboxActionExternalEffect({
      from: r.connectorCredential.id,
      to: r.mailboxActionExternalEffect.connectorCredentialId,
    }),
    user: r.one.user({
      from: r.connectorCredential.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  connectorOAuthState: {
    user: r.one.user({
      from: r.connectorOAuthState.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  passkey: {
    user: r.one.user({
      from: r.passkey.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  member: {
    divisionMemberships: r.many.organizationDivisionMember({
      from: r.member.id,
      to: r.organizationDivisionMember.memberId,
    }),
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.member.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  invitation: {
    inviter: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
      optional: false,
    }),
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  organizationDivision: {
    organization: r.one.organization({
      from: r.organizationDivision.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    members: r.many.organizationDivisionMember({
      from: r.organizationDivision.id,
      to: r.organizationDivisionMember.divisionId,
    }),
    mailboxes: r.many.mailbox({
      from: r.organizationDivision.id,
      to: r.mailbox.divisionId,
    }),
    mailboxGrants: r.many.mailboxDivisionGrant({
      from: r.organizationDivision.id,
      to: r.mailboxDivisionGrant.divisionId,
    }),
  },
  organizationDivisionMember: {
    division: r.one.organizationDivision({
      from: r.organizationDivisionMember.divisionId,
      to: r.organizationDivision.id,
      optional: false,
    }),
    member: r.one.member({
      from: r.organizationDivisionMember.memberId,
      to: r.member.id,
      optional: false,
    }),
  },
  mailbox: {
    userAiContextEvents: r.many.userAiContextEvent({
      from: r.mailbox.id,
      to: r.userAiContextEvent.mailboxId,
    }),
    chats: r.many.chat({ from: r.mailbox.id, to: r.chat.mailboxId }),
    gmailAutoLabelEvents: r.many.gmailAutoLabelEvent({
      from: r.mailbox.id,
      to: r.gmailAutoLabelEvent.mailboxId,
    }),
    gmailAutoLabelSettings: r.one.gmailAutoLabelSettings({
      from: r.mailbox.id,
      to: r.gmailAutoLabelSettings.mailboxId,
      optional: true,
    }),
    gmailUsefulDetailEvents: r.many.gmailUsefulDetailEvent({
      from: r.mailbox.id,
      to: r.gmailUsefulDetailEvent.mailboxId,
    }),
    gmailUsefulDetailFeedback: r.many.gmailUsefulDetailFeedback({
      from: r.mailbox.id,
      to: r.gmailUsefulDetailFeedback.mailboxId,
    }),
    gmailUsefulDetailSettings: r.one.gmailUsefulDetailSettings({
      from: r.mailbox.id,
      to: r.gmailUsefulDetailSettings.mailboxId,
      optional: true,
    }),
    gmailUsefulDetails: r.many.gmailUsefulDetail({
      from: r.mailbox.id,
      to: r.gmailUsefulDetail.mailboxId,
    }),
    automationSettings: r.one.mailboxAutomationSettings({
      from: r.mailbox.id,
      to: r.mailboxAutomationSettings.mailboxId,
      optional: true,
    }),
    actions: r.many.mailboxAction({
      from: r.mailbox.id,
      to: r.mailboxAction.mailboxId,
    }),
    actionRuns: r.many.mailboxActionRun({
      from: r.mailbox.id,
      to: r.mailboxActionRun.mailboxId,
    }),
    automationMemoryProfiles: r.many.mailAutomationMemoryProfile({
      from: r.mailbox.id,
      to: r.mailAutomationMemoryProfile.mailboxId,
    }),
    autoLabelFeedback: r.many.mailAutoLabelFeedback({
      from: r.mailbox.id,
      to: r.mailAutoLabelFeedback.mailboxId,
    }),
    gmailCredential: r.one.gmailCredential({
      from: r.mailbox.id,
      to: r.gmailCredential.mailboxId,
      optional: true,
    }),
    gmailLabels: r.many.gmailLabel({ from: r.mailbox.id, to: r.gmailLabel.mailboxId }),
    gmailWatchState: r.one.gmailWatchState({
      from: r.mailbox.id,
      to: r.gmailWatchState.mailboxId,
      optional: true,
    }),
    division: r.one.organizationDivision({
      from: r.mailbox.divisionId,
      to: r.organizationDivision.id,
      optional: true,
    }),
    divisionGrants: r.many.mailboxDivisionGrant({
      from: r.mailbox.id,
      to: r.mailboxDivisionGrant.mailboxId,
    }),
    grants: r.many.mailboxGrant({ from: r.mailbox.id, to: r.mailboxGrant.mailboxId }),
    managedMessages: r.many.managedMailMessage({
      from: r.mailbox.id,
      to: r.managedMailMessage.mailboxId,
    }),
    managedAttachments: r.many.managedMailAttachment({
      from: r.mailbox.id,
      to: r.managedMailAttachment.mailboxId,
    }),
    managedLabels: r.many.managedMailLabel({
      from: r.mailbox.id,
      to: r.managedMailLabel.mailboxId,
    }),
    managedRules: r.many.managedMailRule({
      from: r.mailbox.id,
      to: r.managedMailRule.mailboxId,
    }),
    managedSavedViews: r.many.managedMailSavedView({
      from: r.mailbox.id,
      to: r.managedMailSavedView.mailboxId,
    }),
    owner: r.one.user({
      from: r.mailbox.ownerUserId,
      to: r.user.id,
      optional: true,
    }),
    organization: r.one.organization({
      from: r.mailbox.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  gmailCredential: {
    mailbox: r.one.mailbox({
      from: r.gmailCredential.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  gmailAutoLabelEvent: {
    mailbox: r.one.mailbox({
      from: r.gmailAutoLabelEvent.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  gmailAutoLabelSettings: {
    mailbox: r.one.mailbox({
      from: r.gmailAutoLabelSettings.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  gmailUsefulDetail: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetail.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  gmailUsefulDetailFeedback: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetailFeedback.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  gmailUsefulDetailEvent: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetailEvent.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  gmailUsefulDetailSettings: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetailSettings.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  mailboxAutomationSettings: {
    mailbox: r.one.mailbox({
      from: r.mailboxAutomationSettings.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  mailboxAction: {
    creator: r.one.user({
      from: r.mailboxAction.createdByUserId,
      to: r.user.id,
      optional: true,
    }),
    mailbox: r.one.mailbox({
      from: r.mailboxAction.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    organization: r.one.organization({
      from: r.mailboxAction.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    revisions: r.many.mailboxActionRevision({
      from: r.mailboxAction.id,
      to: r.mailboxActionRevision.actionId,
    }),
    runs: r.many.mailboxActionRun({
      from: r.mailboxAction.id,
      to: r.mailboxActionRun.actionId,
    }),
    externalEffects: r.many.mailboxActionExternalEffect({
      from: r.mailboxAction.id,
      to: r.mailboxActionExternalEffect.actionId,
    }),
  },
  mailboxActionRevision: {
    action: r.one.mailboxAction({
      from: r.mailboxActionRevision.actionId,
      to: r.mailboxAction.id,
      optional: false,
    }),
    creator: r.one.user({
      from: r.mailboxActionRevision.createdByUserId,
      to: r.user.id,
      optional: true,
    }),
    runs: r.many.mailboxActionRun({
      from: r.mailboxActionRevision.id,
      to: r.mailboxActionRun.revisionId,
    }),
  },
  mailboxActionRun: {
    action: r.one.mailboxAction({
      from: r.mailboxActionRun.actionId,
      to: r.mailboxAction.id,
      optional: false,
    }),
    frames: r.many.mailboxActionRunFrame({
      from: r.mailboxActionRun.id,
      to: r.mailboxActionRunFrame.runId,
    }),
    mailbox: r.one.mailbox({
      from: r.mailboxActionRun.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    organization: r.one.organization({
      from: r.mailboxActionRun.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    revision: r.one.mailboxActionRevision({
      from: r.mailboxActionRun.revisionId,
      to: r.mailboxActionRevision.id,
      optional: false,
    }),
    steps: r.many.mailboxActionStepRun({
      from: r.mailboxActionRun.id,
      to: r.mailboxActionStepRun.runId,
    }),
  },
  mailboxActionRunFrame: {
    run: r.one.mailboxActionRun({
      from: r.mailboxActionRunFrame.runId,
      to: r.mailboxActionRun.id,
      optional: false,
    }),
    steps: r.many.mailboxActionStepRun({
      from: r.mailboxActionRunFrame.id,
      to: r.mailboxActionStepRun.frameId,
    }),
  },
  mailboxActionStepRun: {
    externalEffects: r.many.mailboxActionExternalEffect({
      from: r.mailboxActionStepRun.id,
      to: r.mailboxActionExternalEffect.stepRunId,
    }),
    frame: r.one.mailboxActionRunFrame({
      from: r.mailboxActionStepRun.frameId,
      to: r.mailboxActionRunFrame.id,
      optional: true,
    }),
    run: r.one.mailboxActionRun({
      from: r.mailboxActionStepRun.runId,
      to: r.mailboxActionRun.id,
      optional: false,
    }),
  },
  mailboxActionExternalEffect: {
    action: r.one.mailboxAction({
      from: r.mailboxActionExternalEffect.actionId,
      to: r.mailboxAction.id,
      optional: false,
    }),
    connectorCredential: r.one.connectorCredential({
      from: r.mailboxActionExternalEffect.connectorCredentialId,
      to: r.connectorCredential.id,
      optional: true,
    }),
    revision: r.one.mailboxActionRevision({
      from: r.mailboxActionExternalEffect.revisionId,
      to: r.mailboxActionRevision.id,
      optional: false,
    }),
    run: r.one.mailboxActionRun({
      from: r.mailboxActionExternalEffect.runId,
      to: r.mailboxActionRun.id,
      optional: false,
    }),
    step: r.one.mailboxActionStepRun({
      from: r.mailboxActionExternalEffect.stepRunId,
      to: r.mailboxActionStepRun.id,
      optional: true,
    }),
  },
  mailAutomationMemoryProfile: {
    mailbox: r.one.mailbox({
      from: r.mailAutomationMemoryProfile.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  mailAutoLabelFeedback: {
    mailbox: r.one.mailbox({
      from: r.mailAutoLabelFeedback.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.mailAutoLabelFeedback.createdByUserId,
      to: r.user.id,
      optional: true,
    }),
  },
  gmailLabel: {
    mailbox: r.one.mailbox({
      from: r.gmailLabel.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  gmailOAuthState: {
    mailbox: r.one.mailbox({
      from: r.gmailOAuthState.mailboxId,
      to: r.mailbox.id,
      optional: true,
    }),
    organization: r.one.organization({
      from: r.gmailOAuthState.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.gmailOAuthState.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  gmailWatchState: {
    mailbox: r.one.mailbox({
      from: r.gmailWatchState.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  mailboxGrant: {
    mailbox: r.one.mailbox({
      from: r.mailboxGrant.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.mailboxGrant.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  mailboxDivisionGrant: {
    division: r.one.organizationDivision({
      from: r.mailboxDivisionGrant.divisionId,
      to: r.organizationDivision.id,
      optional: false,
    }),
    mailbox: r.one.mailbox({
      from: r.mailboxDivisionGrant.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  managedMailMessage: {
    attachments: r.many.managedMailAttachment({
      from: r.managedMailMessage.id,
      to: r.managedMailAttachment.messageId,
    }),
    labels: r.many.managedMailMessageLabel({
      from: r.managedMailMessage.id,
      to: r.managedMailMessageLabel.messageId,
    }),
    mailbox: r.one.mailbox({
      from: r.managedMailMessage.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  managedMailAttachment: {
    mailbox: r.one.mailbox({
      from: r.managedMailAttachment.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    message: r.one.managedMailMessage({
      from: r.managedMailAttachment.messageId,
      to: r.managedMailMessage.id,
      optional: false,
    }),
  },
  organizationApiMailMessage: {
    attachments: r.many.organizationApiMailAttachment({
      from: r.organizationApiMailMessage.id,
      to: r.organizationApiMailAttachment.messageId,
    }),
    organization: r.one.organization({
      from: r.organizationApiMailMessage.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  organizationApiMailAttachment: {
    message: r.one.organizationApiMailMessage({
      from: r.organizationApiMailAttachment.messageId,
      to: r.organizationApiMailMessage.id,
      optional: false,
    }),
    organization: r.one.organization({
      from: r.organizationApiMailAttachment.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  managedMailLabel: {
    assignments: r.many.managedMailMessageLabel({
      from: r.managedMailLabel.id,
      to: r.managedMailMessageLabel.labelId,
    }),
    mailbox: r.one.mailbox({
      from: r.managedMailLabel.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  managedMailMessageLabel: {
    label: r.one.managedMailLabel({
      from: r.managedMailMessageLabel.labelId,
      to: r.managedMailLabel.id,
      optional: false,
    }),
    message: r.one.managedMailMessage({
      from: r.managedMailMessageLabel.messageId,
      to: r.managedMailMessage.id,
      optional: false,
    }),
    rule: r.one.managedMailRule({
      from: r.managedMailMessageLabel.ruleId,
      to: r.managedMailRule.id,
      optional: true,
    }),
  },
  managedMailRule: {
    applications: r.many.managedMailRuleApplication({
      from: r.managedMailRule.id,
      to: r.managedMailRuleApplication.ruleId,
    }),
    backfills: r.many.managedMailRuleBackfill({
      from: r.managedMailRule.id,
      to: r.managedMailRuleBackfill.ruleId,
    }),
    mailbox: r.one.mailbox({
      from: r.managedMailRule.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
  },
  managedMailSavedView: {
    mailbox: r.one.mailbox({
      from: r.managedMailSavedView.mailboxId,
      to: r.mailbox.id,
      optional: false,
    }),
    owner: r.one.user({
      from: r.managedMailSavedView.ownerUserId,
      to: r.user.id,
      optional: true,
    }),
  },
  mailDomain: {
    organization: r.one.organization({
      from: r.mailDomain.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  billingSubscription: {
    organization: r.one.organization({
      from: r.billingSubscription.organizationId,
      to: r.organization.id,
      optional: true,
    }),
    user: r.one.user({
      from: r.billingSubscription.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  billingCreditUsageEvent: {
    organization: r.one.organization({
      from: r.billingCreditUsageEvent.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.billingCreditUsageEvent.userId,
      to: r.user.id,
      optional: true,
    }),
  },
  organizationMailUsageEvent: {
    organization: r.one.organization({
      from: r.organizationMailUsageEvent.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  organizationMailSendIdempotency: {
    organization: r.one.organization({
      from: r.organizationMailSendIdempotency.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  organizationMailUsageSettings: {
    organization: r.one.organization({
      from: r.organizationMailUsageSettings.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
  organizationMailUsageAlertEvent: {
    organization: r.one.organization({
      from: r.organizationMailUsageAlertEvent.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
}));
