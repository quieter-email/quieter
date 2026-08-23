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
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { defineRelations } from "drizzle-orm/relations";

export type MailDomainStatus = "failed" | "pending_dns" | "verified";
export type MailDomainMode = "send_and_receive" | "send_only";
export type MailDomainConnectAttemptStatus =
  | "canceled"
  | "expired"
  | "failed"
  | "pending"
  | "returned";
export type ConnectorConnectionStatus = "connected" | "needs_reconnect";
export type ConnectorProvider = "google_calendar" | "linear";
export type MailboxConnectionStatus = "connected" | "needs_reconnect";
export type MailboxGrantRole = "manager" | "reader" | "responder";
export type PersistedMailboxProvider = "gmail" | "managed";
export type MailTemplateScope = "personal" | "team";
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
/** Any connector can record an external effect from a mailbox action. */
export type MailboxActionExternalProvider = ConnectorProvider;
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
export type ManagedMailMailboxState =
  | "active"
  | "archived"
  | "draft"
  | "spam"
  | "trash";
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
export type OrganizationMailUsageAlertTarget =
  | "included_usage"
  | "overage_limit";
export type OrganizationMailUsageDirection = "inbound" | "outbound";
export type OrganizationMailDeliveryEventType =
  | "bounced"
  | "complained"
  | "delayed"
  | "delivered"
  | "rejected"
  | "sent";
export type OrganizationMailDeliveryStatus = OrganizationMailDeliveryEventType;
export type OrganizationMailSuppressionReason = "bounce" | "complaint";

export type MailDomainDnsRecord = {
  name: string;
  priority?: number;
  purpose:
    | "dkim"
    | "dmarc"
    | "inbound_mx"
    | "mail_from_mx"
    | "mail_from_spf"
    | "ownership";
  required: boolean;
  type: "CNAME" | "MX" | "TXT";
  value: string;
};

export type MailDomainCheckResult = {
  checks: {
    expected?: string[];
    found?: string[];
    message: string;
    ok: boolean;
    recordName?: string;
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
  }[];
  checkedAt: string;
};

export type MailboxSwitcherOrder = {
  groupIds: string[];
  mailboxIdsByGroupId: Record<string, string[]>;
};
export type MailboxActionGraph = {
  edges: {
    id: string;
    label?: string;
    source: string;
    sourcePort: string;
    target: string;
    targetPort: string;
  }[];
  nodes: {
    config: Record<string, unknown>;
    id: string;
    position: { x: number; y: number };
    type: string;
  }[];
  version: 1;
};
export type MailboxActionJsonObject = Record<string, unknown>;

export type ChatMessageRole = "system" | "user" | "assistant";
/**
 * One UI message part as streamed by the AI runtime. The shape is owned by the
 * chat feature; storage treats it as opaque JSON.
 */
export type ChatMessagePart = {
  type: string;
  [key: string]: unknown;
};
export type UserAiContextEventKind =
  | "auto_label_feedback"
  | "chat_discovery"
  | "explicit_preference"
  | "mail_action"
  | "sent_message"
  | "useful_detail_feedback";
export type AiMemoryStatus = "active" | "archived";
export type AiMemoryScope = "mailbox" | "user";
export type AiMemoryKind = "instruction" | "learned";
export type AiMemorySource = "explicit" | "feedback" | "inferred" | "migration";
export type AiMemoryChangeSetSource =
  | "chat"
  | "feedback"
  | "migration"
  | "settings"
  | "system";
export type AiMemoryChangeSetStatus = "applied" | "failed" | "no_change";
export type AiMemoryIndexJobOperation = "delete" | "upsert";
export type AiMemoryIndexJobStatus =
  | "completed"
  | "failed"
  | "pending"
  | "processing";
export const AI_MEMORY_EMBEDDING_DIMENSIONS = 1024;
export type AiMemoryMetadata = {
  agents?: string[];
  sourceDomains?: string[];
  topics?: string[];
  [key: string]: unknown;
};
export type AiMemorySnapshot = {
  confidence: number;
  content: string;
  expiresAt: string | null;
  importance: number;
  kind: AiMemoryKind;
  key: string;
  metadata: AiMemoryMetadata;
  status: AiMemoryStatus;
  summary: string;
  version: number;
};
export type AiMemoryChange = {
  after: AiMemorySnapshot | null;
  before: AiMemorySnapshot | null;
  memoryId: string;
  operation: "add" | "archive" | "restore" | "update";
};

