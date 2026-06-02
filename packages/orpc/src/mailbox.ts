import type { MailboxSwitcherOrder } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { auth } from "@quieter/auth";
import { hasRequiredGoogleScopes } from "@quieter/auth/google-scopes";
import { account, db, mailbox, member, organization, user } from "@quieter/database";
import { getGmailProfile, isGmailServiceError } from "@quieter/gmail";
import { and, asc, eq, ne } from "drizzle-orm";

export const MAILBOX_PROVIDER_GMAIL = "gmail" as const;

const GMAIL_MAILBOX_ID_PREFIX = "gmail:";
const PERSONAL_GROUP_ID = "personal";
const PERSONAL_GROUP_NAME = "Personal";
const GMAIL_CONNECTED_STATUS = "connected";
const GMAIL_NEEDS_RECONNECT_STATUS = "needs_reconnect";

type BetterAuthLinkedAccount = Awaited<ReturnType<typeof auth.api.listUserAccounts>>[number];
type LinkedAccount = BetterAuthLinkedAccount & {
  disconnectedAt: Date | null;
};

type MailboxGroupMetadata = {
  groupId: string;
  groupKind: "personal" | "team";
  groupName: string;
};

type ManagedMailbox = MailboxGroupMetadata & {
  connectionStatus: typeof GMAIL_CONNECTED_STATUS;
  connectedUserId: null;
  displayName: string | null;
  emailAddress: string;
  id: string;
  organizationId: string;
  provider: string;
  providerAccountId: null;
};

type GmailMailbox = MailboxGroupMetadata & {
  connectionStatus: typeof GMAIL_CONNECTED_STATUS | typeof GMAIL_NEEDS_RECONNECT_STATUS;
  connectedUserId: string;
  displayName: string | null;
  emailAddress: string;
  id: string;
  organizationId: null;
  provider: typeof MAILBOX_PROVIDER_GMAIL;
  providerAccountId: string;
  reconnectReason: "disconnected" | "invalid_access_token" | "missing_scopes" | null;
};

export type MailboxListItem = GmailMailbox | ManagedMailbox;

export type MailboxGroup = {
  id: string;
  kind: "personal" | "team";
  mailboxes: MailboxListItem[];
  name: string;
  slug: string | null;
};

const createGmailMailboxId = (providerAccountId: string) =>
  `${GMAIL_MAILBOX_ID_PREFIX}${providerAccountId}`;

export const parseGmailProviderAccountId = (mailboxId: string) => {
  const normalizedMailboxId = mailboxId.trim();
  return normalizedMailboxId.startsWith(GMAIL_MAILBOX_ID_PREFIX)
    ? normalizedMailboxId.slice(GMAIL_MAILBOX_ID_PREFIX.length)
    : null;
};

const getGoogleAccountFallbackLabel = (providerAccountId: string) =>
  `Google account ${providerAccountId}`;

const decodeGoogleIdTokenEmail = (idToken: string | null | undefined) => {
  const payload = idToken?.split(".")[1];
  if (!payload) {
    return null;
  }

  try {
    const decodedPayload: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      decodedPayload &&
      typeof decodedPayload === "object" &&
      "email" in decodedPayload &&
      typeof decodedPayload.email === "string"
    ) {
      return decodedPayload.email.trim().toLowerCase() || null;
    }
  } catch {
    return null;
  }

  return null;
};

const getStoredGoogleAccountEmail = async (providerAccountId: string) => {
  const [storedAccount] = await db
    .select({
      idToken: account.idToken,
    })
    .from(account)
    .where(and(eq(account.providerId, "google"), eq(account.accountId, providerAccountId)))
    .limit(1);

  return decodeGoogleIdTokenEmail(storedAccount?.idToken);
};

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

const listManagedMailboxesForUser = async (userId: string): Promise<ManagedMailbox[]> => {
  const managedMailboxes = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      emailAddress: mailbox.emailAddress,
      displayName: mailbox.displayName,
      organizationName: organization.name,
    })
    .from(mailbox)
    .innerJoin(
      member,
      and(eq(member.organizationId, mailbox.organizationId), eq(member.userId, userId)),
    )
    .innerJoin(organization, eq(organization.id, mailbox.organizationId))
    .where(ne(mailbox.provider, MAILBOX_PROVIDER_GMAIL))
    .orderBy(asc(organization.name), asc(mailbox.emailAddress));

  return managedMailboxes.map((managedMailbox) => ({
    connectionStatus: GMAIL_CONNECTED_STATUS,
    connectedUserId: null,
    displayName: managedMailbox.displayName,
    emailAddress: managedMailbox.emailAddress,
    groupId: managedMailbox.organizationId,
    groupKind: "team",
    groupName: managedMailbox.organizationName,
    id: managedMailbox.id,
    organizationId: managedMailbox.organizationId,
    provider: managedMailbox.provider,
    providerAccountId: null,
  }));
};

