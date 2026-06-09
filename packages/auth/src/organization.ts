import {
  db,
  invitation,
  mailbox,
  managedMailMessage,
  member,
  organization,
  user,
} from "@quieter/database";
import { APIError } from "better-auth/api";
import { and, eq, notInArray } from "drizzle-orm";

type AuthUser = typeof user.$inferSelect;

type UserIdentity = Pick<AuthUser, "email" | "id" | "name">;

type EnsureUserOrganizationStateResult = {
  organizationIds: string[];
};

const getUserOrganizationIds = async (userId: string) => {
  const organizationRows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));

  return organizationRows.map((row) => row.organizationId);
};

export const ensureUserOrganizationState = async (
  currentUser: UserIdentity,
): Promise<EnsureUserOrganizationStateResult> => {
  const organizationIds = await getUserOrganizationIds(currentUser.id);

  return {
    organizationIds,
  };
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
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (!region) {
    throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required to delete managed mail.");
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
  await db
    .update(mailbox)
    .set({ organizationId: null, updatedAt: new Date() })
    .where(and(eq(mailbox.organizationId, organizationId), eq(mailbox.provider, "gmail")));

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
};
