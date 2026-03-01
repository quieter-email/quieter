import { boolean, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { defineRelations } from "drizzle-orm/relations";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  twoFactorEnabled: boolean("twoFactorEnabled").default(false),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").notNull(),
});

export const team = pgTable("team", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => organization.id),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  activeOrganizationId: text("activeOrganizationId").references(() => organization.id),
  activeTeamId: text("activeTeamId").references(() => team.id),
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

export const twoFactor = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id)
    .unique(),
});

export const passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("publicKey").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  credentialID: text("credentialID").notNull().unique(),
  counter: integer("counter").notNull(),
  deviceType: text("deviceType").notNull(),
  backedUp: boolean("backedUp").notNull(),
  transports: text("transports"),
  createdAt: timestamp("createdAt").notNull(),
  aaguid: text("aaguid"),
});

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
    role: text("role").notNull().default("member"),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [unique().on(table.organizationId, table.userId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => organization.id),
  email: text("email").notNull(),
  role: text("role"),
  teamId: text("teamId").references(() => team.id),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull(),
  inviterId: text("inviterId")
    .notNull()
    .references(() => user.id),
});

export const teamMember = pgTable(
  "teamMember",
  {
    id: text("id").primaryKey(),
    teamId: text("teamId")
      .notNull()
      .references(() => team.id),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [unique().on(table.teamId, table.userId)],
);

export const organizationRole = pgTable(
  "organizationRole",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id),
    role: text("role").notNull(),
    permission: text("permission").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [unique().on(table.organizationId, table.role)],
);

export const tables = {
  user,
  organization,
  team,
  session,
  account,
  verification,
  twoFactor,
  passkey,
  member,
  invitation,
  teamMember,
  organizationRole,
};

export const authRelations = defineRelations(tables, (r) => ({
  user: {
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
    twoFactor: r.one.twoFactor({
      from: r.user.id,
      to: r.twoFactor.userId,
      optional: true,
    }),
    passkeys: r.many.passkey({ from: r.user.id, to: r.passkey.userId }),
    memberships: r.many.member({ from: r.user.id, to: r.member.userId }),
    invitationsSent: r.many.invitation({ from: r.user.id, to: r.invitation.inviterId }),
    teamMemberships: r.many.teamMember({ from: r.user.id, to: r.teamMember.userId }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
    activeOrganization: r.one.organization({
      from: r.session.activeOrganizationId,
      to: r.organization.id,
      optional: true,
    }),
    activeTeam: r.one.team({
      from: r.session.activeTeamId,
      to: r.team.id,
      optional: true,
    }),
  },
  twoFactor: {
    user: r.one.user({
      from: r.twoFactor.userId,
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
  organization: {
    members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
    invitations: r.many.invitation({ from: r.organization.id, to: r.invitation.organizationId }),
    teams: r.many.team({ from: r.organization.id, to: r.team.organizationId }),
    roles: r.many.organizationRole({
      from: r.organization.id,
      to: r.organizationRole.organizationId,
    }),
    sessionsAsActive: r.many.session({
      from: r.organization.id,
      to: r.session.activeOrganizationId,
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
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    inviter: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
      optional: false,
    }),
    team: r.one.team({
      from: r.invitation.teamId,
      to: r.team.id,
      optional: true,
    }),
  },
  team: {
    organization: r.one.organization({
      from: r.team.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    members: r.many.teamMember({ from: r.team.id, to: r.teamMember.teamId }),
    invitations: r.many.invitation({ from: r.team.id, to: r.invitation.teamId }),
    sessionsUsingAsActive: r.many.session({ from: r.team.id, to: r.session.activeTeamId }),
  },
  teamMember: {
    team: r.one.team({
      from: r.teamMember.teamId,
      to: r.team.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.teamMember.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  organizationRole: {
    organization: r.one.organization({
      from: r.organizationRole.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },
}));