export const listLinkedGoogleAccounts = async (input: { headers: Headers; userId: string }) => {
  const [linkedAccounts, storedAccounts] = await Promise.all([
    auth.api.listUserAccounts({
      headers: input.headers,
    }),
    db
      .select({
        accountId: account.accountId,
        accessToken: account.accessToken,
        disconnectedAt: account.disconnectedAt,
        refreshToken: account.refreshToken,
      })
      .from(account)
      .where(and(eq(account.userId, input.userId), eq(account.providerId, "google"))),
  ]);
  const storedAccountsById = new Map(
    storedAccounts.map((storedAccount) => [storedAccount.accountId, storedAccount]),
  );
  const reconnectedAccountIds: string[] = [];

  const googleAccounts = linkedAccounts
    .filter((linkedAccount) => linkedAccount.providerId === "google")
    .map((linkedAccount) => {
      const storedAccount = storedAccountsById.get(linkedAccount.accountId);
      const hasFreshTokens = !!storedAccount?.accessToken || !!storedAccount?.refreshToken;
      const wasReconnected =
        !!storedAccount?.disconnectedAt &&
        hasFreshTokens &&
        hasRequiredGoogleScopes(linkedAccount.scopes);

      if (wasReconnected) {
        reconnectedAccountIds.push(linkedAccount.accountId);
      }

      return {
        ...linkedAccount,
        disconnectedAt: wasReconnected ? null : (storedAccount?.disconnectedAt ?? null),
      };
    });

  await Promise.all(
    reconnectedAccountIds.map((accountId) =>
      db
        .update(account)
        .set({ disconnectedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(account.userId, input.userId),
            eq(account.providerId, "google"),
            eq(account.accountId, accountId),
          ),
        ),
    ),
  );

  return googleAccounts;
};

const getGoogleAccessTokenForLinkedAccount = async (
  headers: Headers,
  userId: string,
  providerAccountId: string,
) => {
  const response = await auth.api.getAccessToken({
    body: {
      providerId: "google",
      accountId: providerAccountId,
      userId,
    },
    headers,
  });

  return response?.accessToken ?? null;
};

const getGoogleMailboxRepairRequiredError = (selectedMailbox: {
  emailAddress: string;
  id: string;
  providerAccountId: string;
}) =>
  new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
    data: {
      emailAddress: selectedMailbox.emailAddress,
      mailboxId: selectedMailbox.id,
      providerAccountId: selectedMailbox.providerAccountId,
    },
    message: "Google access needs to be reconnected for this mailbox.",
    status: 409,
  });

const isGmailAccessRepairError = (error: unknown) => {
  return isGmailServiceError(error) && (error.status === 401 || error.status === 403);
};

const createGmailReconnectMailbox = async (input: {
  account: LinkedAccount;
  reconnectReason: NonNullable<GmailMailbox["reconnectReason"]>;
  userId: string;
}): Promise<GmailMailbox> => {
  const emailAddress =
    (await getStoredGoogleAccountEmail(input.account.accountId)) ??
    getGoogleAccountFallbackLabel(input.account.accountId);
  const mailboxId = createGmailMailboxId(input.account.accountId);
  return {
    connectionStatus: GMAIL_NEEDS_RECONNECT_STATUS,
    connectedUserId: input.userId,
    displayName: null,
    emailAddress,
    groupId: PERSONAL_GROUP_ID,
    groupKind: "personal",
    groupName: PERSONAL_GROUP_NAME,
    id: mailboxId,
    organizationId: null,
    provider: MAILBOX_PROVIDER_GMAIL,
    providerAccountId: input.account.accountId,
    reconnectReason: input.reconnectReason,
  } satisfies GmailMailbox;
};

