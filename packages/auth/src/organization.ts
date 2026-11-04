import { createHash } from "node:crypto";

import {
  requestAccountDeletion,
  requestOrganizationDeletion,
} from "@quieter/billing/lifecycle";
import { db } from "@quieter/database/client";
import {
  billingAccountSettings,
  invitation,
  mailObjectCleanup,
  mailbox,
  managedMailMessage,
  member,
  organization,
  organizationApiMailMessage,
  organizationMailSendIdempotency,
  user,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { APIError } from "better-auth/api";
import { and, eq, isNull, ne, or } from "drizzle-orm";

type AuthUser = typeof user.$inferSelect;

type UserIdentity = Pick<AuthUser, "email" | "id" | "name">;

type EnsureUserOrganizationStateResult = {
  organizationIds: string[];
};

export const assertOrganizationLifecycleOpen = async (input: {
  organizationId?: string;
  userId?: string;
}) => {
  if (input.userId !== undefined) {
    const [settings] = await db
      .select({ closing: billingAccountSettings.deletionRequestedAt })
      .from(billingAccountSettings)
      .where(eq(billingAccountSettings.userId, input.userId));
    if (settings?.closing !== null && settings?.closing !== undefined) {
      throw new APIError("BAD_REQUEST", {
        message:
          "Your account is closing. Finish deleting it before creating or joining a team.",
      });
    }
  }
  if (input.organizationId !== undefined) {
    const [team] = await db
      .select({ closing: organization.billingDeletionRequestedAt })
      .from(organization)
      .where(eq(organization.id, input.organizationId));
    if (team?.closing !== null && team?.closing !== undefined) {
      throw new APIError("BAD_REQUEST", {
        message: "This team is closing and cannot accept new members.",
      });
    }
  }
};

const getUserOrganizationIds = async (
  client: Pick<typeof db, "select">,
  userId: string
) => {
  const organizationRows = await client
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));

  return organizationRows.map((row) => row.organizationId);
};

export const createDefaultOrganizationName = (currentUser: UserIdentity) => {
  const slug = currentUser.name
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 40);
  const normalizedName = slug.length > 0 ? slug : "team";
  const shortId = createHash("sha256")
    .update(currentUser.id)
    .digest("hex")
    .slice(0, 6);

  return `${normalizedName}-${shortId}`;
};

export const ensureUserOrganizationState = async (
  currentUser: UserIdentity
): Promise<EnsureUserOrganizationStateResult> =>
  await db.transaction(async (transaction) => {
    const [provisioningState] = await transaction
      .select({
        defaultOrganizationProvisioned: user.defaultOrganizationProvisioned,
        email: user.email,
        id: user.id,
        name: user.name,
      })
      .from(user)
      .where(eq(user.id, currentUser.id));
    if (provisioningState === undefined) {
      throw new Error("Team provisioning requires an existing account.");
    }
    let persistedUser = provisioningState;
    if (!persistedUser.defaultOrganizationProvisioned) {
      const [lockedUser] = await transaction
        .select()
        .from(user)
        .where(eq(user.id, currentUser.id))
        .for("update");
      if (lockedUser === undefined) {
        throw new Error("Team provisioning requires an existing account.");
      }
      persistedUser = lockedUser;
    }

    let organizationIds = await getUserOrganizationIds(
      transaction,
      persistedUser.id
    );
    if (!persistedUser.defaultOrganizationProvisioned) {
      if (organizationIds.length === 0) {
        const now = new Date();
        const name = createDefaultOrganizationName(persistedUser);
        const organizationId = crypto.randomUUID();
        const values = {
          createdAt: now,
          id: organizationId,
          name,
          slug: name,
          updatedAt: now,
        };
        const [createdOrganization] = await transaction
          .insert(organization)
          .values(values)
          .onConflictDoNothing({ target: organization.slug })
          .returning({ id: organization.id });
        if (createdOrganization === undefined) {
          await transaction.insert(organization).values({
            ...values,
            slug: `${name}-${crypto.randomUUID()}`,
          });
        }
        await transaction.insert(member).values({
          createdAt: now,
          id: crypto.randomUUID(),
          organizationId,
          role: "owner",
          userId: persistedUser.id,
        });
        await transaction
          .update(organization)
          .set({ billingOwnerUserId: persistedUser.id })
          .where(eq(organization.id, organizationId));
        organizationIds = [organizationId];
      }
      await transaction
        .update(user)
        .set({ defaultOrganizationProvisioned: true })
        .where(eq(user.id, persistedUser.id));
    }

    if (organizationIds[0] !== undefined) {
      await transaction
        .update(mailbox)
        .set({ organizationId: organizationIds[0], updatedAt: new Date() })
        .where(
          and(
            eq(mailbox.ownerUserId, persistedUser.id),
            eq(mailbox.provider, "gmail"),
            isNull(mailbox.organizationId)
          )
        );
    }
    return { organizationIds };
  });

