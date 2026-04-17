import { ORPCError } from "@orpc/server";
import { auth } from "@quietr/auth";
import { hasRequiredGoogleScopes } from "@quietr/auth/google-scopes";
import { db, mailbox, member, organization } from "@quietr/database";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getGmailProfile } from "./gmail-service";

export const MAILBOX_PROVIDER_GMAIL = "gmail" as const;

export type GoogleScopeRepairTarget = {
  displayName: string | null;
  emailAddress: string;
  isStillMissingScopes: true;
  mailboxId: string;
  providerAccountId: string;
};

const throwPersonalOrganizationRequired = (activeOrganizationId: string) => {
  throw new ORPCError("PERSONAL_ORGANIZATION_REQUIRED", {
    data: {
      activeOrganizationId,
    },
    message: "Connected Gmail mailboxes can only be managed in your personal organization.",
    status: 409,
  });
};

export const getActiveOrganization = async (organizationId: string) => {
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

const listOrganizationMailboxes = async (organizationId: string) => {
  return await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      emailAddress: mailbox.emailAddress,
      displayName: mailbox.displayName,
      providerAccountId: mailbox.providerAccountId,
      connectedUserId: mailbox.connectedUserId,
      createdAt: mailbox.createdAt,
      updatedAt: mailbox.updatedAt,
    })
    .from(mailbox)
    .where(eq(mailbox.organizationId, organizationId))
    .orderBy(asc(mailbox.emailAddress));
};

const resolveGoogleScopeRepairTarget = async (input: {
  headers: Headers;
  mailboxes: Awaited<ReturnType<typeof listOrganizationMailboxes>>;
  preferredMailboxId?: string | null;
  targetAccountId?: string | null;
  userId: string;
}): Promise<GoogleScopeRepairTarget | null> => {
  const linkedAccounts = await auth.api.listUserAccounts({
    headers: input.headers,
  });
  const missingScopeAccountIds = new Set(
    linkedAccounts
      .filter((account) => {
        return account.providerId === "google" && !hasRequiredGoogleScopes(account.scopes);
      })
      .map((account) => account.accountId),
  );
  const candidates = input.mailboxes
    .filter((mailboxRecord) => {
      return (
        mailboxRecord.provider === MAILBOX_PROVIDER_GMAIL &&
        mailboxRecord.connectedUserId === input.userId &&
        missingScopeAccountIds.has(mailboxRecord.providerAccountId)
      );
    })
    .map((mailboxRecord) => ({
      displayName: mailboxRecord.displayName,
      emailAddress: mailboxRecord.emailAddress,
      isStillMissingScopes: true as const,
      mailboxId: mailboxRecord.id,
      providerAccountId: mailboxRecord.providerAccountId,
    }))
    .sort((left, right) => left.emailAddress.localeCompare(right.emailAddress));

  if (candidates.length === 0) {
    return null;
  }

  if (input.targetAccountId) {
    const matchingTarget = candidates.find((candidate) => {
      return candidate.providerAccountId === input.targetAccountId;
    });

    if (matchingTarget) {
      return matchingTarget;
    }
  }

  if (input.preferredMailboxId) {
    const matchingMailbox = candidates.find((candidate) => {
      return candidate.mailboxId === input.preferredMailboxId;
    });

    if (matchingMailbox) {
      return matchingMailbox;
    }
  }

  return candidates[0] ?? null;
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

export const refreshAuthorizedGmailAccessToken = async (input: {
  headers: Headers;
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
      throw new ORPCError("UNAUTHORIZED", {
        message: "Google access could not be refreshed for this mailbox.",
      });
    }

    return response.accessToken;
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    throw new ORPCError("UNAUTHORIZED", {
      message:
        error instanceof Error && error.message
          ? error.message
          : "Google access could not be refreshed for this mailbox.",
    });
  }
};

const upsertMailboxRecord = async (input: {
  connectedUserId: string;
  displayName: string | null;
  emailAddress: string;
  organizationId: string;
  providerAccountId: string;
}) => {
  const now = new Date();

  await db
    .insert(mailbox)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      provider: MAILBOX_PROVIDER_GMAIL,
      emailAddress: input.emailAddress,
      displayName: input.displayName,
      providerAccountId: input.providerAccountId,
      connectedUserId: input.connectedUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [mailbox.provider, mailbox.providerAccountId],
      set: {
        organizationId: input.organizationId,
        emailAddress: input.emailAddress,
        displayName: input.displayName,
        connectedUserId: input.connectedUserId,
        updatedAt: now,
      },
    });
};

