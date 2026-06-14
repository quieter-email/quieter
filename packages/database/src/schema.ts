import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
export type MailboxConnectionStatus = "connected" | "needs_reconnect";
export type MailboxGrantRole = "manager" | "reader" | "responder";
export type MailboxProvider = "gmail" | "managed";
export type ManagedMailDirection = "inbound" | "outbound";
export type ManagedMailHeader = {
  name: string;
  value: string;
};
export type BillingPlan = "managed" | "pro";
export type BillingProvider = "polar";
export type BillingSubscriptionStatus =
  | "active"
  | "canceled"
  | "expired"
  | "past_due"
  | "pending"
  | "trialing";
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

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
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
  activeOrganizationId: text("activeOrganizationId").references(() => organization.id),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
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
      .references(() => user.id),
    credentialID: text("credentialID").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull(),
    deviceType: text("deviceType").notNull(),
    backedUp: boolean("backedUp").notNull(),
    transports: text("transports"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
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
      .references(() => organization.id),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
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
      .references(() => organization.id),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
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
    organizationId: text("organizationId").references(() => organization.id),
    status: text("status").$type<MailboxConnectionStatus>().notNull().default("connected"),
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
    unique("mailbox_email_address_unique").on(table.emailAddress),
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

export const gmailLabel = pgTable(
  "gmailLabel",
  {
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    labelId: text("labelId").notNull(),
    name: text("name").notNull(),
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
    promptTokens: integer("promptTokens"),
    completionTokens: integer("completionTokens"),
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

export const gmailOAuthState = pgTable(
  "gmailOAuthState",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mailboxId: text("mailboxId").references(() => mailbox.id, { onDelete: "cascade" }),
    organizationId: text("organizationId").references(() => organization.id, {
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

export const managedMailMessage = pgTable(
  "managedMailMessage",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    direction: text("direction").$type<ManagedMailDirection>().notNull(),
    providerMessageId: text("providerMessageId").notNull(),
    threadId: text("threadId").notNull(),
    messageHeaderId: text("messageHeaderId"),
    inReplyTo: text("inReplyTo"),
    references: text("references"),
    from: text("from").notNull(),
    to: text("to"),
    cc: text("cc"),
    bcc: text("bcc"),
    replyTo: text("replyTo"),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyHtml: text("bodyHtml"),
    bodyText: text("bodyText"),
    headers: jsonb("headers").$type<ManagedMailHeader[]>().notNull().default([]),
    isRead: boolean("isRead").notNull().default(false),
    sentAt: timestamp("sentAt").notNull(),
    s3Bucket: text("s3Bucket"),
    s3Key: text("s3Key"),
    rawSizeBytes: integer("rawSizeBytes"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "managed_mail_message_direction_check",
      sql`${table.direction} in ('inbound', 'outbound')`,
    ),
    index("managed_mail_message_mailbox_direction_sent_at_idx").on(
      table.mailboxId,
      table.direction,
      table.sentAt,
    ),
    index("managed_mail_message_mailbox_thread_id_idx").on(table.mailboxId, table.threadId),
    index("managed_mail_message_s3_bucket_key_idx").on(table.s3Bucket, table.s3Key),
    unique("managed_mail_message_mailbox_provider_message_unique").on(
      table.mailboxId,
      table.providerMessageId,
    ),
  ],
);

export const mailDomain = pgTable(
  "mailDomain",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id),
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
      .references(() => user.id),
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
    index("billing_subscription_provider_subscription_id_idx").on(table.providerSubscriptionId),
    unique("billing_subscription_provider_subscription_unique").on(
      table.provider,
      table.providerSubscriptionId,
    ),
  ],
);

export const organizationMailUsageEvent = pgTable(
  "organizationMailUsageEvent",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id),
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

export const organizationMailUsageSettings = pgTable("organizationMailUsageSettings", {
  organizationId: text("organizationId")
    .primaryKey()
    .references(() => organization.id),
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
      .references(() => organization.id),
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
      .references(() => user.id),
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
    model: text("model").notNull().default("openai/gpt-5.4-nano"),
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
  billingSubscription,
  chat,
  chatMessage,
  chatRun,
  user,
  organization,
  session,
  account,
  verification,
  passkey,
  member,
  invitation,
  gmailCredential,
  gmailAutoLabelEvent,
  gmailAutoLabelSettings,
  gmailLabel,
  gmailOAuthState,
  gmailWatchState,
  mailbox,
  mailboxGrant,
  managedMailMessage,
  mailDomain,
  organizationMailUsageAlertEvent,
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
    chats: r.many.chat({ from: r.user.id, to: r.chat.userId }),
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
    gmailOAuthStates: r.many.gmailOAuthState({
      from: r.organization.id,
      to: r.gmailOAuthState.organizationId,
    }),
    invitations: r.many.invitation({
      from: r.organization.id,
      to: r.invitation.organizationId,
    }),
    mailboxes: r.many.mailbox({ from: r.organization.id, to: r.mailbox.organizationId }),
    mailDomains: r.many.mailDomain({ from: r.organization.id, to: r.mailDomain.organizationId }),
    members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
    organizationMailUsageEvents: r.many.organizationMailUsageEvent({
      from: r.organization.id,
      to: r.organizationMailUsageEvent.organizationId,
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
  passkey: {
    user: r.one.user({
      from: r.passkey.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  member: {
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
  mailbox: {
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
    grants: r.many.mailboxGrant({ from: r.mailbox.id, to: r.mailboxGrant.mailboxId }),
    managedMessages: r.many.managedMailMessage({
      from: r.mailbox.id,
      to: r.managedMailMessage.mailboxId,
    }),
    owner: r.one.user({
      from: r.mailbox.ownerUserId,
      to: r.user.id,
      optional: true,
    }),
    organization: r.one.organization({
      from: r.mailbox.organizationId,
      to: r.organization.id,
      optional: true,
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
      optional: true,
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
  managedMailMessage: {
    mailbox: r.one.mailbox({
      from: r.managedMailMessage.mailboxId,
      to: r.mailbox.id,
      optional: false,
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
    user: r.one.user({
      from: r.billingSubscription.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  organizationMailUsageEvent: {
    organization: r.one.organization({
      from: r.organizationMailUsageEvent.organizationId,
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