const createGmailMailboxFromAccount = async (input: {
  account: LinkedAccount;
  headers: Headers;
  userId: string;
}): Promise<GmailMailbox> => {
  if (input.account.disconnectedAt) {
    return await createGmailReconnectMailbox({
      account: input.account,
      reconnectReason: "disconnected",
      userId: input.userId,
    });
  }

  if (!hasRequiredGoogleScopes(input.account.scopes)) {
    return await createGmailReconnectMailbox({
      account: input.account,
      reconnectReason: "missing_scopes",
      userId: input.userId,
    });
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleAccessTokenForLinkedAccount(
      input.headers,
      input.userId,
      input.account.accountId,
    );
  } catch {
    return await createGmailReconnectMailbox({
      account: input.account,
      reconnectReason: "invalid_access_token",
      userId: input.userId,
    });
  }

  if (!accessToken) {
    return await createGmailReconnectMailbox({
      account: input.account,
      reconnectReason: "invalid_access_token",
      userId: input.userId,
    });
  }

  try {
    const profile = await getGmailProfile(accessToken);
    const emailAddress =
      profile.emailAddress.trim().toLowerCase() ||
      getGoogleAccountFallbackLabel(input.account.accountId);

    return {
      connectionStatus: GMAIL_CONNECTED_STATUS,
      connectedUserId: input.userId,
      displayName: profile.emailAddress || null,
      emailAddress,
      groupId: PERSONAL_GROUP_ID,
      groupKind: "personal",
      groupName: PERSONAL_GROUP_NAME,
      id: createGmailMailboxId(input.account.accountId),
      organizationId: null,
      provider: MAILBOX_PROVIDER_GMAIL,
      providerAccountId: input.account.accountId,
      reconnectReason: null,
    };
  } catch (error) {
    if (!isGmailAccessRepairError(error)) {
      throw error;
    }

    return await createGmailReconnectMailbox({
      account: input.account,
      reconnectReason: "invalid_access_token",
      userId: input.userId,
    });
  }
};

export const listPersonalGmailMailboxes = async (input: { headers: Headers; userId: string }) => {
  const googleAccounts = await listLinkedGoogleAccounts(input);
  const gmailMailboxResults = await Promise.all(
    googleAccounts.map((account) =>
      createGmailMailboxFromAccount({
        account,
        headers: input.headers,
        userId: input.userId,
      }),
    ),
  );

  return {
    mailboxes: gmailMailboxResults.sort((left, right) =>
      left.emailAddress.localeCompare(right.emailAddress),
    ),
  };
};

export const refreshAuthorizedGmailAccessToken = async (input: {
  emailAddress: string;
  headers: Headers;
  mailboxId: string;
  providerAccountId: string;
  userId: string;
}) => {
  try {
    const response = await auth.api.refreshToken({
      body: {
        providerId: "google",
        accountId: input.providerAccountId,
        userId: input.userId,
      },
      headers: input.headers,
    });

    if (!response?.accessToken) {
      throw getGoogleMailboxRepairRequiredError({
        emailAddress: input.emailAddress,
        id: input.mailboxId,
        providerAccountId: input.providerAccountId,
      });
    }

    return response.accessToken;
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    throw getGoogleMailboxRepairRequiredError({
      emailAddress: input.emailAddress,
      id: input.mailboxId,
      providerAccountId: input.providerAccountId,
    });
  }
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
    if (seenGroupIds.has(groupId) || !groupIdSet.has(groupId)) {
      return false;
    }

    seenGroupIds.add(groupId);
    return true;
  });
  const mailboxIdsByGroupId: Record<string, string[]> = {};

  for (const group of groups) {
    const mailboxIds = group.mailboxes.map((mailboxRecord) => mailboxRecord.id);
    const mailboxIdSet = new Set(mailboxIds);
    const savedMailboxIds = order?.mailboxIdsByGroupId[group.id] ?? [];
    const seenMailboxIds = new Set<string>();

    mailboxIdsByGroupId[group.id] = [...savedMailboxIds, ...mailboxIds].filter((mailboxId) => {
      if (seenMailboxIds.has(mailboxId) || !mailboxIdSet.has(mailboxId)) {
        return false;
      }

      seenMailboxIds.add(mailboxId);
      return true;
    });
  }

  return {
    groupIds: orderedGroupIds,
    mailboxIdsByGroupId,
  };
};

