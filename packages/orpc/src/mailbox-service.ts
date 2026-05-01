import type { MailboxSwitcherOrder } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { auth } from "@quieter/auth";
import { hasRequiredGoogleScopes } from "@quieter/auth/google-scopes";
import { db, mailbox, member, organization, user } from "@quieter/database";
import { and, asc, eq, ne } from "drizzle-orm";
import { getGmailProfile, isGmailServiceError } from "./gmail-service";

export const MAILBOX_PROVIDER_GMAIL = "gmail" as const;

const GMAIL_MAILBOX_ID_PREFIX = "gmail:";
const PERSONAL_GROUP_ID = "personal";
const PERSONAL_GROUP_NAME = "Personal";

type LinkedAccount = Awaited<ReturnType<typeof auth.api.listUserAccounts>>[number];

type MailboxGroupMetadata = {
  groupId: string;
  groupKind: "personal" | "team";
  groupName: string;
};

type ManagedMailbox = MailboxGroupMetadata & {
  connectedUserId: null;
  displayName: string | null;
  emailAddress: string;
  id: string;
  organizationId: string;
  provider: string;
  providerAccountId: null;
};

type GmailMailbox = MailboxGroupMetadata & {
  connectedUserId: string;
  displayName: string | null;
  emailAddress: string;
  id: string;
  organizationId: null;
  provider: typeof MAILBOX_PROVIDER_GMAIL;
  providerAccountId: string;
};

export type MailboxListItem = GmailMailbox | ManagedMailbox;

export type MailboxGroup = {
  id: string;
  kind: "personal" | "team";
  mailboxes: MailboxListItem[];
  name: string;
  slug: string | null;
};

export type GoogleScopeRepairTarget = {
  displayName: string | null;
  emailAddress: string;
  isStillMissingScopes: boolean;
  mailboxId: string;
  providerAccountId: string;
  repairReason: "invalid_access_token" | "missing_scopes";
};

const createGmailMailboxId = (providerAccountId: string) =>
  `${GMAIL_MAILBOX_ID_PREFIX}${providerAccountId}`;

const parseGmailProviderAccountId = (mailboxId: string) => {
  const normalizedMailboxId = mailboxId.trim();
  return normalizedMailboxId.startsWith(GMAIL_MAILBOX_ID_PREFIX)
    ? normalizedMailboxId.slice(GMAIL_MAILBOX_ID_PREFIX.length)
    : null;
};

const getGoogleAccountFallbackLabel = (providerAccountId: string) =>
  `Google account ${providerAccountId}`;

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

const listLinkedGoogleAccounts = async (headers: Headers) => {
  const linkedAccounts = await auth.api.listUserAccounts({
    headers,
  });

  return linkedAccounts.filter((account) => account.providerId === "google");
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

const createGmailRepairMailbox = (input: {
  account: LinkedAccount;
  repairReason: GoogleScopeRepairTarget["repairReason"];
  userId: string;
}): {
  mailbox: GmailMailbox;
  repairTarget: GoogleScopeRepairTarget;
} => {
  const emailAddress = getGoogleAccountFallbackLabel(input.account.accountId);
  const mailboxId = createGmailMailboxId(input.account.accountId);
  const mailboxRecord = {
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
  } satisfies GmailMailbox;

  return {
    mailbox: mailboxRecord,
    repairTarget: {
      displayName: mailboxRecord.displayName,
      emailAddress: mailboxRecord.emailAddress,
      isStillMissingScopes: input.repairReason === "missing_scopes",
      mailboxId,
      providerAccountId: input.account.accountId,
      repairReason: input.repairReason,
    },
  };
};

const createGmailMailboxFromAccount = async (input: {
  account: LinkedAccount;
  headers: Headers;
  userId: string;
}): Promise<{
  mailbox: GmailMailbox | null;
  repairTarget: GoogleScopeRepairTarget | null;
}> => {
  if (!hasRequiredGoogleScopes(input.account.scopes)) {
    const repair = createGmailRepairMailbox({
      account: input.account,
      repairReason: "missing_scopes",
      userId: input.userId,
    });

    return {
      mailbox: null,
      repairTarget: repair.repairTarget,
    };
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleAccessTokenForLinkedAccount(
      input.headers,
      input.userId,
      input.account.accountId,
    );
  } catch {
    const repair = createGmailRepairMailbox({
      account: input.account,
      repairReason: "invalid_access_token",
      userId: input.userId,
    });

    return {
      mailbox: null,
      repairTarget: repair.repairTarget,
    };
  }

  if (!accessToken) {
    const repair = createGmailRepairMailbox({
      account: input.account,
      repairReason: "invalid_access_token",
      userId: input.userId,
    });

    return {
      mailbox: null,
      repairTarget: repair.repairTarget,
    };
  }

  try {
    const profile = await getGmailProfile(accessToken);
    const emailAddress =
      profile.emailAddress.trim().toLowerCase() ||
      getGoogleAccountFallbackLabel(input.account.accountId);

    return {
      mailbox: {
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
      },
      repairTarget: null,
    };
  } catch (error) {
    if (!isGmailAccessRepairError(error)) {
      throw error;
    }

    const repair = createGmailRepairMailbox({
      account: input.account,
      repairReason: "invalid_access_token",
      userId: input.userId,
    });

    return {
      mailbox: null,
      repairTarget: repair.repairTarget,
    };
  }
};

const listPersonalGmailMailboxes = async (input: {
  headers: Headers;
  includeRepairTargets?: boolean;
  userId: string;
}) => {
  const googleAccounts = await listLinkedGoogleAccounts(input.headers);
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
    mailboxes: gmailMailboxResults
      .map((result) => result.mailbox)
      .filter((mailbox): mailbox is GmailMailbox => mailbox != null)
      .sort((left, right) => left.emailAddress.localeCompare(right.emailAddress)),
    repairTargets: input.includeRepairTargets
      ? gmailMailboxResults
          .flatMap((result) => (result.repairTarget ? [result.repairTarget] : []))
          .sort((left, right) => left.emailAddress.localeCompare(right.emailAddress))
      : [],
  };
};