export const assertCanDeleteAccount = async (userId: string) => {
  const [ownedMailbox] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .leftJoin(organization, eq(organization.id, mailbox.organizationId))
    .where(
      and(
        eq(mailbox.managedOwnerUserId, userId),
        eq(mailbox.provider, "managed"),
        or(
          isNull(organization.billingOwnerUserId),
          ne(organization.billingOwnerUserId, userId)
        )
      )
    )
    .limit(1);
  if (ownedMailbox !== undefined) {
    throw new APIError("FORBIDDEN", {
      message:
        "Ask a team admin to transfer your private mailboxes before deleting your account.",
    });
  }
  const failure = await requestAccountDeletion(userId);
  if (failure !== null) {
    throw new APIError("BAD_REQUEST", { message: failure });
  }
};

export const cleanupOrganizationsForDeletedUser = async (userId: string) => {
  await assertCanDeleteAccount(userId);
  await db.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    await tx.delete(invitation).where(eq(invitation.inviterId, userId));
    await tx.delete(member).where(eq(member.userId, userId));
  });
};

export const assertCanChangeFundingMembership = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const [team] = await db
    .select({ payerId: organization.billingOwnerUserId })
    .from(organization)
    .where(eq(organization.id, input.organizationId));
  if (team?.payerId === input.userId) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Another team owner must accept taking over billing before the current payer can leave, be removed, or lose the owner role.",
    });
  }
};

type RawMailObjectProvider = "r2" | "s3";

