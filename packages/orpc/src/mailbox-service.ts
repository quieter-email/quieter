import { ORPCError } from "@orpc/server";
import { auth } from "@quieter/auth";
import { hasRequiredGoogleScopes } from "@quieter/auth/google-scopes";
import { db, mailbox, member, organization } from "@quieter/database";
import { and, asc, eq, ne } from "drizzle-orm";
import { getGmailProfile, isGmailServiceError } from "./gmail-service";

export const MAILBOX_PROVIDER_GMAIL = "gmail" as const;

const GMAIL_MAILBOX_ID_PREFIX = "gmail:";

type LinkedAccount = Awaited<ReturnType<typeof auth.api.listUserAccounts>>[number];

type ActiveOrganization = {
  id: string;
  name: string;
  personalOwnerUserId: string | null;
  slug: string;
};

type ManagedMailbox = {
  connectedUserId: null;
  displayName: string | null;
  emailAddress: string;
  id: string;
  organizationId: string;
  provider: string;
  providerAccountId: null;
};

type GmailMailbox = {
  connectedUserId: string;
  displayName: string | null;
  emailAddress: string;
  id: string;
  organizationId: string;
  provider: typeof MAILBOX_PROVIDER_GMAIL;
  providerAccountId: string;
};

export type MailboxListItem = GmailMailbox | ManagedMailbox;

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

const throwPersonalOrganizationRequired = (activeOrganizationId: string) => {
  throw new ORPCError("PERSONAL_ORGANIZATION_REQUIRED", {
    data: {
      activeOrganizationId,
    },
    message: "Gmail accounts can only be managed in your personal organization.",
    status: 409,
  });
};