const resolveGoogleScopeRepairTarget = (input: {
  preferredMailboxId?: string | null;
  repairTargets: GoogleScopeRepairTarget[];
  targetAccountId?: string | null;
}) => {
  if (input.repairTargets.length === 0) {
    return null;
  }

  if (input.targetAccountId) {
    const matchingTarget = input.repairTargets.find(
      (candidate) => candidate.providerAccountId === input.targetAccountId,
    );

    if (matchingTarget) {
      return matchingTarget;
    }
  }

  if (input.preferredMailboxId) {
    const matchingMailbox = input.repairTargets.find(
      (candidate) => candidate.mailboxId === input.preferredMailboxId,
    );

    if (matchingMailbox) {
      return matchingMailbox;
    }
  }

  return input.repairTargets[0] ?? null;
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

export const syncPersonalGmailMailboxes = async (input: { headers: Headers; userId: string }) => {
  const gmailState = await listPersonalGmailMailboxes({
    headers: input.headers,
    userId: input.userId,
  });

  return {
    googleScopeRepairTarget: resolveGoogleScopeRepairTarget({
      repairTargets: gmailState.repairTargets,
    }),
    mailboxes: gmailState.mailboxes,
  };
};

export const getGoogleScopeRepairTarget = async (input: {
  headers: Headers;
  preferredMailboxId?: string | null;
  targetAccountId?: string | null;
  userId: string;
}) => {
  const gmailState = await listPersonalGmailMailboxes({
    headers: input.headers,
    includeRepairTargets: true,
    userId: input.userId,
  });

  return resolveGoogleScopeRepairTarget({
    preferredMailboxId: input.preferredMailboxId,
    repairTargets: gmailState.repairTargets,
    targetAccountId: input.targetAccountId,
  });
};

const getUserMailboxPreferences = async (userId: string) => {
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
  const orderedGroupIds = [
    ...(order?.groupIds.filter((groupId) => groupIdSet.has(groupId)) ?? []),
    ...groupIds.filter((groupId) => !order?.groupIds.includes(groupId)),
  ];
  const mailboxIdsByGroupId: Record<string, string[]> = {};

  for (const group of groups) {
    const mailboxIds = group.mailboxes.map((mailboxRecord) => mailboxRecord.id);
    const mailboxIdSet = new Set(mailboxIds);
    const savedMailboxIds = order?.mailboxIdsByGroupId[group.id] ?? [];

    mailboxIdsByGroupId[group.id] = [
      ...savedMailboxIds.filter((mailboxId) => mailboxIdSet.has(mailboxId)),
      ...mailboxIds.filter((mailboxId) => !savedMailboxIds.includes(mailboxId)),
    ];
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

const listAccessibleMailboxState = async (input: { headers: Headers; userId: string }) => {
  const [organizations, managedMailboxes, gmailState] = await Promise.all([
    listUserOrganizations(input.userId),
    listManagedMailboxesForUser(input.userId),
    listPersonalGmailMailboxes({
      headers: input.headers,
      includeRepairTargets: true,
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

export const listMailboxes = async (input: { headers: Headers; userId: string }) => {
  const [mailboxPreferences, mailboxState] = await Promise.all([
    getUserMailboxPreferences(input.userId),
    listAccessibleMailboxState(input),
  ]);
  const { gmailState, groups } = mailboxState;
  const orderedGroups = applyMailboxSwitcherOrder(groups, mailboxPreferences.mailboxSwitcherOrder);
  const allMailboxes: MailboxListItem[] = orderedGroups.flatMap((group) => group.mailboxes);

  return {
    defaultMailboxId: resolveDefaultMailboxId(allMailboxes, mailboxPreferences.defaultMailboxId),
    groups: orderedGroups,
    googleScopeRepairTarget: resolveGoogleScopeRepairTarget({
      repairTargets: gmailState.repairTargets,
    }),
  };
};

export const updateMailboxSwitcherOrder = async (input: {
  headers: Headers;
  order: MailboxSwitcherOrder;
  userId: string;
}) => {
  const mailboxState = await listAccessibleMailboxState(input);
  const canonicalOrder = canonicalizeMailboxSwitcherOrder(mailboxState.groups, input.order);

  await db
    .update(user)
    .set({ mailboxSwitcherOrder: canonicalOrder, updatedAt: new Date() })
    .where(eq(user.id, input.userId));

  return { mailboxSwitcherOrder: canonicalOrder };
};

const getAuthorizedManagedMailbox = async (input: { mailboxId: string; userId: string }) => {
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

  const linkedGoogleAccount = (await listLinkedGoogleAccounts(input.headers)).find(
    (account) => account.accountId === providerAccountId,
  );

  if (!linkedGoogleAccount) {
    throw new ORPCError("NOT_FOUND", {
      message: "Google account not found for this user.",
    });
  }

  const selectedMailbox = {
    connectedUserId: input.userId,
    displayName: null,
    emailAddress: getGoogleAccountFallbackLabel(providerAccountId),
    groupId: PERSONAL_GROUP_ID,
    groupKind: "personal",
    groupName: PERSONAL_GROUP_NAME,
    id: createGmailMailboxId(providerAccountId),
    organizationId: null,
    provider: MAILBOX_PROVIDER_GMAIL,
    providerAccountId,
  } satisfies GmailMailbox;

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

export const setDefaultMailbox = async (input: {
  headers: Headers;
  mailboxId: string | null;
  userId: string;
}) => {
  if (input.mailboxId) {
    const providerAccountId = parseGmailProviderAccountId(input.mailboxId);

    if (providerAccountId) {
      const linkedGoogleAccount = (await listLinkedGoogleAccounts(input.headers)).find(
        (account) => account.accountId === providerAccountId,
      );

      if (!linkedGoogleAccount) {
        throw new ORPCError("NOT_FOUND", {
          message: "Google account not found for this user.",
        });
      }
    } else {
      await getAuthorizedManagedMailbox({
        mailboxId: input.mailboxId,
        userId: input.userId,
      });
    }
  }

  await db
    .update(user)
    .set({ defaultMailboxId: input.mailboxId, updatedAt: new Date() })
    .where(eq(user.id, input.userId));

  return { defaultMailboxId: input.mailboxId };
};

export const disconnectPersonalGmailMailbox = async (input: {
  headers: Headers;
  mailboxId: string;
  userId: string;
}) => {
  const providerAccountId = parseGmailProviderAccountId(input.mailboxId);

  if (!providerAccountId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Only Gmail accounts can be disconnected here.",
    });
  }

  await auth.api.unlinkAccount({
    body: {
      providerId: "google",
      accountId: providerAccountId,
    },
    headers: input.headers,
  });

  await db
    .update(user)
    .set({ defaultMailboxId: null, updatedAt: new Date() })
    .where(and(eq(user.id, input.userId), eq(user.defaultMailboxId, input.mailboxId)));

  return {
    disconnected: true,
    mailboxId: input.mailboxId,
  };
};
