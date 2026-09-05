import { createHash } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  invitation,
  mailbox,
  managedMailMessage,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { APIError } from "better-auth/api";
import { and, eq, notInArray, or, sql } from "drizzle-orm";

type AuthUser = typeof user.$inferSelect;

type UserIdentity = Pick<AuthUser, "email" | "id" | "name">;

type EnsureUserOrganizationStateResult = {
  organizationIds: string[];
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
): Promise<EnsureUserOrganizationStateResult> => {
  const existingOrganizationIds = await getUserOrganizationIds(
    db,
    currentUser.id
  );

  if (existingOrganizationIds.length > 0) {
    await db
      .update(mailbox)
      .set({
        organizationId: existingOrganizationIds[0],
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailbox.ownerUserId, currentUser.id),
          eq(mailbox.provider, "gmail"),
          sql`${mailbox.organizationId} is null`
        )
      );

    return { organizationIds: existingOrganizationIds };
  }

  return await db.transaction(async (transaction) => {
    let organizationIds = await getUserOrganizationIds(
      transaction,
      currentUser.id
    );
    if (organizationIds.length === 0) {
      const now = new Date();
      const name = createDefaultOrganizationName(currentUser);
      const stableId = createHash("sha256")
        .update(currentUser.id)
        .digest("hex");
      const organizationId = `default-organization-${stableId}`;

      await transaction
        .insert(organization)
        .values({
          billingOwnerUserId: currentUser.id,
          createdAt: now,
          id: organizationId,
          name,
          slug: name,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const [defaultOrganization] = await transaction
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, name))
        .limit(1);

      if (defaultOrganization === null || defaultOrganization === undefined) {
        throw new Error("Default team provisioning failed.");
      }

      await transaction
        .insert(member)
        .values({
          createdAt: now,
          id: `default-member-${stableId}`,
          organizationId: defaultOrganization.id,
          role: "owner",
          userId: currentUser.id,
        })
        .onConflictDoNothing();
      organizationIds = [defaultOrganization.id];
    }

    await transaction
      .update(mailbox)
      .set({ organizationId: organizationIds[0], updatedAt: new Date() })
      .where(
        and(
          eq(mailbox.ownerUserId, currentUser.id),
          eq(mailbox.provider, "gmail"),
          sql`${mailbox.organizationId} is null`
        )
      );

    return { organizationIds };
  });
};

export const getUserById = async (userId: string) => {
  const [currentUser] = await db
    .select({
      email: user.email,
      id: user.id,
      name: user.name,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return currentUser ?? null;
};

export const cleanupOrganizationsForDeletedUser = async (userId: string) => {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    const [ownedMailbox] = await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.managedOwnerUserId, userId),
          eq(mailbox.provider, "managed")
        )
      )
      .limit(1);
    if (ownedMailbox !== undefined) {
      throw new APIError("FORBIDDEN", {
        message:
          "Ask a team admin to transfer your private mailboxes before deleting your account.",
      });
    }
    await tx.delete(invitation).where(eq(invitation.inviterId, userId));
    await tx.delete(member).where(eq(member.userId, userId));
  });
};

type RawMailObjectProvider = "r2" | "s3";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

const createManagedMailObjectClient = async (input: {
  provider: RawMailObjectProvider;
}) => {
  const region = serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION;

  const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  let endpoint = serverEnv.R2_ENDPOINT;
  if (!hasText(endpoint) && hasText(serverEnv.R2_ACCOUNT_ID)) {
    endpoint = `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  const accessKeyId = serverEnv.R2_ACCESS_KEY_ID;
  const secretAccessKey = serverEnv.R2_SECRET_ACCESS_KEY;

  if (input.provider === "r2") {
    if (
      !(hasText(endpoint) && hasText(accessKeyId) && hasText(secretAccessKey))
    ) {
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

  if (!hasText(region)) {
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
  organizationId: string
) => {
  const managedMessages = await db
    .select({
      id: managedMailMessage.id,
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
  const managedMessageIds = managedMessages.map((message) => message.id);
  const objects = new Map<
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
      objects.set(
        `${message.rawObjectProvider}\0${message.rawObjectBucket}\0${message.rawObjectKey}`,
        {
          bucket: message.rawObjectBucket,
          key: message.rawObjectKey,
          provider: message.rawObjectProvider,
        }
      );
    } else if (
      message.s3Bucket !== null &&
      message.s3Bucket !== undefined &&
      message.s3Bucket !== "" &&
      message.s3Key !== null &&
      message.s3Key !== undefined &&
      message.s3Key !== ""
    ) {
      objects.set(`s3\0${message.s3Bucket}\0${message.s3Key}`, {
        bucket: message.s3Bucket,
        key: message.s3Key,
        provider: "s3",
      });
    }
  }

  await db
    .delete(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, organizationId),
        eq(mailbox.provider, "managed")
      )
    );
  const gmailMailboxes = await db
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
    );

  await Promise.all(
    gmailMailboxes.map(async (gmailMailbox) => {
      if (
        gmailMailbox.ownerUserId === null ||
        gmailMailbox.ownerUserId === undefined ||
        gmailMailbox.ownerUserId === ""
      ) {
        return;
      }
      const [targetMembership] = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(
          and(
            eq(member.userId, gmailMailbox.ownerUserId),
            sql`${member.organizationId} <> ${organizationId}`
          )
        )
        .limit(1);

      if (targetMembership === null || targetMembership === undefined) {
        throw new Error("Every mailbox owner must retain another team.");
      }

      await db
        .update(mailbox)
        .set({
          organizationId: targetMembership.organizationId,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, gmailMailbox.id));
    })
  );

  await Promise.all(
    [...objects.values()].map(async (object) => {
      const [otherReference] = await db
        .select({ id: managedMailMessage.id })
        .from(managedMailMessage)
        .where(
          object.provider === "s3"
            ? and(
                notInArray(managedMailMessage.id, managedMessageIds),
                or(
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
              )
            : and(
                eq(managedMailMessage.rawObjectProvider, object.provider),
                eq(managedMailMessage.rawObjectBucket, object.bucket),
                eq(managedMailMessage.rawObjectKey, object.key),
                notInArray(managedMailMessage.id, managedMessageIds)
              )
        )
        .limit(1);

      if (otherReference === null || otherReference === undefined) {
        await deleteUntrackedManagedMailObject(object);
      }
    })
  );
};

export const assertCanLeaveOrganization = async (
  currentUser: UserIdentity,
  organizationId: string
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
};

export const assertCanDeleteOrganization = async (
  currentUser: UserIdentity,
  organizationId: string
) => {
  await assertCanLeaveOrganization(currentUser, organizationId);

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
