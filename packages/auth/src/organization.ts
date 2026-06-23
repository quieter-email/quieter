import {
  db,
  invitation,
  mailbox,
  managedMailMessage,
  member,
  organization,
  user,
} from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { APIError } from "better-auth/api";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

type AuthUser = typeof user.$inferSelect;

type UserIdentity = Pick<AuthUser, "email" | "id" | "name">;

type EnsureUserOrganizationStateResult = {
  organizationIds: string[];
};

const getUserOrganizationIds = async (client: Pick<typeof db, "select">, userId: string) => {
  const organizationRows = await client
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));

  return organizationRows.map((row) => row.organizationId);
};

export const createDefaultOrganizationName = (currentUser: UserIdentity) => {
  const normalizedName =
    currentUser.name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "team";
  const shortId = createHash("sha256").update(currentUser.id).digest("hex").slice(0, 6);

  return `${normalizedName}-${shortId}`;
};

export const ensureUserOrganizationState = async (
  currentUser: UserIdentity,
): Promise<EnsureUserOrganizationStateResult> => {
  return await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`default-organization:${currentUser.id}`}, 0))`,
    );

    let organizationIds = await getUserOrganizationIds(transaction, currentUser.id);
    if (organizationIds.length === 0) {
      const now = new Date();
      const organizationId = randomUUID();
      const name = createDefaultOrganizationName(currentUser);

      await transaction.insert(organization).values({
        billingOwnerUserId: currentUser.id,
        createdAt: now,
        id: organizationId,
        name,
        slug: name,
        updatedAt: now,
      });
      await transaction.insert(member).values({
        createdAt: now,
        id: randomUUID(),
        organizationId,
        role: "owner",
        userId: currentUser.id,
      });
      organizationIds = [organizationId];
    }

    await transaction
      .update(mailbox)
      .set({ organizationId: organizationIds[0], updatedAt: new Date() })
      .where(
        and(
          eq(mailbox.ownerUserId, currentUser.id),
          eq(mailbox.provider, "gmail"),
          sql`${mailbox.organizationId} is null`,
        ),
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
  await db.delete(invitation).where(eq(invitation.inviterId, userId));
  await db.delete(member).where(eq(member.userId, userId));
};

const deleteUntrackedManagedMailObject = async (input: { bucket: string; key: string }) => {
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;
  if (!region) {
    throw new Error("Managed mail cleanup is temporarily unavailable.");
  }

  const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  const s3Client = new S3Client({ region });

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }),
  );
};

export const cleanupMailboxesForDeletedOrganization = async (organizationId: string) => {
  const managedMessages = await db
    .select({
      id: managedMailMessage.id,
      s3Bucket: managedMailMessage.s3Bucket,
      s3Key: managedMailMessage.s3Key,
    })
    .from(managedMailMessage)
    .innerJoin(mailbox, eq(mailbox.id, managedMailMessage.mailboxId))
    .where(and(eq(mailbox.organizationId, organizationId), eq(mailbox.provider, "managed")));
  const managedMessageIds = managedMessages.map((message) => message.id);
  const objects = new Map<string, { bucket: string; key: string }>();

  for (const message of managedMessages) {
    if (message.s3Bucket && message.s3Key) {
      objects.set(`${message.s3Bucket}\0${message.s3Key}`, {
        bucket: message.s3Bucket,
        key: message.s3Key,
      });
    }
  }

  await db
    .delete(mailbox)
    .where(and(eq(mailbox.organizationId, organizationId), eq(mailbox.provider, "managed")));
  const gmailMailboxes = await db
    .select({
      id: mailbox.id,
      ownerUserId: mailbox.ownerUserId,
    })
    .from(mailbox)
    .where(and(eq(mailbox.organizationId, organizationId), eq(mailbox.provider, "gmail")));

  for (const gmailMailbox of gmailMailboxes) {
    if (!gmailMailbox.ownerUserId) continue;
    const [targetMembership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(
        and(
          eq(member.userId, gmailMailbox.ownerUserId),
          sql`${member.organizationId} <> ${organizationId}`,
        ),
      )
      .limit(1);

    if (!targetMembership) {
      throw new Error("Every mailbox owner must retain another team.");
    }

    await db
      .update(mailbox)
      .set({ organizationId: targetMembership.organizationId, updatedAt: new Date() })
      .where(eq(mailbox.id, gmailMailbox.id));
  }

  for (const object of objects.values()) {
    const [otherReference] = await db
      .select({ id: managedMailMessage.id })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.s3Bucket, object.bucket),
          eq(managedMailMessage.s3Key, object.key),
          notInArray(managedMailMessage.id, managedMessageIds),
        ),
      )
      .limit(1);

    if (!otherReference) {
      await deleteUntrackedManagedMailObject(object);
    }
  }
};

export const assertCanLeaveOrganization = async (
  currentUser: UserIdentity,
  organizationId: string,
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
  organizationId: string,
) => {
  await assertCanLeaveOrganization(currentUser, organizationId);

  const organizationMembers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  for (const organizationMember of organizationMembers) {
    const organizationIds = await getUserOrganizationIds(db, organizationMember.userId);
    if (organizationIds.length <= 1) {
      throw new APIError("BAD_REQUEST", {
        message: "Every member must belong to another team before this team can be deleted.",
      });
    }
  }
};