const createManagedMailObjectClient = async (input: {
  provider: RawMailObjectProvider;
}) => {
  const region = serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION;

  const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  let endpoint = serverEnv.R2_ENDPOINT;
  if (!endpoint && serverEnv.R2_ACCOUNT_ID) {
    endpoint = `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  const accessKeyId = serverEnv.R2_ACCESS_KEY_ID;
  const secretAccessKey = serverEnv.R2_SECRET_ACCESS_KEY;

  if (input.provider === "r2") {
    if (!(!!endpoint && !!accessKeyId && !!secretAccessKey)) {
      throw new Error("Managed mail cleanup is temporarily unavailable.");
    }
    return {
      DeleteObjectCommand,
      client: new S3Client({
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        endpoint,
        region: "auto",
      }),
    };
  }

  if (!region) {
    throw new Error("Managed mail cleanup is temporarily unavailable.");
  }

  return {
    DeleteObjectCommand,
    client: new S3Client({ region }),
  };
};

const deleteUntrackedManagedMailObject = async (input: {
  bucket: string;
  key: string;
  provider: RawMailObjectProvider;
}) => {
  const { DeleteObjectCommand, client } =
    await createManagedMailObjectClient(input);

  await client.send(
    new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    })
  );
};

export const cleanupMailboxesForDeletedOrganization = async (
  organizationId: string,
  options: { deletingUserId?: string } = {}
) => {
  const failure = await requestOrganizationDeletion(organizationId);
  if (failure !== null) {
    throw new APIError("BAD_REQUEST", { message: failure });
  }
  const objects = await db.transaction(async (transaction) => {
    const [lockedOrganization] = await transaction
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for("update");
    if (lockedOrganization === undefined) {
      return [];
    }
    if (options.deletingUserId !== undefined) {
      const [otherMember] = await transaction
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            ne(member.userId, options.deletingUserId)
          )
        )
        .limit(1);
      if (otherMember !== undefined) {
        throw new APIError("BAD_REQUEST", {
          message:
            "Transfer billing for shared teams to another owner before deleting your account.",
        });
      }
    }

    const managedMessages = await transaction
      .select({
        rawObjectBucket: managedMailMessage.rawObjectBucket,
        rawObjectKey: managedMailMessage.rawObjectKey,
        rawObjectProvider: managedMailMessage.rawObjectProvider,
        s3Bucket: managedMailMessage.s3Bucket,
        s3Key: managedMailMessage.s3Key,
      })
      .from(managedMailMessage)
      .innerJoin(mailbox, eq(mailbox.id, managedMailMessage.mailboxId))
      .where(
        and(
          eq(mailbox.organizationId, organizationId),
          eq(mailbox.provider, "managed")
        )
      );
    const objectsByKey = new Map<
      string,
      { bucket: string; key: string; provider: RawMailObjectProvider }
    >();

    for (const message of managedMessages) {
      if (
        message.rawObjectProvider !== null &&
        message.rawObjectProvider !== undefined &&
        message.rawObjectBucket !== null &&
        message.rawObjectBucket !== undefined &&
        message.rawObjectBucket !== "" &&
        message.rawObjectKey !== null &&
        message.rawObjectKey !== undefined &&
        message.rawObjectKey !== ""
      ) {
        objectsByKey.set(
          `${message.rawObjectProvider}\0${message.rawObjectBucket}\0${message.rawObjectKey}`,
          {
            bucket: message.rawObjectBucket,
            key: message.rawObjectKey,
            provider: message.rawObjectProvider,
          }
        );
      }
      if (
        message.s3Bucket !== null &&
        message.s3Bucket !== undefined &&
        message.s3Bucket !== "" &&
        message.s3Key !== null &&
        message.s3Key !== undefined &&
        message.s3Key !== ""
      ) {
        objectsByKey.set(`s3\0${message.s3Bucket}\0${message.s3Key}`, {
          bucket: message.s3Bucket,
          key: message.s3Key,
          provider: "s3",
        });
      }
    }

    const gmailMailboxes = await transaction
      .select({
        id: mailbox.id,
        ownerUserId: mailbox.ownerUserId,
      })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.organizationId, organizationId),
          eq(mailbox.provider, "gmail")
        )
      )
      .for("update");

    for (const gmailMailbox of gmailMailboxes) {
      if (gmailMailbox.ownerUserId === options.deletingUserId) {
        await transaction
          .delete(mailbox)
          .where(eq(mailbox.id, gmailMailbox.id));
        continue;
      }
      if (
        gmailMailbox.ownerUserId === null ||
        gmailMailbox.ownerUserId === undefined ||
        gmailMailbox.ownerUserId === ""
      ) {
        continue;
      }
      const [targetMembership] = await transaction
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(
          and(
            eq(member.userId, gmailMailbox.ownerUserId),
            ne(member.organizationId, organizationId)
          )
        )
        .limit(1)
        .for("share");

      if (targetMembership === undefined) {
        throw new Error("Every mailbox owner must retain another team.");
      }

      await transaction
        .update(mailbox)
        .set({
          organizationId: targetMembership.organizationId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailbox.id, gmailMailbox.id),
            eq(mailbox.organizationId, organizationId)
          )
        );
    }

    if (objectsByKey.size > 0) {
      const now = new Date();
      await transaction
        .insert(mailObjectCleanup)
        .values(
          [...objectsByKey.values()].map((object) => ({
            ...object,
            createdAt: now,
            id: crypto.randomUUID(),
            notBefore: now,
          }))
        )
        .onConflictDoNothing({
          target: [
            mailObjectCleanup.provider,
            mailObjectCleanup.bucket,
            mailObjectCleanup.key,
          ],
        });
    }

    await transaction
      .delete(mailbox)
      .where(
        and(
          eq(mailbox.organizationId, organizationId),
          eq(mailbox.provider, "managed")
        )
      );

    if (options.deletingUserId !== undefined) {
      await transaction
        .delete(organization)
        .where(
          and(
            eq(organization.id, organizationId),
            eq(organization.billingOwnerUserId, options.deletingUserId)
          )
        );
    }

    return [...objectsByKey.values()];
  });

  await Promise.all(
    objects.map(async (object) => {
      try {
        const [otherReference] = await db
          .select({ id: managedMailMessage.id })
          .from(managedMailMessage)
          .where(
            object.provider === "s3"
              ? or(
                  and(
                    eq(managedMailMessage.rawObjectProvider, object.provider),
                    eq(managedMailMessage.rawObjectBucket, object.bucket),
                    eq(managedMailMessage.rawObjectKey, object.key)
                  ),
                  and(
                    eq(managedMailMessage.s3Bucket, object.bucket),
                    eq(managedMailMessage.s3Key, object.key)
                  )
                )
              : and(
                  eq(managedMailMessage.rawObjectProvider, object.provider),
                  eq(managedMailMessage.rawObjectBucket, object.bucket),
                  eq(managedMailMessage.rawObjectKey, object.key)
                )
          )
          .limit(1);

        if (otherReference !== undefined) {
          return;
        }
        const [apiReference] = await db
          .select({ id: organizationApiMailMessage.id })
          .from(organizationApiMailMessage)
          .where(
            and(
              eq(organizationApiMailMessage.rawObjectProvider, object.provider),
              eq(organizationApiMailMessage.rawObjectBucket, object.bucket),
              eq(organizationApiMailMessage.rawObjectKey, object.key)
            )
          )
          .limit(1);
        if (apiReference !== undefined) {
          return;
        }
        const [sendReference] = await db
          .select({ id: organizationMailSendIdempotency.id })
          .from(organizationMailSendIdempotency)
          .where(
            and(
              eq(
                organizationMailSendIdempotency.rawObjectProvider,
                object.provider
              ),
              eq(
                organizationMailSendIdempotency.rawObjectBucket,
                object.bucket
              ),
              eq(organizationMailSendIdempotency.rawObjectKey, object.key)
            )
          )
          .limit(1);
        if (sendReference !== undefined) {
          return;
        }
        await deleteUntrackedManagedMailObject(object);
        await db
          .delete(mailObjectCleanup)
          .where(
            and(
              eq(mailObjectCleanup.provider, object.provider),
              eq(mailObjectCleanup.bucket, object.bucket),
              eq(mailObjectCleanup.key, object.key)
            )
          );
      } catch (error) {
        reportError(error, { operation: "organization:mail-object-cleanup" });
      }
    })
  );
};

export const prepareAccountDeletion = async (userId: string) => {
  await assertCanDeleteAccount(userId);
  const fundedTeams = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.billingOwnerUserId, userId));
  for (const team of fundedTeams) {
    await cleanupMailboxesForDeletedOrganization(team.id, {
      deletingUserId: userId,
    });
  }
};

export const assertCanRemoveOrganizationMember = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const [ownedMailbox] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, "managed"),
        eq(mailbox.accessMode, "private"),
        eq(mailbox.managedOwnerUserId, input.userId)
      )
    )
    .limit(1);
  if (ownedMailbox !== undefined) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Transfer private inboxes or make them shared before removing their owner from the team.",
    });
  }
};

export const assertCanLeaveOrganization = async (
  currentUser: UserIdentity,
  organizationId: string,
  options: { deleting?: boolean } = {}
) => {
  const organizationState = await ensureUserOrganizationState(currentUser);

  if (!organizationState.organizationIds.includes(organizationId)) {
    throw new APIError("BAD_REQUEST", {
      message: "You are not a member of that organization.",
    });
  }

  if (organizationState.organizationIds.length <= 1) {
    throw new APIError("BAD_REQUEST", {
      message: "Create another team before leaving your only team.",
    });
  }
  if (options.deleting !== true) {
    await assertCanChangeFundingMembership({
      organizationId,
      userId: currentUser.id,
    });
    await assertCanRemoveOrganizationMember({
      organizationId,
      userId: currentUser.id,
    });
  }
};

export const assertCanDeleteOrganization = async (
  currentUser: UserIdentity,
  organizationId: string
) => {
  await assertCanLeaveOrganization(currentUser, organizationId, {
    deleting: true,
  });

  const organizationMembers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  await Promise.all(
    organizationMembers.map(async (organizationMember) => {
      const organizationIds = await getUserOrganizationIds(
        db,
        organizationMember.userId
      );
      if (organizationIds.length <= 1) {
        throw new APIError("BAD_REQUEST", {
          message:
            "Every member must belong to another team before this team can be deleted.",
        });
      }
    })
  );
};
