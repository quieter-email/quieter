import type {
  MailboxConnectionStatus,
  MailboxGrantRole,
  MailboxProvider,
} from "@quieter/database/schema";
import { ORPCError } from "@orpc/server";
import { auth } from "@quieter/auth";
import { db } from "@quieter/database/client";
import {
  gmailCredential,
  gmailOAuthState,
  mailbox,
  mailboxAutomationSettings,
  mailboxDivisionGrant,
  mailboxGrant,
  member,
  organization,
  organizationApiMailMessage,
  organizationDivision,
  organizationDivisionMember,
  user,
} from "@quieter/database/schema";
import { getGmailProfile, isGmailServiceError } from "@quieter/gmail";
import { and, asc, count, eq, inArray, lt } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { MailboxGroup, MailboxGroupMetadata, MailboxListItem } from "./types";
import { encryptSecret, getGmailOAuthConfig, GMAIL_SCOPES } from "../gmail-mailbox-access";
import { getOrganizationApiMailboxId } from "../organization-api-mail";

export {
  GMAIL_SCOPES,
  getAuthorizedGmailMailbox,
  markGmailMailboxNeedsReconnect,
  refreshAuthorizedGmailAccessToken,
  runAuthorizedGmailMailbox,
} from "../gmail-mailbox-access";

export {
  getAuthorizedManagedMailbox,
  MAILBOX_PROVIDER_GMAIL,
  MAILBOX_PROVIDER_MANAGED,
} from "./access";
import {
  getAuthorizedManagedMailbox,
  getStrongestMailboxGrantRole,
  MAILBOX_PROVIDER_GMAIL,
  MAILBOX_PROVIDER_MANAGED,
} from "./access";

const GMAIL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export type { MailboxGroup, MailboxListItem } from "./types";

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
      message: "You are not a member of that team.",
    });
  }
};

const toMailboxListItem = (
  record: {
    directGrantRole?: MailboxGrantRole | null;
    displayName: string | null;
    divisionGrantRoles?: Array<{
      divisionId: string;
      divisionName: string;
      role: MailboxGrantRole;
    }>;
    divisionId?: string | null;
    divisionName?: string | null;
    emailAddress: string;
    grantRole: MailboxGrantRole | null;
    gmailAutoLabelEnabled?: boolean | null;
    gmailCredentialMailboxId?: string | null;
    gmailUsefulDetailsEnabled?: boolean | null;
    id: string;
    includeApiSentMessages?: boolean | null;
    organizationId: string;
    ownerUserId: string | null;
    provider: "api" | "gmail" | "managed";
    status: "connected" | "needs_reconnect";
  },
  group: MailboxGroupMetadata,
): MailboxListItem => ({
  connectionStatus:
    record.provider === MAILBOX_PROVIDER_GMAIL && !record.gmailCredentialMailboxId
      ? "needs_reconnect"
      : record.status,
  directGrantRole: record.directGrantRole ?? null,
  displayName: record.displayName,
  divisionGrantRoles: record.divisionGrantRoles ?? [],
  divisionId: record.divisionId ?? null,
  divisionName: record.divisionName ?? null,
  emailAddress: record.emailAddress,
  grantRole: record.grantRole,
  gmailAutoLabelEnabled: record.gmailAutoLabelEnabled ?? false,
  gmailUsefulDetailsEnabled: record.gmailUsefulDetailsEnabled ?? false,
  groupId: group.groupId,
  groupKind: group.groupKind,
  groupName: group.groupName,
  id: record.id,
  includeApiSentMessages: record.includeApiSentMessages ?? false,
  organizationId: record.organizationId,
  ownerUserId: record.ownerUserId,
  provider: record.provider,
});

