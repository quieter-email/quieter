import type { S3Client } from "@aws-sdk/client-s3";
import { ORPCError } from "@orpc/server";
import { db, managedMailMessage } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { and, eq, type SQL } from "drizzle-orm";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";

let s3Client: S3Client | null = null;

const getS3Client = async () => {
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;
  if (!region) throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required.");
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3Client ??= new S3Client({ region });
  return s3Client;
};

const deleteManagedMailRecords = async (
  records: Array<{ id: string; s3Bucket: string | null; s3Key: string | null }>,
  condition: SQL,
) => {
  const objects = new Map<string, { bucket: string; key: string }>();
  for (const record of records) {
    if (record.s3Bucket && record.s3Key) {
      objects.set(`${record.s3Bucket}\0${record.s3Key}`, {
        bucket: record.s3Bucket,
        key: record.s3Key,
      });
    }
  }

  await db.delete(managedMailMessage).where(condition);
  for (const object of objects.values()) {
    const [otherReference] = await db
      .select({ id: managedMailMessage.id })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.s3Bucket, object.bucket),
          eq(managedMailMessage.s3Key, object.key),
        ),
      )
      .limit(1);
    if (otherReference) continue;

    try {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await getS3Client();
      await client.send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }));
    } catch (error) {
      console.error("Failed to delete managed mail object from S3.", {
        bucket: object.bucket,
        error,
        key: object.key,
      });
    }
  }
};

export const deleteManagedMessage = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const condition = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    eq(managedMailMessage.id, input.messageId),
  )!;
  const records = await db
    .select({
      id: managedMailMessage.id,
      s3Bucket: managedMailMessage.s3Bucket,
      s3Key: managedMailMessage.s3Key,
    })
    .from(managedMailMessage)
    .where(condition);
  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }

  await deleteManagedMailRecords(records, condition);
  return { id: input.messageId, isUnread: false, labelIds: [] };
};

export const deleteManagedThread = async (input: {
  mailboxId: string;
  threadId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const condition = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    eq(managedMailMessage.threadId, input.threadId),
  )!;
  const records = await db
    .select({
      id: managedMailMessage.id,
      s3Bucket: managedMailMessage.s3Bucket,
      s3Key: managedMailMessage.s3Key,
    })
    .from(managedMailMessage)
    .where(condition);
  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }

  await deleteManagedMailRecords(records, condition);
  return {
    messages: records.map((record) => ({
      id: record.id,
      isUnread: false,
      labelIds: [],
    })),
    threadId: input.threadId,
  };
};
