import type { MailboxGrantRole, MailboxSwitcherOrder } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { auth } from "@quieter/auth";
import {
  db,
  gmailAutoLabelSettings,
  gmailCredential,
  gmailOAuthState,
  gmailUsefulDetailSettings,
  mailbox,
  mailboxGrant,
  member,
  organization,
  user,
} from "@quieter/database";
import { getGmailProfile, isGmailServiceError } from "@quieter/gmail";
import { and, asc, eq, inArray, lt, or } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { encryptSecret, getGmailOAuthConfig, GMAIL_SCOPES } from "./gmail-mailbox-access";

export {
  GMAIL_SCOPES,
  getAuthorizedGmailMailbox,
  markGmailMailboxNeedsReconnect,
  refreshAuthorizedGmailAccessToken,
  runAuthorizedGmailMailbox,
} from "./gmail-mailbox-access";

export const MAILBOX_PROVIDER_GMAIL = "gmail" as const;
export const MAILBOX_PROVIDER_MANAGED = "managed" as const;

const PERSONAL_GROUP_ID = "personal";
const PERSONAL_GROUP_NAME = "Personal";
const GMAIL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

type MailboxGroupMetadata = {
  groupId: string;
  groupKind: "personal" | "organization";
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
  organizationId: string | null;
  ownerUserId: string | null;
  provider: "gmail" | "managed";
};

export type MailboxGroup = {
  id: string;
  kind: "personal" | "organization";
  mailboxes: MailboxListItem[];
  name: string;
  slug: string | null;
};

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().min(1),
  token_type: z.string().min(1),
});

const googleTokenInfoSchema = z.object({
  aud: z.string().min(1),
  email: z.string().email(),
  email_verified: z.enum(["true", "false"]),
  exp: z.coerce.number().int().positive(),
  iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
  sub: z.string().min(1),
});

const normalizeEmailAddress = (emailAddress: string) => emailAddress.trim().toLowerCase();

const normalizeReturnTo = (returnTo: string | undefined) => {
  const normalized = returnTo?.trim();
  return normalized?.startsWith("/") && !normalized.startsWith("//") ? normalized : "/settings";
};

const createCodeVerifier = () => randomBytes(48).toString("base64url");
const createCodeChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const listUserOrganizations = async (userId: string) =>
  await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));

const assertOrganizationMembership = async (userId: string, organizationId: string) => {
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);

  if (!membership) {
    throw new ORPCError("FORBIDDEN", {
      message: "You are not a member of that organization.",
    });
  }
};

const repairGmailOrganizationPlacement = async (
  userId: string,
  organizationIds: readonly string[],
) => {
  const ownedGmailMailboxes = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
    })
    .from(mailbox)
    .where(and(eq(mailbox.ownerUserId, userId), eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL)));
  const accessibleOrganizationIds = new Set(organizationIds);
  const staleMailboxIds = ownedGmailMailboxes.flatMap((record) =>
    record.organizationId && !accessibleOrganizationIds.has(record.organizationId)
      ? [record.id]
      : [],
  );

  if (staleMailboxIds.length > 0) {
    await db
      .update(mailbox)
      .set({ organizationId: null, updatedAt: new Date() })
      .where(inArray(mailbox.id, staleMailboxIds));
  }
};

const toMailboxListItem = (
  record: {
    displayName: string | null;
    emailAddress: string;
    grantRole: MailboxGrantRole | null;
    gmailAutoLabelEnabled?: boolean | null;
    gmailUsefulDetailsEnabled?: boolean | null;
    id: string;
    organizationId: string | null;
    ownerUserId: string | null;
    provider: "gmail" | "managed";
    status: "connected" | "needs_reconnect";
  },
  group: MailboxGroupMetadata,
): MailboxListItem => ({
  connectionStatus: record.status,
  displayName: record.displayName,
  emailAddress: record.emailAddress,
  grantRole: record.grantRole,
  gmailAutoLabelEnabled: record.gmailAutoLabelEnabled ?? false,
  gmailUsefulDetailsEnabled: record.gmailUsefulDetailsEnabled ?? false,
  groupId: group.groupId,
  groupKind: group.groupKind,
  groupName: group.groupName,
  id: record.id,
  organizationId: record.organizationId,
  ownerUserId: record.ownerUserId,
  provider: record.provider,
});