export const listAccessibleMailboxState = async (input: { userId: string }) => {
  const organizations = await listUserOrganizations(input.userId);

  const [gmailMailboxes, directManagedMailboxes, divisionManagedMailboxes, apiMessageCounts] =
    await Promise.all([
      db
        .select({
          divisionId: mailbox.divisionId,
          divisionName: organizationDivision.name,
          displayName: mailbox.displayName,
          emailAddress: mailbox.emailAddress,
          gmailAutoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
          gmailCredentialMailboxId: gmailCredential.mailboxId,
          gmailUsefulDetailsEnabled: mailboxAutomationSettings.usefulDetailsEnabled,
          id: mailbox.id,
          includeApiSentMessages: mailbox.includeApiSentMessages,
          organizationId: mailbox.organizationId,
          ownerUserId: mailbox.ownerUserId,
          provider: mailbox.provider,
          status: mailbox.status,
        })
        .from(mailbox)
        .leftJoin(gmailCredential, eq(gmailCredential.mailboxId, mailbox.id))
        .leftJoin(mailboxAutomationSettings, eq(mailboxAutomationSettings.mailboxId, mailbox.id))
        .leftJoin(organizationDivision, eq(organizationDivision.id, mailbox.divisionId))
        .where(
          and(eq(mailbox.ownerUserId, input.userId), eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL)),
        )
        .orderBy(asc(mailbox.emailAddress)),
      db
        .select({
          directGrantRole: mailboxGrant.role,
          divisionId: mailbox.divisionId,
          divisionName: organizationDivision.name,
          displayName: mailbox.displayName,
          emailAddress: mailbox.emailAddress,
          grantRole: mailboxGrant.role,
          gmailAutoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
          gmailUsefulDetailsEnabled: mailboxAutomationSettings.usefulDetailsEnabled,
          id: mailbox.id,
          includeApiSentMessages: mailbox.includeApiSentMessages,
          organizationId: mailbox.organizationId,
          ownerUserId: mailbox.ownerUserId,
          provider: mailbox.provider,
          status: mailbox.status,
        })
        .from(mailboxGrant)
        .innerJoin(mailbox, eq(mailbox.id, mailboxGrant.mailboxId))
        .leftJoin(mailboxAutomationSettings, eq(mailboxAutomationSettings.mailboxId, mailbox.id))
        .leftJoin(organizationDivision, eq(organizationDivision.id, mailbox.divisionId))
        .innerJoin(
          member,
          and(eq(member.userId, input.userId), eq(member.organizationId, mailbox.organizationId)),
        )
        .where(
          and(
            eq(mailboxGrant.userId, input.userId),
            eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
          ),
        )
        .orderBy(asc(mailbox.emailAddress)),
      db
        .select({
          accessDivisionId: organizationDivision.id,
          accessDivisionName: organizationDivision.name,
          directGrantRole: mailboxGrant.role,
          divisionGrantRole: mailboxDivisionGrant.role,
          divisionId: mailbox.divisionId,
          divisionName: organizationDivision.name,
          displayName: mailbox.displayName,
          emailAddress: mailbox.emailAddress,
          grantRole: mailboxDivisionGrant.role,
          gmailAutoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
          gmailUsefulDetailsEnabled: mailboxAutomationSettings.usefulDetailsEnabled,
          id: mailbox.id,
          includeApiSentMessages: mailbox.includeApiSentMessages,
          organizationId: mailbox.organizationId,
          ownerUserId: mailbox.ownerUserId,
          provider: mailbox.provider,
          status: mailbox.status,
        })
        .from(mailboxDivisionGrant)
        .innerJoin(mailbox, eq(mailbox.id, mailboxDivisionGrant.mailboxId))
        .innerJoin(
          organizationDivision,
          eq(organizationDivision.id, mailboxDivisionGrant.divisionId),
        )
        .innerJoin(
          organizationDivisionMember,
          eq(organizationDivisionMember.divisionId, organizationDivision.id),
        )
        .innerJoin(
          member,
          and(
            eq(member.id, organizationDivisionMember.memberId),
            eq(member.userId, input.userId),
            eq(member.organizationId, mailbox.organizationId),
          ),
        )
        .leftJoin(
          mailboxGrant,
          and(eq(mailboxGrant.mailboxId, mailbox.id), eq(mailboxGrant.userId, input.userId)),
        )
        .leftJoin(mailboxAutomationSettings, eq(mailboxAutomationSettings.mailboxId, mailbox.id))
        .where(
          and(
            eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
            eq(organizationDivision.organizationId, mailbox.organizationId),
          ),
        )
        .orderBy(asc(mailbox.emailAddress)),
      db
        .select({
          count: count(),
          organizationId: organizationApiMailMessage.organizationId,
        })
        .from(organizationApiMailMessage)
        .where(
          organizations.length > 0
            ? inArray(
                organizationApiMailMessage.organizationId,
                organizations.map((organization) => organization.id),
              )
            : undefined,
        )
        .groupBy(organizationApiMailMessage.organizationId),
    ]);
  const apiMessageCountsByOrganizationId = new Map(
    apiMessageCounts.map((record) => [record.organizationId, Number(record.count)]),
  );
  const divisions =
    organizations.length === 0
      ? []
      : await db
          .select({ id: organizationDivision.id, name: organizationDivision.name })
          .from(organizationDivision)
          .where(
            inArray(
              organizationDivision.organizationId,
              organizations.map((organization) => organization.id),
            ),
          );
  const divisionNamesById = new Map(divisions.map((division) => [division.id, division.name]));

  type ManagedMailboxRecord = {
    directGrantRole: MailboxGrantRole | null;
    displayName: string | null;
    divisionGrantRoles: Array<{
      divisionId: string;
      divisionName: string;
      role: MailboxGrantRole;
    }>;
    divisionId: string | null;
    divisionName: string | null;
    emailAddress: string;
    grantRole: MailboxGrantRole | null;
    gmailAutoLabelEnabled: boolean | null;
    gmailUsefulDetailsEnabled: boolean | null;
    id: string;
    includeApiSentMessages: boolean | null;
    organizationId: string;
    ownerUserId: string | null;
    provider: MailboxProvider;
    status: MailboxConnectionStatus;
  };
  const managedMailboxRecords = new Map<string, ManagedMailboxRecord>();

  for (const record of directManagedMailboxes) {
    managedMailboxRecords.set(record.id, { ...record, divisionGrantRoles: [] });
  }

  for (const record of divisionManagedMailboxes) {
    const normalizedRecord = {
      ...record,
      divisionName: record.divisionId ? (divisionNamesById.get(record.divisionId) ?? null) : null,
    };
    const divisionGrant = {
      divisionId: normalizedRecord.accessDivisionId,
      divisionName: normalizedRecord.accessDivisionName,
      role: normalizedRecord.divisionGrantRole,
    };
    const existing = managedMailboxRecords.get(normalizedRecord.id);
    if (existing) {
      existing.divisionGrantRoles.push(divisionGrant);
      existing.grantRole =
        getStrongestMailboxGrantRole([existing.grantRole, normalizedRecord.divisionGrantRole]) ??
        normalizedRecord.divisionGrantRole;
      continue;
    }
    managedMailboxRecords.set(normalizedRecord.id, {
      ...normalizedRecord,
      grantRole:
        getStrongestMailboxGrantRole([
          normalizedRecord.directGrantRole,
          normalizedRecord.divisionGrantRole,
        ]) ?? normalizedRecord.divisionGrantRole,
      divisionGrantRoles: [divisionGrant],
    });
  }

  const managedMailboxes = [...managedMailboxRecords.values()].sort((left, right) =>
    left.emailAddress.localeCompare(right.emailAddress),
  );

  const groups: MailboxGroup[] = organizations.flatMap((organizationRecord) => {
    const organizationGmailMailboxes = gmailMailboxes
      .filter((record) => record.organizationId === organizationRecord.id)
      .map((record) =>
        toMailboxListItem(
          { ...record, directGrantRole: null, grantRole: null },
          {
            groupId: organizationRecord.id,
            groupKind: "organization",
            groupName: organizationRecord.name,
          },
        ),
      );
    const organizationManagedMailboxes = managedMailboxes.filter(
      (record) => record.organizationId === organizationRecord.id,
    );
    const divisionIds = Array.from(
      new Set(
        organizationManagedMailboxes.flatMap((record) =>
          record.divisionId && record.divisionName ? [record.divisionId] : [],
        ),
      ),
    );
    const managedGroups = divisionIds.map((divisionId) => {
      const divisionName =
        organizationManagedMailboxes.find((record) => record.divisionId === divisionId)
          ?.divisionName ?? "Division";
      return {
        id: `division:${divisionId}`,
        kind: "division" as const,
        mailboxes: organizationManagedMailboxes
          .filter((record) => record.divisionId === divisionId)
          .map((record) =>
            toMailboxListItem(record, {
              groupId: `division:${divisionId}`,
              groupKind: "division",
              groupName: divisionName,
            }),
          ),
        name: divisionName,
        organizationId: organizationRecord.id,
        slug: organizationRecord.slug,
      };
    });
    const unassignedMailboxes = organizationManagedMailboxes
      .filter((record) => !record.divisionId)
      .map((record) =>
        toMailboxListItem(record, {
          groupId: `team:${organizationRecord.id}:unassigned`,
          groupKind: "unassigned",
          groupName: "Unassigned",
        }),
      );
    const apiMailboxes =
      (apiMessageCountsByOrganizationId.get(organizationRecord.id) ?? 0) > 0
        ? [
            toMailboxListItem(
              {
                displayName: "API messages",
                emailAddress: "API messages",
                grantRole: null,
                id: getOrganizationApiMailboxId(organizationRecord.id),
                includeApiSentMessages: false,
                organizationId: organizationRecord.id,
                ownerUserId: null,
                provider: "api",
                status: "connected",
              },
              {
                groupId: organizationRecord.id,
                groupKind: "organization",
                groupName: organizationRecord.name,
              },
            ),
          ]
        : [];

    return [
      ...(organizationGmailMailboxes.length || apiMailboxes.length
        ? [
            {
              id: organizationRecord.id,
              kind: "organization" as const,
              mailboxes: [...apiMailboxes, ...organizationGmailMailboxes],
              name: organizationRecord.name,
              organizationId: organizationRecord.id,
              slug: organizationRecord.slug,
            },
          ]
        : []),
      ...managedGroups,
      ...(unassignedMailboxes.length
        ? [
            {
              id: `team:${organizationRecord.id}:unassigned`,
              kind: "unassigned" as const,
              mailboxes: unassignedMailboxes,
              name: "Unassigned",
              organizationId: organizationRecord.id,
              slug: organizationRecord.slug,
            },
          ]
        : []),
    ];
  });

  return { groups };
};