export const getActiveOrganization = async (
  organizationId: string,
): Promise<ActiveOrganization> => {
  const [activeOrganization] = await db
    .select({
      id: organization.id,
      name: organization.name,
      personalOwnerUserId: organization.personalOwnerUserId,
      slug: organization.slug,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!activeOrganization) {
    throw new ORPCError("NOT_FOUND", {
      message: "The active organization could not be found.",
    });
  }

  return activeOrganization;
};

const listManagedMailboxesForOrganization = async (
  organizationId: string,
): Promise<ManagedMailbox[]> => {
  const managedMailboxes = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      emailAddress: mailbox.emailAddress,
      displayName: mailbox.displayName,
    })
    .from(mailbox)
    .where(
      and(eq(mailbox.organizationId, organizationId), ne(mailbox.provider, MAILBOX_PROVIDER_GMAIL)),
    )
    .orderBy(asc(mailbox.emailAddress));

  return managedMailboxes.map((managedMailbox) => ({
    ...managedMailbox,
    connectedUserId: null,
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
  organizationId: string;
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
    id: mailboxId,
    organizationId: input.organizationId,
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
  organizationId: string;
  userId: string;
}): Promise<{
  mailbox: GmailMailbox;
  repairTarget: GoogleScopeRepairTarget | null;
}> => {
  if (!hasRequiredGoogleScopes(input.account.scopes)) {
    return createGmailRepairMailbox({
      account: input.account,
      organizationId: input.organizationId,
      repairReason: "missing_scopes",
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
    return createGmailRepairMailbox({
      account: input.account,
      organizationId: input.organizationId,
      repairReason: "invalid_access_token",
      userId: input.userId,
    });
  }

  if (!accessToken) {
    return createGmailRepairMailbox({
      account: input.account,
      organizationId: input.organizationId,
      repairReason: "invalid_access_token",
      userId: input.userId,
    });
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
        id: createGmailMailboxId(input.account.accountId),
        organizationId: input.organizationId,
        provider: MAILBOX_PROVIDER_GMAIL,
        providerAccountId: input.account.accountId,
      },
      repairTarget: null,
    };
  } catch (error) {
    if (!isGmailAccessRepairError(error)) {
      throw error;
    }

    return createGmailRepairMailbox({
      account: input.account,
      organizationId: input.organizationId,
      repairReason: "invalid_access_token",
      userId: input.userId,
    });
  }
};

const listPersonalGmailMailboxes = async (input: {
  activeOrganization: ActiveOrganization;
  headers: Headers;
  userId: string;
}) => {
  if (input.activeOrganization.personalOwnerUserId !== input.userId) {
    return {
      mailboxes: [] satisfies GmailMailbox[],
      repairTargets: [] satisfies GoogleScopeRepairTarget[],
    };
  }

  const googleAccounts = await listLinkedGoogleAccounts(input.headers);
  const gmailMailboxResults = await Promise.all(
    googleAccounts.map((account) =>
      createGmailMailboxFromAccount({
        account,
        headers: input.headers,
        organizationId: input.activeOrganization.id,
        userId: input.userId,
      }),
    ),
  );

  return {
    mailboxes: gmailMailboxResults
      .map((result) => result.mailbox)
      .sort((left, right) => left.emailAddress.localeCompare(right.emailAddress)),
    repairTargets: gmailMailboxResults
      .flatMap((result) => (result.repairTarget ? [result.repairTarget] : []))
      .sort((left, right) => left.emailAddress.localeCompare(right.emailAddress)),
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

export const syncPersonalGmailMailboxes = async (input: {
  activeOrganizationId: string;
  headers: Headers;
  userId: string;
}) => {
  const activeOrganization = await getActiveOrganization(input.activeOrganizationId);

  if (activeOrganization.personalOwnerUserId !== input.userId) {
    throwPersonalOrganizationRequired(activeOrganization.id);
  }

  const gmailState = await listPersonalGmailMailboxes({
    activeOrganization,
    headers: input.headers,
    userId: input.userId,
  });

  return {
    googleScopeRepairTarget: resolveGoogleScopeRepairTarget({
      repairTargets: gmailState.repairTargets,
    }),
    mailboxes: gmailState.mailboxes,
    organization: activeOrganization,
  };
};

export const getGoogleScopeRepairTarget = async (input: {
  activeOrganizationId: string;
  headers: Headers;
  preferredMailboxId?: string | null;
  targetAccountId?: string | null;
  userId: string;
}) => {
  const activeOrganization = await getActiveOrganization(input.activeOrganizationId);
  const gmailState = await listPersonalGmailMailboxes({
    activeOrganization,
    headers: input.headers,
    userId: input.userId,
  });

  return resolveGoogleScopeRepairTarget({
    preferredMailboxId: input.preferredMailboxId,
    repairTargets: gmailState.repairTargets,
    targetAccountId: input.targetAccountId,
  });
};

const getMemberDefaultMailboxId = async (organizationId: string, userId: string) => {
  const [row] = await db
    .select({ defaultMailboxId: member.defaultMailboxId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);

  return row?.defaultMailboxId ?? null;
};

export const listMailboxesForOrganization = async (input: {
  activeOrganizationId: string;
  headers: Headers;
  userId: string;
}) => {
  const activeOrganization = await getActiveOrganization(input.activeOrganizationId);
  const [managedMailboxes, defaultMailboxId, gmailState] = await Promise.all([
    listManagedMailboxesForOrganization(activeOrganization.id),
    getMemberDefaultMailboxId(activeOrganization.id, input.userId),
    listPersonalGmailMailboxes({
      activeOrganization,
      headers: input.headers,
      userId: input.userId,
    }),
  ]);
  const mailboxes = [...gmailState.mailboxes, ...managedMailboxes];
  const resolvedDefaultMailboxId = mailboxes.some(
    (mailboxRecord) => mailboxRecord.id === defaultMailboxId,
  )
    ? defaultMailboxId
    : null;

  return {
    defaultMailboxId: resolvedDefaultMailboxId,
    mailboxes,
    googleScopeRepairTarget: resolveGoogleScopeRepairTarget({
      repairTargets: gmailState.repairTargets,
    }),
    organization: activeOrganization,
  };
};

const getAuthorizedManagedMailbox = async (input: {
  activeOrganizationId: string;
  mailboxId: string;
}) => {
  const [selectedMailbox] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      emailAddress: mailbox.emailAddress,
      displayName: mailbox.displayName,
    })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);

  if (!selectedMailbox || selectedMailbox.organizationId !== input.activeOrganizationId) {
    throw new ORPCError("NOT_FOUND", {
      message: "Mailbox not found in the active organization.",
    });
  }

  return selectedMailbox;
};

export const getAuthorizedGmailMailbox = async (input: {
  activeOrganizationId: string;
  headers: Headers;
  mailboxId: string;
  userId: string;
}): Promise<{
  accessToken: string;
  mailbox: GmailMailbox;
}> => {
  const activeOrganization = await getActiveOrganization(input.activeOrganizationId);

  if (activeOrganization.personalOwnerUserId !== input.userId) {
    throwPersonalOrganizationRequired(activeOrganization.id);
  }

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
    id: createGmailMailboxId(providerAccountId),
    organizationId: activeOrganization.id,
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
  activeOrganizationId: string;
  headers: Headers;
  mailboxId: string | null;
  userId: string;
}) => {
  if (input.mailboxId) {
    const providerAccountId = parseGmailProviderAccountId(input.mailboxId);

    if (providerAccountId) {
      const activeOrganization = await getActiveOrganization(input.activeOrganizationId);

      if (activeOrganization.personalOwnerUserId !== input.userId) {
        throwPersonalOrganizationRequired(activeOrganization.id);
      }

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
        activeOrganizationId: input.activeOrganizationId,
        mailboxId: input.mailboxId,
      });
    }
  }

  await db
    .update(member)
    .set({ defaultMailboxId: input.mailboxId })
    .where(
      and(eq(member.organizationId, input.activeOrganizationId), eq(member.userId, input.userId)),
    );

  return { defaultMailboxId: input.mailboxId };
};

export const disconnectPersonalGmailMailbox = async (input: {
  activeOrganizationId: string;
  headers: Headers;
  mailboxId: string;
  userId: string;
}) => {
  const activeOrganization = await getActiveOrganization(input.activeOrganizationId);

  if (activeOrganization.personalOwnerUserId !== input.userId) {
    throwPersonalOrganizationRequired(activeOrganization.id);
  }

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
    .update(member)
    .set({ defaultMailboxId: null })
    .where(
      and(
        eq(member.organizationId, input.activeOrganizationId),
        eq(member.defaultMailboxId, input.mailboxId),
      ),
    );

  return {
    disconnected: true,
    mailboxId: input.mailboxId,
  };
};
