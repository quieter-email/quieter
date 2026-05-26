import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { defineRelations } from "drizzle-orm/relations";

export type MailDomainStatus = "failed" | "pending_dns" | "verified";

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
export type ChatMessagePart = {
  type: string;
};

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  defaultMailboxId: text("defaultMailboxId"),
  mailboxSwitcherOrder: jsonb("mailboxSwitcherOrder").$type<MailboxSwitcherOrder>(),
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
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id),
    provider: text("provider").notNull(),
    emailAddress: text("emailAddress").notNull(),
    displayName: text("displayName"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("mailbox_organization_id_idx").on(table.organizationId),
    unique("mailbox_organization_id_email_address_unique").on(
      table.organizationId,
      table.emailAddress,
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

export const chat = pgTable(
  "chat",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
    title: text("title"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [index("chat_user_id_updated_at_idx").on(table.userId, table.updatedAt)],
);

export const chatMessage = pgTable(
  "chatMessage",
  {
    id: text("id").primaryKey(),
    chatId: text("chatId")
      .notNull()
      .references(() => chat.id),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
    position: integer("position").notNull(),
    role: text("role").$type<ChatMessageRole>().notNull(),
    parts: jsonb("parts").$type<ChatMessagePart[]>().notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    unique("chat_message_chat_id_id_unique").on(table.chatId, table.id),
    unique("chat_message_chat_id_position_unique").on(table.chatId, table.position),
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
  chat,
  chatMessage,
  user,
  organization,
  session,
  account,
  verification,
  passkey,
  member,
  invitation,
  mailbox,
  mailDomain,
  waitlistSignup,
};

export const authRelations = defineRelations(tables, (r) => ({
  user: {
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    chats: r.many.chat({ from: r.user.id, to: r.chat.userId }),
    invitations: r.many.invitation({ from: r.user.id, to: r.invitation.inviterId }),
    memberships: r.many.member({ from: r.user.id, to: r.member.userId }),
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
    passkeys: r.many.passkey({ from: r.user.id, to: r.passkey.userId }),
  },
  chat: {
    messages: r.many.chatMessage({ from: r.chat.id, to: r.chatMessage.chatId }),
    user: r.one.user({
      from: r.chat.userId,
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
    invitations: r.many.invitation({
      from: r.organization.id,
      to: r.invitation.organizationId,
    }),
    mailboxes: r.many.mailbox({ from: r.organization.id, to: r.mailbox.organizationId }),
    mailDomains: r.many.mailDomain({ from: r.organization.id, to: r.mailDomain.organizationId }),
    members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
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
    organization: r.one.organization({
      from: r.mailbox.organizationId,
      to: r.organization.id,
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
}));