export const listAccessibleMailboxState = async (input: { userId: string }) => {
  const organizations = await listUserOrganizations(input.userId);
  await repairGmailOrganizationPlacement(
    input.userId,
    organizations.map((record) => record.id),
  );

  const [gmailMailboxes, managedMailboxes] = await Promise.all([
    db
      .select({
        displayName: mailbox.displayName,
        emailAddress: mailbox.emailAddress,
        gmailAutoLabelEnabled: gmailAutoLabelSettings.enabled,
        gmailUsefulDetailsEnabled: gmailUsefulDetailSettings.enabled,
        id: mailbox.id,
        organizationId: mailbox.organizationId,
        ownerUserId: mailbox.ownerUserId,
        provider: mailbox.provider,
        status: mailbox.status,
      })
      .from(mailbox)
      .leftJoin(gmailAutoLabelSettings, eq(gmailAutoLabelSettings.mailboxId, mailbox.id))
      .leftJoin(gmailUsefulDetailSettings, eq(gmailUsefulDetailSettings.mailboxId, mailbox.id))
      .where(
        and(eq(mailbox.ownerUserId, input.userId), eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL)),
      )
      .orderBy(asc(mailbox.emailAddress)),
    db
      .select({
        displayName: mailbox.displayName,
        emailAddress: mailbox.emailAddress,
        grantRole: mailboxGrant.role,
        gmailAutoLabelEnabled: gmailAutoLabelSettings.enabled,
        gmailUsefulDetailsEnabled: gmailUsefulDetailSettings.enabled,
        id: mailbox.id,
        organizationId: mailbox.organizationId,
        ownerUserId: mailbox.ownerUserId,
        provider: mailbox.provider,
        status: mailbox.status,
      })
      .from(mailboxGrant)
      .innerJoin(mailbox, eq(mailbox.id, mailboxGrant.mailboxId))
      .leftJoin(gmailAutoLabelSettings, eq(gmailAutoLabelSettings.mailboxId, mailbox.id))
      .leftJoin(gmailUsefulDetailSettings, eq(gmailUsefulDetailSettings.mailboxId, mailbox.id))
      .innerJoin(
        member,
        and(eq(member.userId, input.userId), eq(member.organizationId, mailbox.organizationId)),
      )
      .where(
        and(eq(mailboxGrant.userId, input.userId), eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)),
      )
      .orderBy(asc(mailbox.emailAddress)),
  ]);

  const groups: MailboxGroup[] = [
    {
      id: PERSONAL_GROUP_ID,
      kind: "personal",
      mailboxes: gmailMailboxes
        .filter((record) => record.organizationId === null)
        .map((record) =>
          toMailboxListItem(
            { ...record, grantRole: null },
            {
              groupId: PERSONAL_GROUP_ID,
              groupKind: "personal",
              groupName: PERSONAL_GROUP_NAME,
            },
          ),
        ),
      name: PERSONAL_GROUP_NAME,
      slug: null,
    },
    ...organizations.map((organization) => ({
      id: organization.id,
      kind: "organization" as const,
      mailboxes: [
        ...gmailMailboxes
          .filter((record) => record.organizationId === organization.id)
          .map((record) =>
            toMailboxListItem(
              { ...record, grantRole: null },
              {
                groupId: organization.id,
                groupKind: "organization",
                groupName: organization.name,
              },
            ),
          ),
        ...managedMailboxes
          .filter((record) => record.organizationId === organization.id)
          .map((record) =>
            toMailboxListItem(record, {
              groupId: organization.id,
              groupKind: "organization",
              groupName: organization.name,
            }),
          ),
      ].sort((left, right) => left.emailAddress.localeCompare(right.emailAddress)),
      name: organization.name,
      slug: organization.slug,
    })),
  ];

  return { groups };
};

export const assertAccessibleMailbox = async (input: { mailboxId: string; userId: string }) => {
  const [ownedGmailMailbox] = await db
    .select({ id: mailbox.id, provider: mailbox.provider })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL),
      ),
    )
    .limit(1);

  if (ownedGmailMailbox) {
    return ownedGmailMailbox;
  }

  const [grantedManagedMailbox] = await db
    .select({ id: mailbox.id, provider: mailbox.provider })
    .from(mailboxGrant)
    .innerJoin(mailbox, eq(mailbox.id, mailboxGrant.mailboxId))
    .innerJoin(
      member,
      and(eq(member.userId, input.userId), eq(member.organizationId, mailbox.organizationId)),
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailboxGrant.userId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
      ),
    )
    .limit(1);

  if (!grantedManagedMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }

  return grantedManagedMailbox;
};