export const user = pgTable("user", {
  createdAt: timestamp("createdAt").notNull(),
  defaultMailboxId: text("defaultMailboxId"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  id: text("id").primaryKey(),
  image: text("image"),
  mailboxSwitcherOrder: jsonb(
    "mailboxSwitcherOrder"
  ).$type<MailboxSwitcherOrder>(),
  name: text("name").notNull(),
  onboardingCompletedAt: timestamp("onboardingCompletedAt"),
  termsAcceptedAt: timestamp("termsAcceptedAt"),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const userAiContext = pgTable(
  "userAiContext",
  {
    autoLabelModel: text("autoLabelModel")
      .notNull()
      .default("openai/gpt-5.6-luna"),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    lastEditedAt: timestamp("lastEditedAt").notNull(),
    markdown: text("markdown").notNull(),
    revision: integer("revision").notNull().default(1),
    searchFilterModel: text("searchFilterModel")
      .notNull()
      .default("google/gemini-3.5-flash-lite"),
    updatedAt: timestamp("updatedAt").notNull(),
    usefulDetailModel: text("usefulDetailModel")
      .notNull()
      .default("openai/gpt-5.6-luna"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "user_ai_context_markdown_length_check",
      sql`char_length(${table.markdown}) <= 12000`
    ),
    unique("user_ai_context_user_id_unique").on(table.userId),
  ]
);

export const organization = pgTable(
  "organization",
  {
    billingOwnerUserId: text("billingOwnerUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    logo: text("logo"),
    metadata: text("metadata"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [unique("organization_slug_unique").on(table.slug)]
);

export const session = pgTable("session", {
  activeOrganizationId: text("activeOrganizationId").references(
    () => organization.id,
    {
      onDelete: "set null",
    }
  ),
  createdAt: timestamp("createdAt").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  id: text("id").primaryKey(),
  ipAddress: text("ipAddress"),
  token: text("token").notNull().unique(),
  updatedAt: timestamp("updatedAt").notNull(),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable(
  "account",
  {
    accessToken: text("accessToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    accountId: text("accountId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    idToken: text("idToken"),
    password: text("password"),
    providerId: text("providerId").notNull(),
    refreshToken: text("refreshToken"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.providerId, table.accountId)]
);

export const verification = pgTable("verification", {
  createdAt: timestamp("createdAt").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  value: text("value").notNull(),
});

export const passkey = pgTable(
  "passkey",
  {
    aaguid: text("aaguid"),
    backedUp: boolean("backedUp").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt").notNull(),
    credentialID: text("credentialID").notNull(),
    deviceType: text("deviceType").notNull(),
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("publicKey").notNull(),
    transports: text("transports"),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("passkey_user_id_idx").on(table.userId),
    unique("passkey_credential_id_unique").on(table.credentialID),
  ]
);

export const member = pgTable(
  "member",
  {
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
    unique("member_organization_id_user_id_unique").on(
      table.organizationId,
      table.userId
    ),
  ]
);

export const invitation = pgTable(
  "invitation",
  {
    createdAt: timestamp("createdAt").notNull(),
    email: text("email").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    id: text("id").primaryKey(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

export const organizationDivision = pgTable(
  "organizationDivision",
  {
    createdAt: timestamp("createdAt").notNull(),
    description: text("description"),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("organization_division_organization_position_idx").on(
      table.organizationId,
      table.position
    ),
    unique("organization_division_organization_name_unique").on(
      table.organizationId,
      table.normalizedName
    ),
  ]
);

export const organizationDivisionMember = pgTable(
  "organizationDivisionMember",
  {
    createdAt: timestamp("createdAt").notNull(),
    divisionId: text("divisionId")
      .notNull()
      .references(() => organizationDivision.id, { onDelete: "cascade" }),
    id: text("id").primaryKey(),
    memberId: text("memberId")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("organization_division_member_division_id_idx").on(table.divisionId),
    index("organization_division_member_member_id_idx").on(table.memberId),
    unique("organization_division_member_division_member_unique").on(
      table.divisionId,
      table.memberId
    ),
  ]
);

export const mailbox = pgTable(
  "mailbox",
  {
    contentRevision: bigint("contentRevision", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("createdAt").notNull(),
    displayName: text("displayName"),
    divisionId: text("divisionId").references(() => organizationDivision.id, {
      onDelete: "set null",
    }),
    emailAddress: text("emailAddress").notNull(),
    id: text("id").primaryKey(),
    includeApiSentMessages: boolean("includeApiSentMessages")
      .notNull()
      .default(false),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    ownerUserId: text("ownerUserId").references(() => user.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").$type<PersistedMailboxProvider>().notNull(),
    signatureHtml: text("signatureHtml"),
    signatureText: text("signatureText"),
    status: text("status")
      .$type<MailboxConnectionStatus>()
      .notNull()
      .default("connected"),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_provider_ownership_check",
      sql`(
        (${table.provider} = 'gmail' and ${table.ownerUserId} is not null)
        or
        (${table.provider} = 'managed' and ${table.ownerUserId} is null and ${table.organizationId} is not null)
      )`
    ),
    check(
      "mailbox_provider_check",
      sql`${table.provider} in ('gmail', 'managed')`
    ),
    check(
      "mailbox_status_check",
      sql`${table.status} in ('connected', 'needs_reconnect')`
    ),
    index("mailbox_owner_user_id_idx").on(table.ownerUserId),
    index("mailbox_organization_id_idx").on(table.organizationId),
    index("mailbox_division_id_idx").on(table.divisionId),
    unique("mailbox_email_address_unique").on(table.emailAddress),
  ]
);

export const mailTemplate = pgTable(
  "mailTemplate",
  {
    bodyHtml: text("bodyHtml").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: text("organizationId").references(() => organization.id, {
      onDelete: "cascade",
    }),
    scope: text("scope").$type<MailTemplateScope>().notNull(),
    subject: text("subject").notNull().default(""),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "mail_template_scope_owner_check",
      sql`(
        (${table.scope} = 'personal' and ${table.userId} is not null and ${table.organizationId} is null)
        or
        (${table.scope} = 'team' and ${table.userId} is null and ${table.organizationId} is not null)
      )`
    ),
    check(
      "mail_template_scope_check",
      sql`${table.scope} in ('personal', 'team')`
    ),
    check(
      "mail_template_name_length_check",
      sql`char_length(${table.name}) between 1 and 120`
    ),
    check(
      "mail_template_subject_length_check",
      sql`char_length(${table.subject}) <= 998`
    ),
    check(
      "mail_template_body_length_check",
      sql`char_length(${table.bodyHtml}) <= 100000`
    ),
    index("mail_template_user_updated_idx").on(table.userId, table.updatedAt),
    index("mail_template_organization_updated_idx").on(
      table.organizationId,
      table.updatedAt
    ),
  ]
);

export const userAiContextEvent = pgTable(
  "userAiContextEvent",
  {
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    kind: text("kind").$type<UserAiContextEventKind>().notNull(),
    lastError: text("lastError"),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    mergedAt: timestamp("mergedAt"),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    processingAt: timestamp("processingAt"),
    skippedAt: timestamp("skippedAt"),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "user_ai_context_event_kind_check",
      sql`${table.kind} in ('auto_label_feedback', 'chat_discovery', 'explicit_preference', 'mail_action', 'sent_message', 'useful_detail_feedback')`
    ),
    index("user_ai_context_event_organization_merge_idx").on(
      table.organizationId,
      table.mergedAt,
      table.skippedAt,
      table.createdAt
    ),
    index("user_ai_context_event_user_merge_idx").on(
      table.userId,
      table.mergedAt,
      table.createdAt
    ),
    index("user_ai_context_event_mailbox_created_idx").on(
      table.mailboxId,
      table.createdAt
    ),
  ]
);

export const aiMemory = pgTable(
  "aiMemory",
  {
    archivedAt: timestamp("archivedAt"),
    confidence: doublePrecision("confidence").notNull().default(0.75),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    embeddedAt: timestamp("embeddedAt"),
    embedding: vector("embedding", {
      dimensions: AI_MEMORY_EMBEDDING_DIMENSIONS,
    }),
    expiresAt: timestamp("expiresAt"),
    id: text("id").primaryKey(),
    importance: integer("importance").notNull().default(3),
    key: text("key").notNull(),
    kind: text("kind").$type<AiMemoryKind>().notNull(),
    lastConfirmedAt: timestamp("lastConfirmedAt").notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    mailboxId: text("mailboxId").references(() => mailbox.id, {
      onDelete: "cascade",
    }),
    metadata: jsonb("metadata").$type<AiMemoryMetadata>().notNull().default({}),
    reinforcementCount: integer("reinforcementCount").notNull().default(1),
    scope: text("scope").$type<AiMemoryScope>().notNull(),
    scopeKey: text("scopeKey").notNull(),
    source: text("source").$type<AiMemorySource>().notNull(),
    sourceReference: text("sourceReference"),
    status: text("status").$type<AiMemoryStatus>().notNull().default("active"),
    summary: text("summary").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("ai_memory_scope_check", sql`${table.scope} in ('mailbox', 'user')`),
    check(
      "ai_memory_kind_check",
      sql`${table.kind} in ('instruction', 'learned')`
    ),
    check(
      "ai_memory_status_check",
      sql`${table.status} in ('active', 'archived')`
    ),
    check(
      "ai_memory_source_check",
      sql`${table.source} in ('explicit', 'feedback', 'inferred', 'migration')`
    ),
    check(
      "ai_memory_scope_owner_check",
      sql`(
        (${table.scope} = 'user' and ${table.userId} is not null and ${table.mailboxId} is null)
        or
        (${table.scope} = 'mailbox' and ${table.userId} is null and ${table.mailboxId} is not null)
      )`
    ),
    check(
      "ai_memory_key_length_check",
      sql`char_length(${table.key}) between 1 and 200`
    ),
    check(
      "ai_memory_content_length_check",
      sql`char_length(${table.content}) between 1 and 2000`
    ),
    check(
      "ai_memory_summary_length_check",
      sql`char_length(${table.summary}) between 1 and 300`
    ),
    check(
      "ai_memory_confidence_check",
      sql`${table.confidence} between 0 and 1`
    ),
    check(
      "ai_memory_importance_check",
      sql`${table.importance} between 1 and 5`
    ),
    check(
      "ai_memory_reinforcement_count_check",
      sql`${table.reinforcementCount} >= 1`
    ),
    index("ai_memory_user_status_updated_idx").on(
      table.userId,
      table.status,
      table.updatedAt
    ),
    index("ai_memory_mailbox_status_updated_idx").on(
      table.mailboxId,
      table.status,
      table.updatedAt
    ),
    index("ai_memory_expiration_idx").on(table.status, table.expiresAt),
    index("ai_memory_embedding_pending_idx")
      .on(table.scopeKey, table.updatedAt)
      .where(sql`${table.status} = 'active' and ${table.embedding} is null`),
    index("ai_memory_embedding_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .where(sql`${table.status} = 'active'`),
    unique("ai_memory_scope_key_memory_key_unique").on(
      table.scopeKey,
      table.key
    ),
  ]
);

/**
 * Retired. Memory embeddings live on `aiMemory.embedding`, so no external
 * index needs an outbox. The table is kept only so the expand deploy stays
 * safe; a contract migration drops it once every environment is past this
 * release.
 */
export const aiMemoryIndexJob = pgTable(
  "aiMemoryIndexJob",
  {
    attemptCount: integer("attemptCount").notNull().default(0),
    availableAt: timestamp("availableAt").notNull(),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    lastError: text("lastError"),
    memoryId: text("memoryId").notNull(),
    operation: text("operation").$type<AiMemoryIndexJobOperation>().notNull(),
    processingAt: timestamp("processingAt"),
    status: text("status").$type<AiMemoryIndexJobStatus>().notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "ai_memory_index_job_operation_check",
      sql`${table.operation} in ('delete', 'upsert')`
    ),
    check(
      "ai_memory_index_job_status_check",
      sql`${table.status} in ('completed', 'failed', 'pending', 'processing')`
    ),
    check(
      "ai_memory_index_job_attempt_count_check",
      sql`${table.attemptCount} >= 0`
    ),
    index("ai_memory_index_job_status_available_idx").on(
      table.status,
      table.availableAt
    ),
    unique("ai_memory_index_job_memory_unique").on(table.memoryId),
  ]
);

export const aiMemoryChangeSet = pgTable(
  "aiMemoryChangeSet",
  {
    changes: jsonb("changes").$type<AiMemoryChange[]>().notNull().default([]),
    createdAt: timestamp("createdAt").notNull(),
    error: text("error"),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId").references(() => mailbox.id, {
      onDelete: "cascade",
    }),
    request: text("request"),
    source: text("source").$type<AiMemoryChangeSetSource>().notNull(),
    sourceEventId: text("sourceEventId").references(
      () => userAiContextEvent.id,
      {
        onDelete: "set null",
      }
    ),
    status: text("status").$type<AiMemoryChangeSetStatus>().notNull(),
    summary: text("summary").notNull(),
    undoOfId: text("undoOfId").references(
      (): AnyPgColumn => aiMemoryChangeSet.id,
      {
        onDelete: "cascade",
      }
    ),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "ai_memory_change_set_source_check",
      sql`${table.source} in ('chat', 'feedback', 'migration', 'settings', 'system')`
    ),
    check(
      "ai_memory_change_set_status_check",
      sql`${table.status} in ('applied', 'failed', 'no_change')`
    ),
    check(
      "ai_memory_change_set_request_length_check",
      sql`char_length(${table.request}) <= 2000`
    ),
    check(
      "ai_memory_change_set_summary_length_check",
      sql`char_length(${table.summary}) <= 500`
    ),
    index("ai_memory_change_set_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
    index("ai_memory_change_set_mailbox_created_idx").on(
      table.mailboxId,
      table.createdAt
    ),
    uniqueIndex("ai_memory_change_set_undo_of_unique").on(table.undoOfId),
    unique("ai_memory_change_set_source_event_unique").on(table.sourceEventId),
  ]
);

export const aiMemoryScopeConfig = pgTable(
  "aiMemoryScopeConfig",
  {
    activeLearningEnabled: boolean("activeLearningEnabled")
      .notNull()
      .default(true),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    learningPrompt: text("learningPrompt").notNull().default(""),
    mailboxId: text("mailboxId").references(() => mailbox.id, {
      onDelete: "cascade",
    }),
    revision: integer("revision").notNull().default(1),
    scope: text("scope").$type<AiMemoryScope>().notNull(),
    scopeKey: text("scopeKey").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "ai_memory_scope_config_scope_check",
      sql`${table.scope} in ('mailbox', 'user')`
    ),
    check(
      "ai_memory_scope_config_owner_check",
      sql`(
        (${table.scope} = 'user' and ${table.userId} is not null and ${table.mailboxId} is null)
        or
        (${table.scope} = 'mailbox' and ${table.userId} is null and ${table.mailboxId} is not null)
      )`
    ),
    check(
      "ai_memory_scope_config_learning_prompt_length_check",
      sql`char_length(${table.learningPrompt}) <= 6000`
    ),
    unique("ai_memory_scope_config_scope_key_unique").on(table.scopeKey),
  ]
);

export const gmailCredential = pgTable(
  "gmailCredential",
  {
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    createdAt: timestamp("createdAt").notNull(),
    encryptedAccessToken: text("encryptedAccessToken"),
    encryptedRefreshToken: text("encryptedRefreshToken"),
    googleSubject: text("googleSubject").notNull(),
    mailboxId: text("mailboxId")
      .primaryKey()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    unique("gmail_credential_google_subject_unique").on(table.googleSubject),
  ]
);

export const connectorCredential = pgTable(
  "connectorCredential",
  {
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    accountEmail: text("accountEmail"),
    createdAt: timestamp("createdAt").notNull(),
    displayName: text("displayName"),
    encryptedAccessToken: text("encryptedAccessToken"),
    encryptedRefreshToken: text("encryptedRefreshToken"),
    id: text("id").primaryKey(),
    metadata: jsonb("metadata").$type<MailboxActionJsonObject>(),
    provider: text("provider").$type<ConnectorProvider>().notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    providerWorkspaceId: text("providerWorkspaceId"),
    providerWorkspaceName: text("providerWorkspaceName"),
    scopes: text("scopes").notNull(),
    status: text("status")
      .$type<ConnectorConnectionStatus>()
      .notNull()
      .default("connected"),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "connector_credential_provider_check",
      sql`${table.provider} in ('google_calendar', 'linear')`
    ),
    check(
      "connector_credential_status_check",
      sql`${table.status} in ('connected', 'needs_reconnect')`
    ),
    index("connector_credential_user_id_idx").on(table.userId),
    index("connector_credential_user_provider_idx").on(
      table.userId,
      table.provider
    ),
    unique("connector_credential_user_provider_account_unique").on(
      table.userId,
      table.provider,
      table.providerAccountId
    ),
  ]
);

export const gmailLabel = pgTable(
  "gmailLabel",
  {
    color: text("color").notNull().default("gray"),
    createdAt: timestamp("createdAt").notNull(),
    description: text("description"),
    inclusionCriteria: text("inclusionCriteria"),
    labelId: text("labelId").notNull(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("gmail_label_mailbox_id_idx").on(table.mailboxId),
    unique("gmail_label_mailbox_id_label_id_unique").on(
      table.mailboxId,
      table.labelId
    ),
  ]
);

export const gmailWatchState = pgTable(
  "gmailWatchState",
  {
    createdAt: timestamp("createdAt").notNull(),
    historyId: text("historyId"),
    historyPageToken: text("historyPageToken"),
    lastError: text("lastError"),
    lastErrorAt: timestamp("lastErrorAt"),
    lastNotificationAt: timestamp("lastNotificationAt"),
    lastProcessedAt: timestamp("lastProcessedAt"),
    lastReconciledAt: timestamp("lastReconciledAt"),
    mailboxId: text("mailboxId")
      .primaryKey()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    processingLeaseExpiresAt: timestamp("processingLeaseExpiresAt"),
    processingLeaseId: text("processingLeaseId"),
    recoveryAfter: timestamp("recoveryAfter"),
    recoveryBefore: timestamp("recoveryBefore"),
    recoveryPageToken: text("recoveryPageToken"),
    updatedAt: timestamp("updatedAt").notNull(),
    watchExpirationAt: timestamp("watchExpirationAt"),
    watchRenewedAt: timestamp("watchRenewedAt"),
  },
  (table) => [
    index("gmail_watch_state_watch_expiration_at_idx").on(
      table.watchExpirationAt
    ),
    index("gmail_watch_state_processing_lease_expires_at_idx").on(
      table.processingLeaseExpiresAt
    ),
  ]
);

export const gmailAutoLabelSettings = pgTable("gmailAutoLabelSettings", {
  createdAt: timestamp("createdAt").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  mailboxId: text("mailboxId")
    .primaryKey()
    .references(() => mailbox.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const gmailAutoLabelEvent = pgTable(
  "gmailAutoLabelEvent",
  {
    appliedAt: timestamp("appliedAt"),
    attemptCount: integer("attemptCount").notNull().default(0),
    cacheWriteTokens: integer("cacheWriteTokens"),
    cachedTokens: integer("cachedTokens"),
    completionTokens: integer("completionTokens"),
    costUsd: doublePrecision("costUsd"),
    createdAt: timestamp("createdAt").notNull(),
    gmailMessageId: text("gmailMessageId").notNull(),
    id: text("id").primaryKey(),
    labelIds: jsonb("labelIds").$type<string[]>(),
    lastError: text("lastError"),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    model: text("model"),
    nextAttemptAt: timestamp("nextAttemptAt"),
    promptTokens: integer("promptTokens"),
    updatedAt: timestamp("updatedAt").notNull(),
    usageReportedAt: timestamp("usageReportedAt"),
  },
  (table) => [
    index("gmail_auto_label_event_mailbox_created_at_idx").on(
      table.mailboxId,
      table.createdAt
    ),
    index("gmail_auto_label_event_mailbox_retry_idx").on(
      table.mailboxId,
      table.appliedAt,
      table.nextAttemptAt
    ),
    unique("gmail_auto_label_event_mailbox_message_unique").on(
      table.mailboxId,
      table.gmailMessageId
    ),
  ]
);

export const gmailUsefulDetailSettings = pgTable("gmailUsefulDetailSettings", {
  createdAt: timestamp("createdAt").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  mailboxId: text("mailboxId")
    .primaryKey()
    .references(() => mailbox.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const gmailUsefulDetailEvent = pgTable(
  "gmailUsefulDetailEvent",
  {
    attemptCount: integer("attemptCount").notNull().default(0),
    cacheWriteTokens: integer("cacheWriteTokens"),
    cachedTokens: integer("cachedTokens"),
    completionTokens: integer("completionTokens"),
    costUsd: doublePrecision("costUsd"),
    createdAt: timestamp("createdAt").notNull(),
    gmailMessageId: text("gmailMessageId").notNull(),
    id: text("id").primaryKey(),
    lastError: text("lastError"),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    model: text("model"),
    nextAttemptAt: timestamp("nextAttemptAt"),
    processedAt: timestamp("processedAt"),
    promptTokens: integer("promptTokens"),
    updatedAt: timestamp("updatedAt").notNull(),
    usageReportedAt: timestamp("usageReportedAt"),
  },
  (table) => [
    index("gmail_useful_detail_event_mailbox_created_at_idx").on(
      table.mailboxId,
      table.createdAt
    ),
    index("gmail_useful_detail_event_mailbox_retry_idx").on(
      table.mailboxId,
      table.processedAt,
      table.nextAttemptAt
    ),
    unique("gmail_useful_detail_event_mailbox_message_unique").on(
      table.mailboxId,
      table.gmailMessageId
    ),
  ]
);

export const gmailUsefulDetail = pgTable(
  "gmailUsefulDetail",
  {
    carrier: text("carrier"),
    createdAt: timestamp("createdAt").notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    deliveryStatus: text("deliveryStatus").$type<GmailDeliveryStatus>(),
    dismissedAt: timestamp("dismissedAt"),
    encryptedCode: text("encryptedCode"),
    eventAt: timestamp("eventAt"),
    expectedAt: timestamp("expectedAt"),
    expiresAt: timestamp("expiresAt").notNull(),
    gmailMessageId: text("gmailMessageId").notNull(),
    gmailThreadId: text("gmailThreadId"),
    id: text("id").primaryKey(),
    kind: text("kind").$type<GmailUsefulDetailKind>().notNull(),
    location: text("location"),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    receivedAt: timestamp("receivedAt").notNull(),
    reference: text("reference"),
    relevanceSource: text("relevanceSource")
      .$type<GmailUsefulDetailRelevanceSource>()
      .notNull(),
    relevantFrom: timestamp("relevantFrom").notNull(),
    source: text("source"),
    summary: text("summary"),
    title: text("title").notNull(),
    trackingNumber: text("trackingNumber"),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "gmail_useful_detail_kind_check",
      sql`${table.kind} in ('application', 'appointment', 'bill', 'delivery', 'document_expiry', 'reservation', 'return', 'security_alert', 'task', 'travel', 'verification_code')`
    ),
    check(
      "gmail_useful_detail_relevance_source_check",
      sql`${table.relevanceSource} in ('explicit', 'inferred')`
    ),
    check(
      "gmail_useful_detail_delivery_status_check",
      sql`${table.deliveryStatus} is null or ${table.deliveryStatus} in ('delayed', 'delivered', 'in_transit', 'ordered', 'out_for_delivery', 'ready_for_pickup', 'shipped', 'unknown')`
    ),
    check(
      "gmail_useful_detail_payload_check",
      sql`(
        (${table.kind} = 'verification_code' and ${table.encryptedCode} is not null and ${table.deliveryStatus} is null)
        or
        (${table.kind} = 'delivery' and ${table.encryptedCode} is null and ${table.deliveryStatus} is not null)
        or
        (${table.kind} not in ('delivery', 'verification_code') and ${table.encryptedCode} is null and ${table.deliveryStatus} is null)
      )`
    ),
    index("gmail_useful_detail_mailbox_active_idx").on(
      table.mailboxId,
      table.dismissedAt,
      table.expiresAt
    ),
    unique("gmail_useful_detail_mailbox_kind_dedupe_unique").on(
      table.mailboxId,
      table.kind,
      table.dedupeKey
    ),
  ]
);

export const gmailUsefulDetailFeedback = pgTable(
  "gmailUsefulDetailFeedback",
  {
    createdAt: timestamp("createdAt").notNull(),
    detailId: text("detailId").notNull(),
    id: text("id").primaryKey(),
    kind: text("kind").$type<GmailUsefulDetailKind>().notNull(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    signal: text("signal").$type<GmailUsefulDetailFeedbackSignal>().notNull(),
    source: text("source"),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "gmail_useful_detail_feedback_signal_check",
      sql`${table.signal} in ('not_useful', 'useful')`
    ),
    index("gmail_useful_detail_feedback_profile_idx").on(
      table.mailboxId,
      table.source,
      table.kind,
      table.signal
    ),
    unique("gmail_useful_detail_feedback_mailbox_detail_unique").on(
      table.mailboxId,
      table.detailId
    ),
  ]
);

export const mailboxAutomationSettings = pgTable("mailboxAutomationSettings", {
  autoLabelEnabled: boolean("autoLabelEnabled").notNull().default(false),
  createdAt: timestamp("createdAt").notNull(),
  mailboxId: text("mailboxId")
    .primaryKey()
    .references(() => mailbox.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updatedAt").notNull(),
  usefulDetailsEnabled: boolean("usefulDetailsEnabled")
    .notNull()
    .default(false),
});

export const mailboxAction = pgTable(
  "mailboxAction",
  {
    createdAt: timestamp("createdAt").notNull(),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    draftRevisionId: text("draftRevisionId"),
    enabled: boolean("enabled").notNull().default(false),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    publishedRevisionId: text("publishedRevisionId"),
    status: text("status")
      .$type<MailboxActionStatus>()
      .notNull()
      .default("ready"),
    statusReason: text("statusReason"),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_action_status_check",
      sql`${table.status} in ('ready', 'needs_attention')`
    ),
    index("mailbox_action_mailbox_id_idx").on(table.mailboxId),
    index("mailbox_action_organization_id_idx").on(table.organizationId),
    index("mailbox_action_published_enabled_idx").on(
      table.mailboxId,
      table.enabled,
      table.publishedRevisionId
    ),
  ]
);

export const mailboxActionRevision = pgTable(
  "mailboxActionRevision",
  {
    actionId: text("actionId")
      .notNull()
      .references(() => mailboxAction.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").notNull(),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    graph: jsonb("graph").$type<MailboxActionGraph>().notNull(),
    id: text("id").primaryKey(),
    revisionNumber: integer("revisionNumber").notNull(),
    validationErrors: jsonb("validationErrors")
      .$type<string[]>()
      .notNull()
      .default([]),
    validationStatus: text("validationStatus")
      .$type<MailboxActionRevisionValidationStatus>()
      .notNull()
      .default("invalid"),
  },
  (table) => [
    check(
      "mailbox_action_revision_validation_status_check",
      sql`${table.validationStatus} in ('valid', 'invalid')`
    ),
    index("mailbox_action_revision_action_id_idx").on(table.actionId),
    unique("mailbox_action_revision_action_number_unique").on(
      table.actionId,
      table.revisionNumber
    ),
  ]
);

export const mailboxActionRun = pgTable(
  "mailboxActionRun",
  {
    actionId: text("actionId")
      .notNull()
      .references(() => mailboxAction.id, { onDelete: "cascade" }),
    attempts: integer("attempts").notNull().default(0),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    id: text("id").primaryKey(),
    lastError: text("lastError"),
    leasedUntil: timestamp("leasedUntil"),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    revisionId: text("revisionId")
      .notNull()
      .references(() => mailboxActionRevision.id, { onDelete: "cascade" }),
    sourceMessageId: text("sourceMessageId").notNull(),
    sourceThreadId: text("sourceThreadId"),
    startedAt: timestamp("startedAt"),
    status: text("status")
      .$type<MailboxActionRunStatus>()
      .notNull()
      .default("queued"),
    triggerNodeId: text("triggerNodeId").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_action_run_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_attention', 'needs_review')`
    ),
    index("mailbox_action_run_action_created_idx").on(
      table.actionId,
      table.createdAt
    ),
    index("mailbox_action_run_mailbox_created_idx").on(
      table.mailboxId,
      table.createdAt
    ),
    index("mailbox_action_run_status_lease_idx").on(
      table.status,
      table.leasedUntil
    ),
    unique("mailbox_action_run_dedupe_key_unique").on(table.dedupeKey),
  ]
);

export const mailboxActionRunFrame = pgTable(
  "mailboxActionRunFrame",
  {
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    mergeState: jsonb("mergeState").$type<MailboxActionJsonObject>(),
    parentFrameId: text("parentFrameId"),
    path: jsonb("path").$type<string[]>().notNull().default([]),
    runId: text("runId")
      .notNull()
      .references(() => mailboxActionRun.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<MailboxActionRunStatus>()
      .notNull()
      .default("running"),
    updatedAt: timestamp("updatedAt").notNull(),
    variables: jsonb("variables")
      .$type<MailboxActionJsonObject>()
      .notNull()
      .default({}),
  },
  (table) => [
    check(
      "mailbox_action_run_frame_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_attention', 'needs_review')`
    ),
    index("mailbox_action_run_frame_run_id_idx").on(table.runId),
  ]
);

export const mailboxActionStepRun = pgTable(
  "mailboxActionStepRun",
  {
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull(),
    error: text("error"),
    frameId: text("frameId").references(() => mailboxActionRunFrame.id, {
      onDelete: "set null",
    }),
    id: text("id").primaryKey(),
    input: jsonb("input")
      .$type<MailboxActionJsonObject>()
      .notNull()
      .default({}),
    model: text("model"),
    nodeId: text("nodeId").notNull(),
    nodeType: text("nodeType").notNull(),
    output: jsonb("output").$type<MailboxActionJsonObject>(),
    runId: text("runId")
      .notNull()
      .references(() => mailboxActionRun.id, { onDelete: "cascade" }),
    startedAt: timestamp("startedAt"),
    status: text("status")
      .$type<MailboxActionStepStatus>()
      .notNull()
      .default("queued"),
    toolCalls: jsonb("toolCalls").$type<MailboxActionJsonObject[]>(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_action_step_run_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_review')`
    ),
    index("mailbox_action_step_run_run_id_idx").on(table.runId),
    index("mailbox_action_step_run_frame_id_idx").on(table.frameId),
  ]
);

export const mailboxActionExternalEffect = pgTable(
  "mailboxActionExternalEffect",
  {
    actionId: text("actionId")
      .notNull()
      .references(() => mailboxAction.id, { onDelete: "cascade" }),
    connectorCredentialId: text("connectorCredentialId").references(
      () => connectorCredential.id,
      {
        onDelete: "set null",
      }
    ),
    createdAt: timestamp("createdAt").notNull(),
    externalId: text("externalId").notNull(),
    externalUrl: text("externalUrl"),
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotencyKey").notNull(),
    metadata: jsonb("metadata").$type<MailboxActionJsonObject>(),
    provider: text("provider").$type<MailboxActionExternalProvider>().notNull(),
    revisionId: text("revisionId")
      .notNull()
      .references(() => mailboxActionRevision.id, { onDelete: "cascade" }),
    runId: text("runId")
      .notNull()
      .references(() => mailboxActionRun.id, { onDelete: "cascade" }),
    stepRunId: text("stepRunId").references(() => mailboxActionStepRun.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "mailbox_action_external_effect_provider_check",
      sql`${table.provider} in ('google_calendar', 'linear')`
    ),
    index("mailbox_action_external_effect_action_created_idx").on(
      table.actionId,
      table.createdAt
    ),
    index("mailbox_action_external_effect_run_id_idx").on(table.runId),
    unique("mailbox_action_external_effect_idempotency_unique").on(
      table.idempotencyKey
    ),
  ]
);

export const mailAutomationMemoryProfile = pgTable(
  "mailAutomationMemoryProfile",
  {
    agent: text("agent").$type<MailAutomationAgent>().notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    lastMergedAt: timestamp("lastMergedAt").notNull(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    profile: jsonb("profile").$type<unknown>().notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mail_automation_memory_profile_agent_check",
      sql`${table.agent} in ('auto_label', 'useful_detail')`
    ),
    index("mail_automation_memory_profile_mailbox_agent_idx").on(
      table.mailboxId,
      table.agent
    ),
    unique("mail_automation_memory_profile_mailbox_agent_unique").on(
      table.mailboxId,
      table.agent
    ),
  ]
);

export const mailAutoLabelFeedback = pgTable(
  "mailAutoLabelFeedback",
  {
    createdAt: timestamp("createdAt").notNull(),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    id: text("id").primaryKey(),
    labelId: text("labelId").notNull(),
    labelName: text("labelName"),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    provider: text("provider").$type<PersistedMailboxProvider>().notNull(),
    providerMessageId: text("providerMessageId").notNull(),
    signal: text("signal").$type<MailAutoLabelFeedbackSignal>().notNull(),
    source: text("source"),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mail_auto_label_feedback_provider_check",
      sql`${table.provider} in ('gmail', 'managed')`
    ),
    check(
      "mail_auto_label_feedback_signal_check",
      sql`${table.signal} in ('added', 'removed')`
    ),
    index("mail_auto_label_feedback_profile_idx").on(
      table.mailboxId,
      table.labelId,
      table.source,
      table.signal
    ),
    index("mail_auto_label_feedback_mailbox_updated_idx").on(
      table.mailboxId,
      table.updatedAt.desc()
    ),
    unique("mail_auto_label_feedback_message_label_unique").on(
      table.mailboxId,
      table.providerMessageId,
      table.labelId
    ),
  ]
);

export const gmailOAuthState = pgTable(
  "gmailOAuthState",
  {
    codeVerifier: text("codeVerifier").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId").references(() => mailbox.id, {
      onDelete: "cascade",
    }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    returnTo: text("returnTo").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("gmail_oauth_state_user_id_idx").on(table.userId),
    index("gmail_oauth_state_expires_at_idx").on(table.expiresAt),
  ]
);

export const connectorOAuthState = pgTable(
  "connectorOAuthState",
  {
    codeVerifier: text("codeVerifier").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    id: text("id").primaryKey(),
    provider: text("provider").$type<ConnectorProvider>().notNull(),
    returnTo: text("returnTo").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "connector_oauth_state_provider_check",
      sql`${table.provider} in ('google_calendar', 'linear')`
    ),
    index("connector_oauth_state_user_id_idx").on(table.userId),
    index("connector_oauth_state_expires_at_idx").on(table.expiresAt),
  ]
);

export const mailboxGrant = pgTable(
  "mailboxGrant",
  {
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    role: text("role").$type<MailboxGrantRole>().notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "mailbox_grant_role_check",
      sql`${table.role} in ('reader', 'responder', 'manager')`
    ),
    index("mailbox_grant_mailbox_id_idx").on(table.mailboxId),
    index("mailbox_grant_user_id_idx").on(table.userId),
    unique("mailbox_grant_mailbox_id_user_id_unique").on(
      table.mailboxId,
      table.userId
    ),
  ]
);

export const mailboxDivisionGrant = pgTable(
  "mailboxDivisionGrant",
  {
    createdAt: timestamp("createdAt").notNull(),
    divisionId: text("divisionId")
      .notNull()
      .references(() => organizationDivision.id, { onDelete: "cascade" }),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    role: text("role").$type<MailboxGrantRole>().notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "mailbox_division_grant_role_check",
      sql`${table.role} in ('reader', 'responder', 'manager')`
    ),
    index("mailbox_division_grant_mailbox_id_idx").on(table.mailboxId),
    index("mailbox_division_grant_division_id_idx").on(table.divisionId),
    unique("mailbox_division_grant_mailbox_division_unique").on(
      table.mailboxId,
      table.divisionId
    ),
  ]
);

export const managedMailMessage = pgTable(
  "managedMailMessage",
  {
    bcc: text("bcc"),
    bccNormalized: text("bccNormalized").notNull().default(""),
    bodyHtml: text("bodyHtml"),
    bodyText: text("bodyText"),
    cc: text("cc"),
    ccNormalized: text("ccNormalized").notNull().default(""),
    createdAt: timestamp("createdAt").notNull(),
    direction: text("direction").$type<ManagedMailDirection>().notNull(),
    from: text("from").notNull(),
    fromNormalized: text("fromNormalized").notNull().default(""),
    headers: jsonb("headers")
      .$type<ManagedMailHeader[]>()
      .notNull()
      .default([]),
    id: text("id").primaryKey(),
    inReplyTo: text("inReplyTo"),
    isRead: boolean("isRead").notNull().default(false),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    mailboxState: text("mailboxState")
      .$type<ManagedMailMailboxState>()
      .notNull()
      .default("active"),
    messageHeaderId: text("messageHeaderId"),
    providerMessageId: text("providerMessageId").notNull(),
    rawObjectBucket: text("rawObjectBucket"),
    rawObjectKey: text("rawObjectKey"),
    rawObjectProvider:
      text("rawObjectProvider").$type<ManagedMailRawObjectProvider>(),
    rawSizeBytes: integer("rawSizeBytes"),
    references: text("references"),
    replyTo: text("replyTo"),
    s3Bucket: text("s3Bucket"),
    s3Key: text("s3Key"),
    searchText: text("searchText").notNull().default(""),
    sentAt: timestamp("sentAt").notNull(),
    snippet: text("snippet"),
    subject: text("subject"),
    threadId: text("threadId").notNull(),
    to: text("to"),
    toNormalized: text("toNormalized").notNull().default(""),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "managed_mail_message_direction_check",
      sql`${table.direction} in ('inbound', 'outbound')`
    ),
    check(
      "managed_mail_message_mailbox_state_check",
      sql`${table.mailboxState} in ('active', 'archived', 'draft', 'spam', 'trash')`
    ),
    check(
      "managed_mail_message_raw_object_provider_check",
      sql`${table.rawObjectProvider} is null or ${table.rawObjectProvider} in ('r2', 's3')`
    ),
    index("managed_mail_message_mailbox_direction_sent_at_idx").on(
      table.mailboxId,
      table.direction,
      table.sentAt
    ),
    index("managed_mail_message_mailbox_state_sent_at_idx").on(
      table.mailboxId,
      table.mailboxState,
      table.sentAt
    ),
    index("managed_mail_message_mailbox_thread_id_idx").on(
      table.mailboxId,
      table.threadId
    ),
    index("managed_mail_message_mailbox_state_direction_thread_sent_id_idx").on(
      table.mailboxId,
      table.mailboxState,
      table.direction,
      table.threadId,
      table.sentAt,
      table.id
    ),
    index("managed_mail_message_mailbox_unread_thread_sent_id_idx")
      .on(table.mailboxId, table.threadId, table.sentAt, table.id)
      .where(
        sql`${table.mailboxState} = 'active' and ${table.direction} = 'inbound' and ${table.isRead} = false`
      ),
    index("managed_mail_message_mailbox_from_normalized_idx").on(
      table.mailboxId,
      table.fromNormalized
    ),
    index("managed_mail_message_mailbox_sent_at_id_idx").on(
      table.mailboxId,
      table.sentAt,
      table.id
    ),
    index("managed_mail_message_raw_object_idx").on(
      table.rawObjectProvider,
      table.rawObjectBucket,
      table.rawObjectKey
    ),
    index("managed_mail_message_s3_bucket_key_idx").on(
      table.s3Bucket,
      table.s3Key
    ),
    unique("managed_mail_message_mailbox_provider_message_unique").on(
      table.mailboxId,
      table.providerMessageId
    ),
  ]
);

export const organizationApiMailMessage = pgTable(
  "organizationApiMailMessage",
  {
    bcc: text("bcc"),
    bccNormalized: text("bccNormalized").notNull().default(""),
    bodyHtml: text("bodyHtml"),
    bodyText: text("bodyText"),
    cc: text("cc"),
    ccNormalized: text("ccNormalized").notNull().default(""),
    createdAt: timestamp("createdAt").notNull(),
    from: text("from").notNull(),
    fromNormalized: text("fromNormalized").notNull().default(""),
    headers: jsonb("headers")
      .$type<OrganizationApiMailHeader[]>()
      .notNull()
      .default([]),
    id: text("id").primaryKey(),
    messageHeaderId: text("messageHeaderId"),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerMessageId: text("providerMessageId").notNull(),
    rawSizeBytes: integer("rawSizeBytes"),
    replyTo: text("replyTo"),
    searchText: text("searchText").notNull().default(""),
    senderAddress: text("senderAddress").notNull(),
    sentAt: timestamp("sentAt").notNull(),
    snippet: text("snippet"),
    subject: text("subject"),
    to: text("to"),
    toNormalized: text("toNormalized").notNull().default(""),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("organization_api_mail_message_org_sent_at_idx").on(
      table.organizationId,
      table.sentAt,
      table.id
    ),
    index("organization_api_mail_message_org_sender_idx").on(
      table.organizationId,
      table.senderAddress
    ),
    unique("organization_api_mail_message_org_provider_unique").on(
      table.organizationId,
      table.providerMessageId
    ),
  ]
);

export const organizationApiMailAttachment = pgTable(
  "organizationApiMailAttachment",
  {
    contentId: text("contentId"),
    createdAt: timestamp("createdAt").notNull(),
    fileName: text("fileName").notNull(),
    id: text("id").primaryKey(),
    inline: boolean("inline").notNull().default(false),
    messageId: text("messageId")
      .notNull()
      .references(() => organizationApiMailMessage.id, { onDelete: "cascade" }),
    mimeType: text("mimeType").notNull(),
    normalizedFileName: text("normalizedFileName").notNull().default(""),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    size: integer("size").notNull(),
  },
  (table) => [
    index("organization_api_mail_attachment_org_name_idx").on(
      table.organizationId,
      table.normalizedFileName
    ),
    index("organization_api_mail_attachment_message_idx").on(table.messageId),
  ]
);

export const organizationMailDeliveryEvent = pgTable(
  "organizationMailDeliveryEvent",
  {
    createdAt: timestamp("createdAt").notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    diagnosticCode: text("diagnosticCode"),
    eventType: text("eventType")
      .$type<OrganizationMailDeliveryEventType>()
      .notNull(),
    id: text("id").primaryKey(),
    occurredAt: timestamp("occurredAt").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerMessageId: text("providerMessageId").notNull(),
    providerStatus: text("providerStatus"),
    reason: text("reason"),
    recipient: text("recipient").notNull(),
  },
  (table) => [
    check(
      "organization_mail_delivery_event_type_check",
      sql`${table.eventType} in ('bounced', 'complained', 'delayed', 'delivered', 'rejected', 'sent')`
    ),
    index("organization_mail_delivery_event_message_idx").on(
      table.organizationId,
      table.providerMessageId,
      table.occurredAt
    ),
    index("organization_mail_delivery_event_recipient_idx").on(
      table.organizationId,
      table.recipient,
      table.occurredAt
    ),
    unique("organization_mail_delivery_event_dedupe_key_unique").on(
      table.dedupeKey
    ),
  ]
);

export const organizationMailDeliveryRecipient = pgTable(
  "organizationMailDeliveryRecipient",
  {
    createdAt: timestamp("createdAt").notNull(),
    lastEventAt: timestamp("lastEventAt").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerMessageId: text("providerMessageId").notNull(),
    recipient: text("recipient").notNull(),
    status: text("status").$type<OrganizationMailDeliveryStatus>().notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "organization_mail_delivery_recipient_status_check",
      sql`${table.status} in ('bounced', 'complained', 'delayed', 'delivered', 'rejected', 'sent')`
    ),
    index("organization_mail_delivery_recipient_message_idx").on(
      table.organizationId,
      table.providerMessageId
    ),
    index("organization_mail_delivery_recipient_status_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt
    ),
    primaryKey({
      columns: [table.organizationId, table.providerMessageId, table.recipient],
      name: "organization_mail_delivery_recipient_pk",
    }),
  ]
);

export const organizationMailRecipientSuppression = pgTable(
  "organizationMailRecipientSuppression",
  {
    createdAt: timestamp("createdAt").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    reason: text("reason").$type<OrganizationMailSuppressionReason>().notNull(),
    recipient: text("recipient").notNull(),
    revokedAt: timestamp("revokedAt"),
    sourceProviderMessageId: text("sourceProviderMessageId").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "organization_mail_recipient_suppression_reason_check",
      sql`${table.reason} in ('bounce', 'complaint')`
    ),
    index("organization_mail_recipient_suppression_active_idx")
      .on(table.organizationId, table.recipient)
      .where(sql`${table.revokedAt} is null`),
    primaryKey({
      columns: [table.organizationId, table.recipient],
      name: "organization_mail_recipient_suppression_pk",
    }),
  ]
);

export const managedMailLabel = pgTable(
  "managedMailLabel",
  {
    color: text("color").notNull().default("gray"),
    createdAt: timestamp("createdAt").notNull(),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    position: integer("position").notNull().default(0),
    updatedAt: timestamp("updatedAt").notNull(),
    updatedByUserId: text("updatedByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    visible: boolean("visible").notNull().default(true),
  },
  (table) => [
    index("managed_mail_label_mailbox_position_idx").on(
      table.mailboxId,
      table.position
    ),
    unique("managed_mail_label_mailbox_normalized_name_unique").on(
      table.mailboxId,
      table.normalizedName
    ),
  ]
);

export const managedMailSavedView = pgTable(
  "managedMailSavedView",
  {
    color: text("color"),
    createdAt: timestamp("createdAt").notNull(),
    disabledReason: text("disabledReason"),
    icon: text("icon"),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    ownerUserId: text("ownerUserId").references(() => user.id, {
      onDelete: "cascade",
    }),
    position: integer("position").notNull().default(0),
    search: jsonb("search").$type<unknown>().notNull(),
    sort: text("sort")
      .$type<ManagedMailSavedViewSort>()
      .notNull()
      .default("newest"),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "managed_mail_saved_view_sort_check",
      sql`${table.sort} in ('newest', 'oldest', 'relevance')`
    ),
    index("managed_mail_saved_view_mailbox_owner_position_idx").on(
      table.mailboxId,
      table.ownerUserId,
      table.position
    ),
    uniqueIndex("managed_mail_saved_view_shared_name_unique")
      .on(table.mailboxId, table.normalizedName)
      .where(sql`${table.ownerUserId} is null`),
    uniqueIndex("managed_mail_saved_view_personal_name_unique")
      .on(table.mailboxId, table.ownerUserId, table.normalizedName)
      .where(sql`${table.ownerUserId} is not null`),
  ]
);

export const managedMailRule = pgTable(
  "managedMailRule",
  {
    actions: jsonb("actions").$type<unknown[]>(),
    conditionGroups: jsonb("conditionGroups").$type<unknown[]>(),
    createdAt: timestamp("createdAt").notNull(),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").notNull().default(true),
    id: text("id").primaryKey(),
    labelIds: jsonb("labelIds").$type<string[]>().notNull(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    matchMode: text("matchMode")
      .$type<ManagedMailRuleMatchMode>()
      .notNull()
      .default("all"),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    priority: integer("priority").notNull().default(0),
    search: jsonb("search").$type<unknown>().notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    updatedByUserId: text("updatedByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "managed_mail_rule_match_mode_check",
      sql`${table.matchMode} in ('all', 'any')`
    ),
    index("managed_mail_rule_mailbox_enabled_priority_idx").on(
      table.mailboxId,
      table.enabled,
      table.priority
    ),
    unique("managed_mail_rule_mailbox_normalized_name_unique").on(
      table.mailboxId,
      table.normalizedName
    ),
  ]
);

export const managedMailMessageLabel = pgTable(
  "managedMailMessageLabel",
  {
    assignedByUserId: text("assignedByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    labelId: text("labelId")
      .notNull()
      .references(() => managedMailLabel.id, { onDelete: "cascade" }),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    messageId: text("messageId")
      .notNull()
      .references(() => managedMailMessage.id, { onDelete: "cascade" }),
    ruleId: text("ruleId").references(() => managedMailRule.id, {
      onDelete: "set null",
    }),
    source: text("source").$type<ManagedMailLabelAssignmentSource>().notNull(),
  },
  (table) => [
    check(
      "managed_mail_message_label_source_check",
      sql`${table.source} in ('manual', 'rule', 'inherited', 'backfill', 'ai_auto_label')`
    ),
    index("managed_mail_message_label_mailbox_label_idx").on(
      table.mailboxId,
      table.labelId
    ),
    index("managed_mail_message_label_message_idx").on(table.messageId),
    unique("managed_mail_message_label_message_label_unique").on(
      table.messageId,
      table.labelId
    ),
  ]
);

export const managedMailAttachment = pgTable(
  "managedMailAttachment",
  {
    contentId: text("contentId"),
    createdAt: timestamp("createdAt").notNull(),
    fileName: text("fileName").notNull(),
    id: text("id").primaryKey(),
    inline: boolean("inline").notNull().default(false),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    messageId: text("messageId")
      .notNull()
      .references(() => managedMailMessage.id, { onDelete: "cascade" }),
    mimeType: text("mimeType").notNull(),
    normalizedFileName: text("normalizedFileName").notNull(),
    size: integer("size").notNull(),
  },
  (table) => [
    index("managed_mail_attachment_mailbox_name_idx").on(
      table.mailboxId,
      table.normalizedFileName
    ),
    index("managed_mail_attachment_message_idx").on(table.messageId),
  ]
);

export const managedMailRuleApplication = pgTable(
  "managedMailRuleApplication",
  {
    actionResults: jsonb("actionResults").$type<unknown[]>(),
    appliedAt: timestamp("appliedAt"),
    createdAt: timestamp("createdAt").notNull(),
    error: text("error"),
    explanation: text("explanation"),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    matched: boolean("matched").notNull(),
    messageId: text("messageId")
      .notNull()
      .references(() => managedMailMessage.id, { onDelete: "cascade" }),
    ruleId: text("ruleId")
      .notNull()
      .references(() => managedMailRule.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("managed_mail_rule_application_mailbox_created_idx").on(
      table.mailboxId,
      table.createdAt
    ),
    unique("managed_mail_rule_application_rule_message_unique").on(
      table.ruleId,
      table.messageId
    ),
  ]
);

export const managedMailRuleBackfill = pgTable(
  "managedMailRuleBackfill",
  {
    cancelledAt: timestamp("cancelledAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull(),
    cursor: text("cursor"),
    errorCount: integer("errorCount").notNull().default(0),
    id: text("id").primaryKey(),
    lastError: text("lastError"),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    matchedCount: integer("matchedCount").notNull().default(0),
    processedCount: integer("processedCount").notNull().default(0),
    ruleId: text("ruleId")
      .notNull()
      .references(() => managedMailRule.id, { onDelete: "cascade" }),
    startedAt: timestamp("startedAt"),
    status: text("status")
      .$type<ManagedMailRuleBackfillStatus>()
      .notNull()
      .default("pending"),
    updatedAt: timestamp("updatedAt").notNull(),
    updatedCount: integer("updatedCount").notNull().default(0),
  },
  (table) => [
    check(
      "managed_mail_rule_backfill_status_check",
      sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'cancelled')`
    ),
    index("managed_mail_rule_backfill_rule_status_idx").on(
      table.ruleId,
      table.status
    ),
  ]
);

export const mailDomain = pgTable(
  "mailDomain",
  {
    catchAllMailboxId: text("catchAllMailboxId").references(() => mailbox.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").notNull(),
    domain: text("domain").notNull(),
    id: text("id").primaryKey(),
    lastCheckResult: jsonb("lastCheckResult").$type<MailDomainCheckResult>(),
    mailFromDomain: text("mailFromDomain").notNull(),
    mode: text("mode")
      .$type<MailDomainMode>()
      .notNull()
      .default("send_and_receive"),
    modeUpdatedAt: timestamp("modeUpdatedAt"),
    modeUpdatedByUserId: text("modeUpdatedByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requiredDnsRecords: jsonb("requiredDnsRecords")
      .$type<MailDomainDnsRecord[]>()
      .notNull(),
    status: text("status").$type<MailDomainStatus>().notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    verifiedAt: timestamp("verifiedAt"),
  },
  (table) => [
    check(
      "mail_domain_mode_check",
      sql`${table.mode} in ('send_only', 'send_and_receive')`
    ),
    index("mail_domain_organization_id_idx").on(table.organizationId),
    index("mail_domain_catch_all_mailbox_idx").on(table.catchAllMailboxId),
    unique("mail_domain_catch_all_mailbox_unique").on(table.catchAllMailboxId),
    unique("mail_domain_domain_unique").on(table.domain),
  ]
);

export const mailDomainConnectAttempt = pgTable(
  "mailDomainConnectAttempt",
  {
    callbackError: text("callbackError"),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").notNull(),
    domainId: text("domainId")
      .notNull()
      .references(() => mailDomain.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expiresAt").notNull(),
    id: text("id").primaryKey(),
    mode: text("mode").$type<MailDomainMode>().notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerId: text("providerId").notNull(),
    providerName: text("providerName").notNull(),
    serviceId: text("serviceId").notNull(),
    status: text("status").$type<MailDomainConnectAttemptStatus>().notNull(),
    templateVersion: integer("templateVersion").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "mail_domain_connect_attempt_mode_check",
      sql`${table.mode} in ('send_only', 'send_and_receive')`
    ),
    check(
      "mail_domain_connect_attempt_status_check",
      sql`${table.status} in ('pending', 'returned', 'canceled', 'failed', 'expired')`
    ),
    index("mail_domain_connect_attempt_domain_idx").on(
      table.domainId,
      table.createdAt
    ),
    index("mail_domain_connect_attempt_expiry_idx").on(table.expiresAt),
    index("mail_domain_connect_attempt_user_idx").on(table.userId),
  ]
);

export const billingSubscription = pgTable(
  "billingSubscription",
  {
    createdAt: timestamp("createdAt").notNull(),
    currentPeriodEnd: timestamp("currentPeriodEnd").notNull(),
    currentPeriodStart: timestamp("currentPeriodStart").notNull(),
    id: text("id").primaryKey(),
    lastReconciliationFailureAt: timestamp("lastReconciliationFailureAt"),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    plan: text("plan").$type<BillingPlan>().notNull(),
    provider: text("provider").$type<BillingProvider>().notNull(),
    providerCustomerId: text("providerCustomerId"),
    providerModifiedAt: timestamp("providerModifiedAt"),
    providerProductId: text("providerProductId").notNull(),
    providerSubscriptionId: text("providerSubscriptionId").notNull(),
    scope: text("scope").$type<BillingScope>().notNull().default("team"),
    status: text("status").$type<BillingSubscriptionStatus>().notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("billing_subscription_user_id_idx").on(table.userId),
    index("billing_subscription_organization_id_idx").on(table.organizationId),
    index("billing_subscription_scope_target_idx").on(
      table.scope,
      table.userId,
      table.organizationId
    ),
    index("billing_subscription_provider_subscription_id_idx").on(
      table.providerSubscriptionId
    ),
    unique("billing_subscription_provider_subscription_unique").on(
      table.provider,
      table.providerSubscriptionId
    ),
  ]
);

export const billingCreditUsageEvent = pgTable(
  "billingCreditUsageEvent",
  {
    billableCostMicroCents: bigint("billableCostMicroCents", {
      mode: "number",
    }).notNull(),
    category: text("category").$type<BillingUsageCategory>().notNull(),
    costMicroCents: bigint("costMicroCents", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt").notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    id: text("id").primaryKey(),
    metadata:
      jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    polarEventReportedAt: timestamp("polarEventReportedAt"),
    scope: text("scope").$type<BillingScope>().notNull().default("team"),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "billing_credit_usage_event_target_check",
      sql`${table.scope} = 'team' and ${table.userId} is null and ${table.organizationId} is not null`
    ),
    check(
      "billing_credit_usage_event_cost_check",
      sql`${table.costMicroCents} >= 0`
    ),
    check(
      "billing_credit_usage_event_billable_cost_check",
      sql`${table.billableCostMicroCents} >= 0`
    ),
    index("billing_credit_usage_event_personal_period_idx").on(
      table.userId,
      table.createdAt
    ),
    index("billing_credit_usage_event_team_period_idx").on(
      table.organizationId,
      table.createdAt
    ),
    unique("billing_credit_usage_event_dedupe_key_unique").on(table.dedupeKey),
  ]
);

export const billingEntitlementOverride = pgTable(
  "billingEntitlementOverride",
  {
    createdAt: timestamp("createdAt").notNull(),
    createdByUserId: text("createdByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expiresAt"),
    id: text("id").primaryKey(),
    plan: text("plan").$type<BillingPlan>().notNull(),
    reason: text("reason").notNull(),
    revokedAt: timestamp("revokedAt"),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("billing_entitlement_override_user_id_idx").on(table.userId),
    index("billing_entitlement_override_active_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt
    ),
  ]
);

export const organizationMailUsageEvent = pgTable(
  "organizationMailUsageEvent",
  {
    attachmentSizeBytes: integer("attachmentSizeBytes").notNull(),
    billableCostMicroCents: bigint("billableCostMicroCents", {
      mode: "number",
    }).notNull(),
    createdAt: timestamp("createdAt").notNull(),
    dedupeKey: text("dedupeKey").notNull(),
    direction: text("direction")
      .$type<OrganizationMailUsageDirection>()
      .notNull(),
    id: text("id").primaryKey(),
    includedSesCostMicroCents: bigint("includedSesCostMicroCents", {
      mode: "number",
    }).notNull(),
    incomingChunkCount: integer("incomingChunkCount").notNull(),
    messageCount: integer("messageCount").notNull(),
    messageSizeBytes: integer("messageSizeBytes").notNull(),
    metadata:
      jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    polarEventReportedAt: timestamp("polarEventReportedAt"),
    provider: text("provider").notNull(),
    providerMessageId: text("providerMessageId").notNull(),
    recipientCount: integer("recipientCount").notNull(),
    sesCostMicroCents: bigint("sesCostMicroCents", {
      mode: "number",
    }).notNull(),
  },
  (table) => [
    index("organization_mail_usage_event_organization_created_at_idx").on(
      table.organizationId,
      table.createdAt
    ),
    unique("organization_mail_usage_event_dedupe_key_unique").on(
      table.dedupeKey
    ),
  ]
);

export const organizationMailSendIdempotency = pgTable(
  "organizationMailSendIdempotency",
  {
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotencyKey").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requestHash: text("requestHash").notNull(),
    response: jsonb("response").$type<{
      messageId: string | null;
      sent: true;
    }>(),
    status: text("status").default("completed").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("organization_mail_send_idempotency_organization_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    unique("organization_mail_send_idempotency_organization_key_unique").on(
      table.organizationId,
      table.idempotencyKey
    ),
  ]
);

export const rateLimitBucket = pgTable(
  "rateLimitBucket",
  {
    count: integer("count").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    key: text("key").primaryKey(),
    windowStart: timestamp("windowStart").notNull(),
  },
  (table) => [index("rate_limit_bucket_expires_at_idx").on(table.expiresAt)]
);

export const organizationMailUsageSettings = pgTable(
  "organizationMailUsageSettings",
  {
    alertMilestonePercents: jsonb("alertMilestonePercents")
      .$type<number[]>()
      .notNull()
      .default([50, 80, 100]),
    createdAt: timestamp("createdAt").notNull(),
    monthlyOverageLimitMicroCents: bigint("monthlyOverageLimitMicroCents", {
      mode: "number",
    }),
    organizationId: text("organizationId")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    overageEnabled: boolean("overageEnabled").notNull().default(true),
    updatedAt: timestamp("updatedAt").notNull(),
  }
);

export const organizationMailUsageAlertEvent = pgTable(
  "organizationMailUsageAlertEvent",
  {
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    milestonePercent: integer("milestonePercent").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    periodEnd: timestamp("periodEnd").notNull(),
    periodStart: timestamp("periodStart").notNull(),
    target: text("target").$type<OrganizationMailUsageAlertTarget>().notNull(),
    thresholdMicroCents: bigint("thresholdMicroCents", {
      mode: "number",
    }).notNull(),
    usageMicroCents: bigint("usageMicroCents", { mode: "number" }).notNull(),
  },
  (table) => [
    index("organization_mail_usage_alert_event_organization_period_idx").on(
      table.organizationId,
      table.periodStart
    ),
    unique("organization_mail_usage_alert_event_period_milestone_unique").on(
      table.organizationId,
      table.periodStart,
      table.target,
      table.milestonePercent
    ),
  ]
);

export const chat = pgTable(
  "chat",
  {
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    mailboxId: text("mailboxId")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    title: text("title"),
    updatedAt: timestamp("updatedAt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("chat_mailbox_id_user_id_updated_at_idx").on(
      table.mailboxId,
      table.userId,
      table.updatedAt
    ),
    unique("chat_id_user_id_unique").on(table.id, table.userId),
    unique("chat_id_mailbox_id_user_id_unique").on(
      table.id,
      table.mailboxId,
      table.userId
    ),
  ]
);

export const chatMessage = pgTable(
  "chatMessage",
  {
    chatId: text("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: text("id").primaryKey(),
    parts: jsonb("parts").$type<ChatMessagePart[]>().notNull(),
    position: integer("position").notNull(),
    role: text("role").$type<ChatMessageRole>().notNull(),
    userId: text("userId").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chatId, table.userId],
      foreignColumns: [chat.id, chat.userId],
      name: "chat_message_chat_id_user_id_fkey",
    }).onDelete("cascade"),
    unique("chat_message_id_chat_id_unique").on(table.id, table.chatId),
    unique("chat_message_chat_id_position_unique").on(
      table.chatId,
      table.position
    ),
  ]
);

export const waitlistSignup = pgTable("waitlistSignup", {
  createdAt: timestamp("createdAt").notNull(),
  email: text("email").primaryKey(),
});

export const apikey = pgTable(
  "apikey",
  {
    configId: text("configId").notNull().default("default"),
    createdAt: timestamp("createdAt").notNull(),
    enabled: boolean("enabled").default(true),
    expiresAt: timestamp("expiresAt"),
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    lastRefillAt: timestamp("lastRefillAt"),
    lastRequest: timestamp("lastRequest"),
    metadata: text("metadata"),
    name: text("name"),
    permissions: text("permissions"),
    prefix: text("prefix"),
    rateLimitEnabled: boolean("rateLimitEnabled").default(true),
    rateLimitMax: integer("rateLimitMax"),
    rateLimitTimeWindow: integer("rateLimitTimeWindow"),
    referenceId: text("referenceId").notNull(),
    refillAmount: integer("refillAmount"),
    refillInterval: integer("refillInterval"),
    remaining: integer("remaining"),
    requestCount: integer("requestCount").default(0),
    start: text("start"),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("apikey_config_id_idx").on(table.configId),
    index("apikey_reference_id_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ]
);

export const tables = {
  account,
  aiMemory,
  aiMemoryChangeSet,
  aiMemoryIndexJob,
  aiMemoryScopeConfig,
  apikey,
  billingCreditUsageEvent,
  billingEntitlementOverride,
  billingSubscription,
  chat,
  chatMessage,
  connectorCredential,
  connectorOAuthState,
  gmailAutoLabelEvent,
  gmailAutoLabelSettings,
  gmailCredential,
  gmailLabel,
  gmailOAuthState,
  gmailUsefulDetail,
  gmailUsefulDetailEvent,
  gmailUsefulDetailFeedback,
  gmailUsefulDetailSettings,
  gmailWatchState,
  invitation,
  mailAutoLabelFeedback,
  mailAutomationMemoryProfile,
  mailDomain,
  mailDomainConnectAttempt,
  mailTemplate,
  mailbox,
  mailboxAction,
  mailboxActionExternalEffect,
  mailboxActionRevision,
  mailboxActionRun,
  mailboxActionRunFrame,
  mailboxActionStepRun,
  mailboxAutomationSettings,
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
  member,
  organization,
  organizationApiMailAttachment,
  organizationApiMailMessage,
  organizationDivision,
  organizationDivisionMember,
  organizationMailDeliveryEvent,
  organizationMailDeliveryRecipient,
  organizationMailRecipientSuppression,
  organizationMailSendIdempotency,
  organizationMailUsageAlertEvent,
  organizationMailUsageEvent,
  organizationMailUsageSettings,
  passkey,
  rateLimitBucket,
  session,
  user,
  userAiContext,
  userAiContextEvent,
  verification,
  waitlistSignup,
};

export const authRelations = defineRelations(tables, (r) => ({
  account: {
    user: r.one.user({
      from: r.account.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  aiMemory: {
    mailbox: r.one.mailbox({
      from: r.aiMemory.mailboxId,
      optional: true,
      to: r.mailbox.id,
    }),
    user: r.one.user({
      from: r.aiMemory.userId,
      optional: true,
      to: r.user.id,
    }),
  },
  aiMemoryChangeSet: {
    mailbox: r.one.mailbox({
      from: r.aiMemoryChangeSet.mailboxId,
      optional: true,
      to: r.mailbox.id,
    }),
    user: r.one.user({
      from: r.aiMemoryChangeSet.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  aiMemoryScopeConfig: {
    mailbox: r.one.mailbox({
      from: r.aiMemoryScopeConfig.mailboxId,
      optional: true,
      to: r.mailbox.id,
    }),
    user: r.one.user({
      from: r.aiMemoryScopeConfig.userId,
      optional: true,
      to: r.user.id,
    }),
  },
  billingCreditUsageEvent: {
    organization: r.one.organization({
      from: r.billingCreditUsageEvent.organizationId,
      optional: false,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.billingCreditUsageEvent.userId,
      optional: true,
      to: r.user.id,
    }),
  },
  billingSubscription: {
    organization: r.one.organization({
      from: r.billingSubscription.organizationId,
      optional: true,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.billingSubscription.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  chat: {
    mailbox: r.one.mailbox({
      from: r.chat.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
    messages: r.many.chatMessage({ from: r.chat.id, to: r.chatMessage.chatId }),
    user: r.one.user({
      from: r.chat.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  chatMessage: {
    chat: r.one.chat({
      from: r.chatMessage.chatId,
      optional: false,
      to: r.chat.id,
    }),
    user: r.one.user({
      from: r.chatMessage.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  connectorCredential: {
    actionExternalEffects: r.many.mailboxActionExternalEffect({
      from: r.connectorCredential.id,
      to: r.mailboxActionExternalEffect.connectorCredentialId,
    }),
    user: r.one.user({
      from: r.connectorCredential.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  connectorOAuthState: {
    user: r.one.user({
      from: r.connectorOAuthState.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  gmailAutoLabelEvent: {
    mailbox: r.one.mailbox({
      from: r.gmailAutoLabelEvent.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailAutoLabelSettings: {
    mailbox: r.one.mailbox({
      from: r.gmailAutoLabelSettings.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailCredential: {
    mailbox: r.one.mailbox({
      from: r.gmailCredential.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailLabel: {
    mailbox: r.one.mailbox({
      from: r.gmailLabel.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailOAuthState: {
    mailbox: r.one.mailbox({
      from: r.gmailOAuthState.mailboxId,
      optional: true,
      to: r.mailbox.id,
    }),
    organization: r.one.organization({
      from: r.gmailOAuthState.organizationId,
      optional: false,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.gmailOAuthState.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  gmailUsefulDetail: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetail.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailUsefulDetailEvent: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetailEvent.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailUsefulDetailFeedback: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetailFeedback.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailUsefulDetailSettings: {
    mailbox: r.one.mailbox({
      from: r.gmailUsefulDetailSettings.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  gmailWatchState: {
    mailbox: r.one.mailbox({
      from: r.gmailWatchState.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  invitation: {
    inviter: r.one.user({
      from: r.invitation.inviterId,
      optional: false,
      to: r.user.id,
    }),
    organization: r.one.organization({
      from: r.invitation.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  mailAutoLabelFeedback: {
    mailbox: r.one.mailbox({
      from: r.mailAutoLabelFeedback.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
    user: r.one.user({
      from: r.mailAutoLabelFeedback.createdByUserId,
      optional: true,
      to: r.user.id,
    }),
  },
  mailAutomationMemoryProfile: {
    mailbox: r.one.mailbox({
      from: r.mailAutomationMemoryProfile.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  mailDomain: {
    connectAttempts: r.many.mailDomainConnectAttempt({
      from: r.mailDomain.id,
      to: r.mailDomainConnectAttempt.domainId,
    }),
    modeUpdatedBy: r.one.user({
      from: r.mailDomain.modeUpdatedByUserId,
      optional: true,
      to: r.user.id,
    }),
    organization: r.one.organization({
      from: r.mailDomain.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  mailDomainConnectAttempt: {
    domain: r.one.mailDomain({
      from: r.mailDomainConnectAttempt.domainId,
      optional: false,
      to: r.mailDomain.id,
    }),
    organization: r.one.organization({
      from: r.mailDomainConnectAttempt.organizationId,
      optional: false,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.mailDomainConnectAttempt.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  mailTemplate: {
    organization: r.one.organization({
      from: r.mailTemplate.organizationId,
      optional: true,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.mailTemplate.userId,
      optional: true,
      to: r.user.id,
    }),
  },
  mailbox: {
    actionRuns: r.many.mailboxActionRun({
      from: r.mailbox.id,
      to: r.mailboxActionRun.mailboxId,
    }),
    actions: r.many.mailboxAction({
      from: r.mailbox.id,
      to: r.mailboxAction.mailboxId,
    }),
    aiMemories: r.many.aiMemory({
      from: r.mailbox.id,
      to: r.aiMemory.mailboxId,
    }),
    aiMemoryChangeSets: r.many.aiMemoryChangeSet({
      from: r.mailbox.id,
      to: r.aiMemoryChangeSet.mailboxId,
    }),
    aiMemoryScopeConfigs: r.many.aiMemoryScopeConfig({
      from: r.mailbox.id,
      to: r.aiMemoryScopeConfig.mailboxId,
    }),
    autoLabelFeedback: r.many.mailAutoLabelFeedback({
      from: r.mailbox.id,
      to: r.mailAutoLabelFeedback.mailboxId,
    }),
    automationMemoryProfiles: r.many.mailAutomationMemoryProfile({
      from: r.mailbox.id,
      to: r.mailAutomationMemoryProfile.mailboxId,
    }),
    automationSettings: r.one.mailboxAutomationSettings({
      from: r.mailbox.id,
      optional: true,
      to: r.mailboxAutomationSettings.mailboxId,
    }),
    chats: r.many.chat({ from: r.mailbox.id, to: r.chat.mailboxId }),
    division: r.one.organizationDivision({
      from: r.mailbox.divisionId,
      optional: true,
      to: r.organizationDivision.id,
    }),
    divisionGrants: r.many.mailboxDivisionGrant({
      from: r.mailbox.id,
      to: r.mailboxDivisionGrant.mailboxId,
    }),
    gmailAutoLabelEvents: r.many.gmailAutoLabelEvent({
      from: r.mailbox.id,
      to: r.gmailAutoLabelEvent.mailboxId,
    }),
    gmailAutoLabelSettings: r.one.gmailAutoLabelSettings({
      from: r.mailbox.id,
      optional: true,
      to: r.gmailAutoLabelSettings.mailboxId,
    }),
    gmailCredential: r.one.gmailCredential({
      from: r.mailbox.id,
      optional: true,
      to: r.gmailCredential.mailboxId,
    }),
    gmailLabels: r.many.gmailLabel({
      from: r.mailbox.id,
      to: r.gmailLabel.mailboxId,
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
      optional: true,
      to: r.gmailUsefulDetailSettings.mailboxId,
    }),
    gmailUsefulDetails: r.many.gmailUsefulDetail({
      from: r.mailbox.id,
      to: r.gmailUsefulDetail.mailboxId,
    }),
    gmailWatchState: r.one.gmailWatchState({
      from: r.mailbox.id,
      optional: true,
      to: r.gmailWatchState.mailboxId,
    }),
    grants: r.many.mailboxGrant({
      from: r.mailbox.id,
      to: r.mailboxGrant.mailboxId,
    }),
    managedAttachments: r.many.managedMailAttachment({
      from: r.mailbox.id,
      to: r.managedMailAttachment.mailboxId,
    }),
    managedLabels: r.many.managedMailLabel({
      from: r.mailbox.id,
      to: r.managedMailLabel.mailboxId,
    }),
    managedMessages: r.many.managedMailMessage({
      from: r.mailbox.id,
      to: r.managedMailMessage.mailboxId,
    }),
    managedRules: r.many.managedMailRule({
      from: r.mailbox.id,
      to: r.managedMailRule.mailboxId,
    }),
    managedSavedViews: r.many.managedMailSavedView({
      from: r.mailbox.id,
      to: r.managedMailSavedView.mailboxId,
    }),
    organization: r.one.organization({
      from: r.mailbox.organizationId,
      optional: false,
      to: r.organization.id,
    }),
    owner: r.one.user({
      from: r.mailbox.ownerUserId,
      optional: true,
      to: r.user.id,
    }),
    userAiContextEvents: r.many.userAiContextEvent({
      from: r.mailbox.id,
      to: r.userAiContextEvent.mailboxId,
    }),
  },
  mailboxAction: {
    creator: r.one.user({
      from: r.mailboxAction.createdByUserId,
      optional: true,
      to: r.user.id,
    }),
    externalEffects: r.many.mailboxActionExternalEffect({
      from: r.mailboxAction.id,
      to: r.mailboxActionExternalEffect.actionId,
    }),
    mailbox: r.one.mailbox({
      from: r.mailboxAction.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
    organization: r.one.organization({
      from: r.mailboxAction.organizationId,
      optional: false,
      to: r.organization.id,
    }),
    revisions: r.many.mailboxActionRevision({
      from: r.mailboxAction.id,
      to: r.mailboxActionRevision.actionId,
    }),
    runs: r.many.mailboxActionRun({
      from: r.mailboxAction.id,
      to: r.mailboxActionRun.actionId,
    }),
  },
  mailboxActionExternalEffect: {
    action: r.one.mailboxAction({
      from: r.mailboxActionExternalEffect.actionId,
      optional: false,
      to: r.mailboxAction.id,
    }),
    connectorCredential: r.one.connectorCredential({
      from: r.mailboxActionExternalEffect.connectorCredentialId,
      optional: true,
      to: r.connectorCredential.id,
    }),
    revision: r.one.mailboxActionRevision({
      from: r.mailboxActionExternalEffect.revisionId,
      optional: false,
      to: r.mailboxActionRevision.id,
    }),
    run: r.one.mailboxActionRun({
      from: r.mailboxActionExternalEffect.runId,
      optional: false,
      to: r.mailboxActionRun.id,
    }),
    step: r.one.mailboxActionStepRun({
      from: r.mailboxActionExternalEffect.stepRunId,
      optional: true,
      to: r.mailboxActionStepRun.id,
    }),
  },
  mailboxActionRevision: {
    action: r.one.mailboxAction({
      from: r.mailboxActionRevision.actionId,
      optional: false,
      to: r.mailboxAction.id,
    }),
    creator: r.one.user({
      from: r.mailboxActionRevision.createdByUserId,
      optional: true,
      to: r.user.id,
    }),
    runs: r.many.mailboxActionRun({
      from: r.mailboxActionRevision.id,
      to: r.mailboxActionRun.revisionId,
    }),
  },
  mailboxActionRun: {
    action: r.one.mailboxAction({
      from: r.mailboxActionRun.actionId,
      optional: false,
      to: r.mailboxAction.id,
    }),
    frames: r.many.mailboxActionRunFrame({
      from: r.mailboxActionRun.id,
      to: r.mailboxActionRunFrame.runId,
    }),
    mailbox: r.one.mailbox({
      from: r.mailboxActionRun.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
    organization: r.one.organization({
      from: r.mailboxActionRun.organizationId,
      optional: false,
      to: r.organization.id,
    }),
    revision: r.one.mailboxActionRevision({
      from: r.mailboxActionRun.revisionId,
      optional: false,
      to: r.mailboxActionRevision.id,
    }),
    steps: r.many.mailboxActionStepRun({
      from: r.mailboxActionRun.id,
      to: r.mailboxActionStepRun.runId,
    }),
  },
  mailboxActionRunFrame: {
    run: r.one.mailboxActionRun({
      from: r.mailboxActionRunFrame.runId,
      optional: false,
      to: r.mailboxActionRun.id,
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
      optional: true,
      to: r.mailboxActionRunFrame.id,
    }),
    run: r.one.mailboxActionRun({
      from: r.mailboxActionStepRun.runId,
      optional: false,
      to: r.mailboxActionRun.id,
    }),
  },
  mailboxAutomationSettings: {
    mailbox: r.one.mailbox({
      from: r.mailboxAutomationSettings.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  mailboxDivisionGrant: {
    division: r.one.organizationDivision({
      from: r.mailboxDivisionGrant.divisionId,
      optional: false,
      to: r.organizationDivision.id,
    }),
    mailbox: r.one.mailbox({
      from: r.mailboxDivisionGrant.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
  },
  mailboxGrant: {
    mailbox: r.one.mailbox({
      from: r.mailboxGrant.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
    user: r.one.user({
      from: r.mailboxGrant.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  managedMailAttachment: {
    mailbox: r.one.mailbox({
      from: r.managedMailAttachment.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
    message: r.one.managedMailMessage({
      from: r.managedMailAttachment.messageId,
      optional: false,
      to: r.managedMailMessage.id,
    }),
  },
  managedMailLabel: {
    assignments: r.many.managedMailMessageLabel({
      from: r.managedMailLabel.id,
      to: r.managedMailMessageLabel.labelId,
    }),
    mailbox: r.one.mailbox({
      from: r.managedMailLabel.mailboxId,
      optional: false,
      to: r.mailbox.id,
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
      optional: false,
      to: r.mailbox.id,
    }),
  },
  managedMailMessageLabel: {
    label: r.one.managedMailLabel({
      from: r.managedMailMessageLabel.labelId,
      optional: false,
      to: r.managedMailLabel.id,
    }),
    message: r.one.managedMailMessage({
      from: r.managedMailMessageLabel.messageId,
      optional: false,
      to: r.managedMailMessage.id,
    }),
    rule: r.one.managedMailRule({
      from: r.managedMailMessageLabel.ruleId,
      optional: true,
      to: r.managedMailRule.id,
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
      optional: false,
      to: r.mailbox.id,
    }),
  },
  managedMailSavedView: {
    mailbox: r.one.mailbox({
      from: r.managedMailSavedView.mailboxId,
      optional: false,
      to: r.mailbox.id,
    }),
    owner: r.one.user({
      from: r.managedMailSavedView.ownerUserId,
      optional: true,
      to: r.user.id,
    }),
  },
  member: {
    divisionMemberships: r.many.organizationDivisionMember({
      from: r.member.id,
      to: r.organizationDivisionMember.memberId,
    }),
    organization: r.one.organization({
      from: r.member.organizationId,
      optional: false,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.member.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  organization: {
    billingCreditUsageEvents: r.many.billingCreditUsageEvent({
      from: r.organization.id,
      to: r.billingCreditUsageEvent.organizationId,
    }),
    billingSubscriptions: r.many.billingSubscription({
      from: r.organization.id,
      to: r.billingSubscription.organizationId,
    }),
    divisions: r.many.organizationDivision({
      from: r.organization.id,
      to: r.organizationDivision.organizationId,
    }),
    gmailOAuthStates: r.many.gmailOAuthState({
      from: r.organization.id,
      to: r.gmailOAuthState.organizationId,
    }),
    invitations: r.many.invitation({
      from: r.organization.id,
      to: r.invitation.organizationId,
    }),
    mailDomainConnectAttempts: r.many.mailDomainConnectAttempt({
      from: r.organization.id,
      to: r.mailDomainConnectAttempt.organizationId,
    }),
    mailDomains: r.many.mailDomain({
      from: r.organization.id,
      to: r.mailDomain.organizationId,
    }),
    mailTemplates: r.many.mailTemplate({
      from: r.organization.id,
      to: r.mailTemplate.organizationId,
    }),
    mailboxActionRuns: r.many.mailboxActionRun({
      from: r.organization.id,
      to: r.mailboxActionRun.organizationId,
    }),
    mailboxActions: r.many.mailboxAction({
      from: r.organization.id,
      to: r.mailboxAction.organizationId,
    }),
    mailboxes: r.many.mailbox({
      from: r.organization.id,
      to: r.mailbox.organizationId,
    }),
    members: r.many.member({
      from: r.organization.id,
      to: r.member.organizationId,
    }),
    organizationApiMailAttachments: r.many.organizationApiMailAttachment({
      from: r.organization.id,
      to: r.organizationApiMailAttachment.organizationId,
    }),
    organizationApiMailMessages: r.many.organizationApiMailMessage({
      from: r.organization.id,
      to: r.organizationApiMailMessage.organizationId,
    }),
    organizationMailDeliveryEvents: r.many.organizationMailDeliveryEvent({
      from: r.organization.id,
      to: r.organizationMailDeliveryEvent.organizationId,
    }),
    organizationMailDeliveryRecipients:
      r.many.organizationMailDeliveryRecipient({
        from: r.organization.id,
        to: r.organizationMailDeliveryRecipient.organizationId,
      }),
    organizationMailRecipientSuppressions:
      r.many.organizationMailRecipientSuppression({
        from: r.organization.id,
        to: r.organizationMailRecipientSuppression.organizationId,
      }),
    organizationMailSendIdempotency: r.many.organizationMailSendIdempotency({
      from: r.organization.id,
      to: r.organizationMailSendIdempotency.organizationId,
    }),
    organizationMailUsageAlertEvents: r.many.organizationMailUsageAlertEvent({
      from: r.organization.id,
      to: r.organizationMailUsageAlertEvent.organizationId,
    }),
    organizationMailUsageEvents: r.many.organizationMailUsageEvent({
      from: r.organization.id,
      to: r.organizationMailUsageEvent.organizationId,
    }),
    organizationMailUsageSettings: r.one.organizationMailUsageSettings({
      from: r.organization.id,
      optional: true,
      to: r.organizationMailUsageSettings.organizationId,
    }),
    userAiContextEvents: r.many.userAiContextEvent({
      from: r.organization.id,
      to: r.userAiContextEvent.organizationId,
    }),
  },
  organizationApiMailAttachment: {
    message: r.one.organizationApiMailMessage({
      from: r.organizationApiMailAttachment.messageId,
      optional: false,
      to: r.organizationApiMailMessage.id,
    }),
    organization: r.one.organization({
      from: r.organizationApiMailAttachment.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationApiMailMessage: {
    attachments: r.many.organizationApiMailAttachment({
      from: r.organizationApiMailMessage.id,
      to: r.organizationApiMailAttachment.messageId,
    }),
    organization: r.one.organization({
      from: r.organizationApiMailMessage.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationDivision: {
    mailboxGrants: r.many.mailboxDivisionGrant({
      from: r.organizationDivision.id,
      to: r.mailboxDivisionGrant.divisionId,
    }),
    mailboxes: r.many.mailbox({
      from: r.organizationDivision.id,
      to: r.mailbox.divisionId,
    }),
    members: r.many.organizationDivisionMember({
      from: r.organizationDivision.id,
      to: r.organizationDivisionMember.divisionId,
    }),
    organization: r.one.organization({
      from: r.organizationDivision.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationDivisionMember: {
    division: r.one.organizationDivision({
      from: r.organizationDivisionMember.divisionId,
      optional: false,
      to: r.organizationDivision.id,
    }),
    member: r.one.member({
      from: r.organizationDivisionMember.memberId,
      optional: false,
      to: r.member.id,
    }),
  },
  organizationMailDeliveryEvent: {
    organization: r.one.organization({
      from: r.organizationMailDeliveryEvent.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationMailDeliveryRecipient: {
    organization: r.one.organization({
      from: r.organizationMailDeliveryRecipient.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationMailRecipientSuppression: {
    organization: r.one.organization({
      from: r.organizationMailRecipientSuppression.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationMailSendIdempotency: {
    organization: r.one.organization({
      from: r.organizationMailSendIdempotency.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationMailUsageAlertEvent: {
    organization: r.one.organization({
      from: r.organizationMailUsageAlertEvent.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationMailUsageEvent: {
    organization: r.one.organization({
      from: r.organizationMailUsageEvent.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  organizationMailUsageSettings: {
    organization: r.one.organization({
      from: r.organizationMailUsageSettings.organizationId,
      optional: false,
      to: r.organization.id,
    }),
  },
  passkey: {
    user: r.one.user({
      from: r.passkey.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  session: {
    activeOrganization: r.one.organization({
      from: r.session.activeOrganizationId,
      optional: true,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.session.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  user: {
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    aiContext: r.one.userAiContext({
      from: r.user.id,
      to: r.userAiContext.userId,
    }),
    aiContextEvents: r.many.userAiContextEvent({
      from: r.user.id,
      to: r.userAiContextEvent.userId,
    }),
    aiMemories: r.many.aiMemory({ from: r.user.id, to: r.aiMemory.userId }),
    aiMemoryChangeSets: r.many.aiMemoryChangeSet({
      from: r.user.id,
      to: r.aiMemoryChangeSet.userId,
    }),
    aiMemoryScopeConfigs: r.many.aiMemoryScopeConfig({
      from: r.user.id,
      to: r.aiMemoryScopeConfig.userId,
    }),
    billingCreditUsageEvents: r.many.billingCreditUsageEvent({
      from: r.user.id,
      to: r.billingCreditUsageEvent.userId,
    }),
    billingSubscriptions: r.many.billingSubscription({
      from: r.user.id,
      to: r.billingSubscription.userId,
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
    createdMailboxActionRevisions: r.many.mailboxActionRevision({
      from: r.user.id,
      to: r.mailboxActionRevision.createdByUserId,
    }),
    createdMailboxActions: r.many.mailboxAction({
      from: r.user.id,
      to: r.mailboxAction.createdByUserId,
    }),
    gmailOAuthStates: r.many.gmailOAuthState({
      from: r.user.id,
      to: r.gmailOAuthState.userId,
    }),
    invitations: r.many.invitation({
      from: r.user.id,
      to: r.invitation.inviterId,
    }),
    mailDomainConnectAttempts: r.many.mailDomainConnectAttempt({
      from: r.user.id,
      to: r.mailDomainConnectAttempt.userId,
    }),
    mailTemplates: r.many.mailTemplate({
      from: r.user.id,
      to: r.mailTemplate.userId,
    }),
    mailboxGrants: r.many.mailboxGrant({
      from: r.user.id,
      to: r.mailboxGrant.userId,
    }),
    memberships: r.many.member({ from: r.user.id, to: r.member.userId }),
    ownedMailboxes: r.many.mailbox({
      from: r.user.id,
      to: r.mailbox.ownerUserId,
    }),
    passkeys: r.many.passkey({ from: r.user.id, to: r.passkey.userId }),
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
  },
}));