export const assertAccessibleMailbox = async (input: { mailboxId: string; userId: string }) => {
  const [ownedGmailMailbox] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
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

  if (ownedGmailMailbox) {
    return ownedGmailMailbox;
  }

  try {
    const grantedManagedMailbox = await getAuthorizedManagedMailbox(input);
    return {
      id: grantedManagedMailbox.id,
      organizationId: grantedManagedMailbox.organizationId,
      provider: grantedManagedMailbox.provider,
    };
  } catch (error) {
    if (!(error instanceof ORPCError)) {
      throw error;
    }
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
};

export const startGmailOAuth = async (input: {
  mailboxId?: string;
  organizationId?: string | null;
  returnTo?: string;
  userId: string;
}) => {
  await db.delete(gmailOAuthState).where(lt(gmailOAuthState.expiresAt, new Date()));

  let loginHint: string | null = null;
  let organizationId = input.organizationId;
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

  if (!organizationId) {
    organizationId = (await listUserOrganizations(input.userId))[0]?.id;
  }
  if (!organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Create a team before connecting Gmail.",
    });
  }
  await assertOrganizationMembership(input.userId, organizationId);

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
  await mailboxWrite;
  await db
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
    });

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
  organizationId: string;
  userId: string;
}) => {
  await assertOrganizationMembership(input.userId, input.organizationId);

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

export const isGmailAccessRepairError = (error: unknown) =>
  isGmailServiceError(error) && (error.status === 401 || error.status === 403);