const deleteStalePersonalMailboxes = async (input: {
  organizationId: string;
  providerAccountIds: string[];
  userId: string;
}) => {
  const staleMailboxes = await db
    .select({
      id: mailbox.id,
      providerAccountId: mailbox.providerAccountId,
    })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.connectedUserId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL),
      ),
    );

  const staleMailboxIds = staleMailboxes
    .filter((linkedMailbox) => !input.providerAccountIds.includes(linkedMailbox.providerAccountId))
    .map((linkedMailbox) => linkedMailbox.id);

  if (staleMailboxIds.length === 0) {
    return;
  }

  await db.delete(mailbox).where(inArray(mailbox.id, staleMailboxIds));
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

  const linkedAccounts = await auth.api.listUserAccounts({
    headers: input.headers,
  });
  const googleAccounts = linkedAccounts.filter((account) => account.providerId === "google");
  const linkedGoogleAccountIds = googleAccounts.map((account) => account.accountId);

  await Promise.all(
    googleAccounts.map(async (account) => {
      try {
        const accessToken = await getGoogleAccessTokenForLinkedAccount(
          input.headers,
          input.userId,
          account.accountId,
        );

        if (!accessToken) {
          return null;
        }

        const profile = await getGmailProfile(accessToken);
        const emailAddress = profile.emailAddress.trim().toLowerCase();

        if (!emailAddress) {
          return null;
        }

        await upsertMailboxRecord({
          connectedUserId: input.userId,
          displayName: profile.emailAddress,
          emailAddress,
          organizationId: activeOrganization.id,
          providerAccountId: account.accountId,
        });

        return account.accountId;
      } catch (error) {
        console.warn(
          `[quietr mailbox sync] skipping Google account ${account.accountId} during mailbox sync: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        return null;
      }
    }),
  );

  await deleteStalePersonalMailboxes({
    organizationId: activeOrganization.id,
    providerAccountIds: linkedGoogleAccountIds,
    userId: input.userId,
  });

  return {
    mailboxes: await listOrganizationMailboxes(activeOrganization.id),
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
  const organizationMailboxes =
    activeOrganization.personalOwnerUserId === input.userId
      ? (await syncPersonalGmailMailboxes(input)).mailboxes
      : await listOrganizationMailboxes(activeOrganization.id);

  return await resolveGoogleScopeRepairTarget({
    headers: input.headers,
    mailboxes: organizationMailboxes,
    preferredMailboxId: input.preferredMailboxId,
    targetAccountId: input.targetAccountId,
    userId: input.userId,
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
  const [mailboxes, defaultMailboxId] = await Promise.all([
    listOrganizationMailboxes(activeOrganization.id),
    getMemberDefaultMailboxId(activeOrganization.id, input.userId),
  ]);

  return {
    defaultMailboxId,
    mailboxes,
    googleScopeRepairTarget: await resolveGoogleScopeRepairTarget({
      headers: input.headers,
      mailboxes,
      userId: input.userId,
    }),
    organization: activeOrganization,
  };
};

export const getAuthorizedMailbox = async (input: {
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
      providerAccountId: mailbox.providerAccountId,
      connectedUserId: mailbox.connectedUserId,
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
}) => {
  const selectedMailbox = await getAuthorizedMailbox({
    activeOrganizationId: input.activeOrganizationId,
    mailboxId: input.mailboxId,
  });

  if (selectedMailbox.provider !== MAILBOX_PROVIDER_GMAIL) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This mailbox provider is not supported yet.",
    });
  }

  const linkedAccounts = await auth.api.listUserAccounts({
    headers: input.headers,
  });
  const linkedGoogleAccount = linkedAccounts.find((account) => {
    return (
      account.providerId === "google" && account.accountId === selectedMailbox.providerAccountId
    );
  });

  if (linkedGoogleAccount && !hasRequiredGoogleScopes(linkedGoogleAccount.scopes)) {
    throw new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
      data: {
        emailAddress: selectedMailbox.emailAddress,
        mailboxId: selectedMailbox.id,
        providerAccountId: selectedMailbox.providerAccountId,
      },
      message: "Google permissions need to be repaired for this mailbox.",
      status: 409,
    });
  }

  const accessToken = await getGoogleAccessTokenForLinkedAccount(
    input.headers,
    selectedMailbox.connectedUserId,
    selectedMailbox.providerAccountId,
  );

  if (!accessToken) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Google account is not linked or Gmail access has not been granted.",
    });
  }

  return {
    accessToken,
    mailbox: selectedMailbox,
  };
};

export const setDefaultMailbox = async (input: {
  activeOrganizationId: string;
  mailboxId: string | null;
  userId: string;
}) => {
  if (input.mailboxId) {
    await getAuthorizedMailbox({
      activeOrganizationId: input.activeOrganizationId,
      mailboxId: input.mailboxId,
    });
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

  const selectedMailbox = await getAuthorizedMailbox({
    activeOrganizationId: input.activeOrganizationId,
    mailboxId: input.mailboxId,
  });

  if (selectedMailbox.provider !== MAILBOX_PROVIDER_GMAIL) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This mailbox provider is not supported yet.",
    });
  }

  await auth.api.unlinkAccount({
    body: {
      providerId: "google",
      accountId: selectedMailbox.providerAccountId,
    },
    headers: input.headers,
  });

  await db.delete(mailbox).where(eq(mailbox.id, selectedMailbox.id));

  return {
    disconnected: true,
    mailboxId: selectedMailbox.id,
  };
};