export const startGmailOAuth = async (input: {
  mailboxId?: string;
  organizationId?: string | null;
  returnTo?: string;
  userId: string;
}) => {
  await db.delete(gmailOAuthState).where(lt(gmailOAuthState.expiresAt, new Date()));

  let loginHint: string | null = null;
  let organizationId = input.organizationId ?? null;
  if (input.mailboxId) {
    const [existingMailbox] = await db
      .select({
        emailAddress: mailbox.emailAddress,
        organizationId: mailbox.organizationId,
      })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.id, input.mailboxId),
          eq(mailbox.ownerUserId, input.userId),
          eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL),
        ),
      )
      .limit(1);

    if (!existingMailbox) {
      throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
    }
    loginHint = existingMailbox.emailAddress;
    if (input.organizationId === undefined) {
      organizationId = existingMailbox.organizationId;
    }
  }

  if (organizationId) {
    await assertOrganizationMembership(input.userId, organizationId);
  }

  const state = randomBytes(32).toString("base64url");
  const codeVerifier = createCodeVerifier();
  const now = new Date();
  await db.insert(gmailOAuthState).values({
    codeVerifier,
    createdAt: now,
    expiresAt: new Date(now.getTime() + GMAIL_OAUTH_STATE_TTL_MS),
    id: state,
    mailboxId: input.mailboxId ?? null,
    organizationId,
    returnTo: normalizeReturnTo(input.returnTo),
    userId: input.userId,
  });

  const config = getGmailOAuthConfig();
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("prompt", "consent select_account");
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  if (loginHint) {
    authorizationUrl.searchParams.set("login_hint", loginHint);
  }

  return { authorizationUrl: authorizationUrl.toString() };
};

const exchangeGoogleAuthorizationCode = async (code: string, codeVerifier: string) => {
  const config = getGmailOAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Google rejected the Gmail authorization code.");
  }
  return googleTokenResponseSchema.parse(await response.json());
};