export const applyMailboxSwitcherOrder = (
  groups: MailboxGroup[],
  order: MailboxSwitcherOrder | null,
): MailboxGroup[] => {
  if (!order) {
    return groups;
  }

  const canonicalOrder = canonicalizeMailboxSwitcherOrder(groups, order);
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  return canonicalOrder.groupIds.flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (!group) {
      return [];
    }

    const mailboxesById = new Map(
      group.mailboxes.map((mailboxRecord) => [mailboxRecord.id, mailboxRecord]),
    );
    const mailboxes = canonicalOrder.mailboxIdsByGroupId[group.id].flatMap((mailboxId) => {
      const mailboxRecord = mailboxesById.get(mailboxId);
      return mailboxRecord ? [mailboxRecord] : [];
    });

    return [
      {
        ...group,
        mailboxes,
      },
    ];
  });
};

export const listAccessibleMailboxState = async (input: { headers: Headers; userId: string }) => {
  const [organizations, managedMailboxes, gmailState] = await Promise.all([
    listUserOrganizations(input.userId),
    listManagedMailboxesForUser(input.userId),
    listPersonalGmailMailboxes({
      headers: input.headers,
      userId: input.userId,
    }),
  ]);
  const groups: MailboxGroup[] = [
    {
      id: PERSONAL_GROUP_ID,
      kind: "personal" as const,
      name: PERSONAL_GROUP_NAME,
      slug: null,
      mailboxes: gmailState.mailboxes,
    },
    ...organizations.map((team) => ({
      id: team.id,
      kind: "team" as const,
      name: team.name,
      slug: team.slug,
      mailboxes: managedMailboxes.filter(
        (mailboxRecord) => mailboxRecord.organizationId === team.id,
      ),
    })),
  ];

  return { gmailState, groups };
};

export const getAuthorizedGmailMailbox = async (input: {
  headers: Headers;
  mailboxId: string;
  userId: string;
}): Promise<{
  accessToken: string;
  mailbox: GmailMailbox;
}> => {
  const providerAccountId = parseGmailProviderAccountId(input.mailboxId);

  if (!providerAccountId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This mailbox provider is not supported by Gmail.",
    });
  }

  const linkedGoogleAccount = (
    await listLinkedGoogleAccounts({ headers: input.headers, userId: input.userId })
  ).find((account) => account.accountId === providerAccountId);

  if (!linkedGoogleAccount) {
    throw new ORPCError("NOT_FOUND", {
      message: "Google account not found for this user.",
    });
  }

  const emailAddress =
    (await getStoredGoogleAccountEmail(providerAccountId)) ??
    getGoogleAccountFallbackLabel(providerAccountId);
  const selectedMailbox = {
    connectionStatus: GMAIL_CONNECTED_STATUS,
    connectedUserId: input.userId,
    displayName: null,
    emailAddress,
    groupId: PERSONAL_GROUP_ID,
    groupKind: "personal",
    groupName: PERSONAL_GROUP_NAME,
    id: createGmailMailboxId(providerAccountId),
    organizationId: null,
    provider: MAILBOX_PROVIDER_GMAIL,
    providerAccountId,
    reconnectReason: null,
  } satisfies GmailMailbox;

  if (linkedGoogleAccount.disconnectedAt) {
    throw getGoogleMailboxRepairRequiredError(selectedMailbox);
  }

  if (!hasRequiredGoogleScopes(linkedGoogleAccount.scopes)) {
    throw getGoogleMailboxRepairRequiredError(selectedMailbox);
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleAccessTokenForLinkedAccount(
      input.headers,
      input.userId,
      providerAccountId,
    );
  } catch {
    throw getGoogleMailboxRepairRequiredError(selectedMailbox);
  }

  if (typeof accessToken === "string" && accessToken.length > 0) {
    return {
      accessToken,
      mailbox: selectedMailbox,
    };
  }

  throw getGoogleMailboxRepairRequiredError(selectedMailbox);
};

export const getAuthorizedManagedMailbox = async (input: { mailboxId: string; userId: string }) => {
  const [selectedMailbox] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      emailAddress: mailbox.emailAddress,
      displayName: mailbox.displayName,
    })
    .from(mailbox)
    .innerJoin(
      member,
      and(eq(member.organizationId, mailbox.organizationId), eq(member.userId, input.userId)),
    )
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);

  if (!selectedMailbox) {
    throw new ORPCError("NOT_FOUND", {
      message: "Mailbox not found.",
    });
  }

  return selectedMailbox;
};