const validateGoogleIdToken = async (idToken: string) => {
  const config = getGmailOAuthConfig();
  const response = await fetch(`${GOOGLE_TOKEN_INFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) {
    throw new Error("Google returned an invalid identity token.");
  }

  const tokenInfo = googleTokenInfoSchema.parse(await response.json());
  if (
    tokenInfo.aud !== config.clientId ||
    tokenInfo.email_verified !== "true" ||
    tokenInfo.exp * 1000 <= Date.now()
  ) {
    throw new Error("Google returned an invalid identity token.");
  }
  return tokenInfo;
};

export const completeGmailOAuth = async (input: {
  code: string;
  headers: Headers;
  state: string;
}) => {
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session?.user || !session.session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in before connecting Gmail." });
  }

  const [oauthState] = await db
    .delete(gmailOAuthState)
    .where(eq(gmailOAuthState.id, input.state))
    .returning();

  if (
    !oauthState ||
    oauthState.userId !== session.user.id ||
    oauthState.expiresAt.getTime() <= Date.now()
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This Gmail connection request is invalid or expired.",
    });
  }

  if (oauthState.organizationId) {
    await assertOrganizationMembership(session.user.id, oauthState.organizationId);
  }

  const tokenResponse = await exchangeGoogleAuthorizationCode(input.code, oauthState.codeVerifier);
  const tokenInfo = await validateGoogleIdToken(tokenResponse.id_token);
  const profile = await getGmailProfile(tokenResponse.access_token);
  const emailAddress = normalizeEmailAddress(profile.emailAddress);

  if (emailAddress !== normalizeEmailAddress(tokenInfo.email)) {
    throw new Error("The Google identity and Gmail mailbox do not match.");
  }

  const grantedScopes = new Set(tokenResponse.scope.split(/\s+/).filter(Boolean));
  if (!GMAIL_SCOPES.every((scope) => grantedScopes.has(scope))) {
    throw new Error("Google did not grant all required Gmail permissions.");
  }

  const [targetMailbox, duplicateCredential, duplicateAddress] = await Promise.all([
    oauthState.mailboxId
      ? db
          .select({
            emailAddress: mailbox.emailAddress,
            googleSubject: gmailCredential.googleSubject,
            id: mailbox.id,
            ownerUserId: mailbox.ownerUserId,
            refreshToken: gmailCredential.encryptedRefreshToken,
          })
          .from(mailbox)
          .innerJoin(gmailCredential, eq(gmailCredential.mailboxId, mailbox.id))
          .where(eq(mailbox.id, oauthState.mailboxId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({
        encryptedRefreshToken: gmailCredential.encryptedRefreshToken,
        mailboxId: gmailCredential.mailboxId,
        ownerUserId: mailbox.ownerUserId,
      })
      .from(gmailCredential)
      .innerJoin(mailbox, eq(mailbox.id, gmailCredential.mailboxId))
      .where(eq(gmailCredential.googleSubject, tokenInfo.sub))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        encryptedRefreshToken: gmailCredential.encryptedRefreshToken,
        googleSubject: gmailCredential.googleSubject,
        id: mailbox.id,
        ownerUserId: mailbox.ownerUserId,
      })
      .from(mailbox)
      .leftJoin(gmailCredential, eq(gmailCredential.mailboxId, mailbox.id))
      .where(eq(mailbox.emailAddress, emailAddress))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (
    targetMailbox &&
    (targetMailbox.ownerUserId !== session.user.id ||
      targetMailbox.googleSubject !== tokenInfo.sub ||
      normalizeEmailAddress(targetMailbox.emailAddress) !== emailAddress)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Reconnect by selecting the same Google account used by this mailbox.",
    });
  }

  if (
    duplicateAddress?.ownerUserId === session.user.id &&
    duplicateAddress.googleSubject &&
    duplicateAddress.googleSubject !== tokenInfo.sub
  ) {
    throw new ORPCError("CONFLICT", {
      message: "That address is already connected through a different Google identity.",
    });
  }

  if (
    (duplicateCredential && duplicateCredential.ownerUserId !== session.user.id) ||
    (duplicateAddress && duplicateAddress.ownerUserId !== session.user.id)
  ) {
    throw new ORPCError("CONFLICT", {
      message: "That Gmail mailbox is already connected to another Quieter user.",
    });
  }

  const existingMailboxId =
    targetMailbox?.id ?? duplicateCredential?.mailboxId ?? duplicateAddress?.id ?? null;
  const mailboxId = existingMailboxId ?? randomUUID();
  const encryptedRefreshToken =
    tokenResponse.refresh_token !== undefined
      ? encryptSecret(tokenResponse.refresh_token)
      : (targetMailbox?.refreshToken ??
        duplicateCredential?.encryptedRefreshToken ??
        duplicateAddress?.encryptedRefreshToken);
  if (!encryptedRefreshToken) {
    throw new Error("Google did not return an offline refresh token. Reconnect and grant access.");
  }

  const now = new Date();
  const mailboxWrite = existingMailboxId
    ? db
        .update(mailbox)
        .set({
          displayName: profile.emailAddress,
          emailAddress,
          organizationId: oauthState.organizationId,
          status: "connected",
          updatedAt: now,
        })
        .where(and(eq(mailbox.id, existingMailboxId), eq(mailbox.ownerUserId, session.user.id)))
    : db.insert(mailbox).values({
        createdAt: now,
        displayName: profile.emailAddress,
        emailAddress,
        id: mailboxId,
        organizationId: oauthState.organizationId,
        ownerUserId: session.user.id,
        provider: MAILBOX_PROVIDER_GMAIL,
        status: "connected",
        updatedAt: now,
      });
  const encryptedAccessToken = encryptSecret(tokenResponse.access_token);
  await db.batch([
    mailboxWrite,
    db
      .insert(gmailCredential)
      .values({
        accessTokenExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000),
        createdAt: now,
        encryptedAccessToken,
        encryptedRefreshToken,
        googleSubject: tokenInfo.sub,
        mailboxId,
        scopes: tokenResponse.scope,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          accessTokenExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000),
          encryptedAccessToken,
          encryptedRefreshToken,
          googleSubject: tokenInfo.sub,
          scopes: tokenResponse.scope,
          updatedAt: now,
        },
        target: gmailCredential.mailboxId,
      }),
  ]);

  return {
    mailboxId,
    returnTo: oauthState.returnTo,
  };
};

export const disconnectGmailMailbox = async (input: { mailboxId: string; userId: string }) => {
  const [deletedMailbox] = await db
    .delete(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL),
      ),
    )
    .returning({ id: mailbox.id });

  if (!deletedMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }

  await db
    .update(user)
    .set({ defaultMailboxId: null, updatedAt: new Date() })
    .where(and(eq(user.id, input.userId), eq(user.defaultMailboxId, input.mailboxId)));
  return { disconnected: true, mailboxId: input.mailboxId };
};

export const moveGmailMailbox = async (input: {
  mailboxId: string;
  organizationId: string | null;
  userId: string;
}) => {
  if (input.organizationId) {
    await assertOrganizationMembership(input.userId, input.organizationId);
  }

  const [updatedMailbox] = await db
    .update(mailbox)
    .set({ organizationId: input.organizationId, updatedAt: new Date() })
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL),
      ),
    )
    .returning({ id: mailbox.id, organizationId: mailbox.organizationId });
  if (!updatedMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }
  return updatedMailbox;
};

export const createManagedMailbox = async (input: {
  displayName?: string | null;
  emailAddress: string;
  organizationId: string;
  userId: string;
}) => {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, input.userId), eq(member.organizationId, input.organizationId)))
    .limit(1);
  if (!membership || !["admin", "owner"].includes(membership.role)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only organization owners and admins can create managed mailboxes.",
    });
  }

  const mailboxId = randomUUID();
  const grantId = randomUUID();
  const now = new Date();
  await db.batch([
    db.insert(mailbox).values({
      createdAt: now,
      displayName: input.displayName?.trim() || null,
      emailAddress: normalizeEmailAddress(input.emailAddress),
      id: mailboxId,
      organizationId: input.organizationId,
      ownerUserId: null,
      provider: MAILBOX_PROVIDER_MANAGED,
      status: "connected",
      updatedAt: now,
    }),
    db.insert(mailboxGrant).values({
      createdAt: now,
      id: grantId,
      mailboxId,
      role: "manager",
      updatedAt: now,
      userId: input.userId,
    }),
  ]);
  return { mailboxId };
};

const assertManagedMailboxManager = async (mailboxId: string, userId: string) => {
  const [grant] = await db
    .select({ id: mailboxGrant.id })
    .from(mailboxGrant)
    .innerJoin(mailbox, eq(mailbox.id, mailboxGrant.mailboxId))
    .innerJoin(
      member,
      and(eq(member.userId, userId), eq(member.organizationId, mailbox.organizationId)),
    )
    .where(
      and(
        eq(mailboxGrant.mailboxId, mailboxId),
        eq(mailboxGrant.userId, userId),
        eq(mailboxGrant.role, "manager"),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
      ),
    )
    .limit(1);
  if (!grant) {
    throw new ORPCError("FORBIDDEN", { message: "Mailbox manager access is required." });
  }
};

export const setManagedMailboxGrant = async (input: {
  mailboxId: string;
  role: MailboxGrantRole;
  targetUserId: string;
  userId: string;
}) => {
  await assertManagedMailboxManager(input.mailboxId, input.userId);
  const [target] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .innerJoin(
      member,
      and(eq(member.organizationId, mailbox.organizationId), eq(member.userId, input.targetUserId)),
    )
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (!target) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Mailbox grants can only be assigned to organization members.",
    });
  }

  const now = new Date();
  await db
    .insert(mailboxGrant)
    .values({
      createdAt: now,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      role: input.role,
      updatedAt: now,
      userId: input.targetUserId,
    })
    .onConflictDoUpdate({
      set: { role: input.role, updatedAt: now },
      target: [mailboxGrant.mailboxId, mailboxGrant.userId],
    });
  return { mailboxId: input.mailboxId, role: input.role, userId: input.targetUserId };
};

export const removeManagedMailboxGrant = async (input: {
  mailboxId: string;
  targetUserId: string;
  userId: string;
}) => {
  await assertManagedMailboxManager(input.mailboxId, input.userId);
  const managerGrants = await db
    .select({ userId: mailboxGrant.userId })
    .from(mailboxGrant)
    .where(and(eq(mailboxGrant.mailboxId, input.mailboxId), eq(mailboxGrant.role, "manager")));
  if (
    input.targetUserId === input.userId &&
    managerGrants.length === 1 &&
    managerGrants[0]?.userId === input.userId
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Assign another mailbox manager before removing the last manager.",
    });
  }

  await db
    .delete(mailboxGrant)
    .where(
      and(eq(mailboxGrant.mailboxId, input.mailboxId), eq(mailboxGrant.userId, input.targetUserId)),
    );
  return { removed: true };
};

export const getAuthorizedManagedMailbox = async (input: {
  mailboxId: string;
  requiredRoles?: MailboxGrantRole[];
  userId: string;
}) => {
  const roleConditions = input.requiredRoles?.map((role) => eq(mailboxGrant.role, role));
  const [selectedMailbox] = await db
    .select({
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      role: mailboxGrant.role,
    })
    .from(mailboxGrant)
    .innerJoin(mailbox, eq(mailbox.id, mailboxGrant.mailboxId))
    .innerJoin(
      member,
      and(eq(member.userId, input.userId), eq(member.organizationId, mailbox.organizationId)),
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailboxGrant.userId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
        roleConditions?.length ? or(...roleConditions) : undefined,
      ),
    )
    .limit(1);
  if (!selectedMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Managed mailbox not found." });
  }
  return selectedMailbox;
};

export const getUserMailboxPreferences = async (userId: string) => {
  const [row] = await db
    .select({
      defaultMailboxId: user.defaultMailboxId,
      mailboxSwitcherOrder: user.mailboxSwitcherOrder,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return {
    defaultMailboxId: row?.defaultMailboxId ?? null,
    mailboxSwitcherOrder: row?.mailboxSwitcherOrder ?? null,
  };
};

export const resolveDefaultMailboxId = (
  mailboxes: Array<{ id: string }>,
  defaultMailboxId: string | null,
) =>
  mailboxes.some((mailboxRecord) => mailboxRecord.id === defaultMailboxId)
    ? defaultMailboxId
    : null;

export const canonicalizeMailboxSwitcherOrder = (
  groups: MailboxGroup[],
  order: MailboxSwitcherOrder | null,
): MailboxSwitcherOrder => {
  const groupIds = groups.map((group) => group.id);
  const groupIdSet = new Set(groupIds);
  const seenGroupIds = new Set<string>();
  const orderedGroupIds = [
    ...(order?.groupIds.filter((groupId) => groupIdSet.has(groupId)) ?? []),
    ...groupIds,
  ].filter((groupId) => {
    if (seenGroupIds.has(groupId) || !groupIdSet.has(groupId)) return false;
    seenGroupIds.add(groupId);
    return true;
  });
  const mailboxIdsByGroupId: Record<string, string[]> = {};

  for (const group of groups) {
    const mailboxIds = group.mailboxes.map((record) => record.id);
    const mailboxIdSet = new Set(mailboxIds);
    const seenMailboxIds = new Set<string>();
    mailboxIdsByGroupId[group.id] = [
      ...(order?.mailboxIdsByGroupId[group.id] ?? []),
      ...mailboxIds,
    ].filter((mailboxId) => {
      if (seenMailboxIds.has(mailboxId) || !mailboxIdSet.has(mailboxId)) return false;
      seenMailboxIds.add(mailboxId);
      return true;
    });
  }

  return { groupIds: orderedGroupIds, mailboxIdsByGroupId };
};

export const applyMailboxSwitcherOrder = (
  groups: MailboxGroup[],
  order: MailboxSwitcherOrder | null,
): MailboxGroup[] => {
  if (!order) return groups;

  const canonicalOrder = canonicalizeMailboxSwitcherOrder(groups, order);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return canonicalOrder.groupIds.flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (!group) return [];
    const mailboxesById = new Map(group.mailboxes.map((record) => [record.id, record]));
    return [
      {
        ...group,
        mailboxes: canonicalOrder.mailboxIdsByGroupId[group.id].flatMap((mailboxId) => {
          const record = mailboxesById.get(mailboxId);
          return record ? [record] : [];
        }),
      },
    ];
  });
};

export const isGmailAccessRepairError = (error: unknown) =>
  isGmailServiceError(error) && (error.status === 401 || error.status === 403);
