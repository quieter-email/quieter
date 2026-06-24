import type { S3Client } from "@aws-sdk/client-s3";
import { ORPCError } from "@orpc/server";
import { db, managedMailMessage } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { and, eq, or, type SQL } from "drizzle-orm";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";

let s3Client: S3Client | null = null;
let r2Client: S3Client | null = null;

const getS3Client = async () => {
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;
  if (!region) throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required.");
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3Client ??= new S3Client({ region });
  return s3Client;
};

type RawMailObjectProvider = "r2" | "s3";

type RawMailObjectReference = {
  bucket: string;
  key: string;
  provider: RawMailObjectProvider;
};

const getR2Client = async () => {
  const endpoint =
    serverEnv.R2_ENDPOINT ||
    (serverEnv.R2_ACCOUNT_ID
      ? `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : null);
  if (
    !endpoint ||
    !serverEnv.R2_ACCESS_KEY_ID ||
    !serverEnv.R2_SECRET_ACCESS_KEY ||
    !serverEnv.R2_BUCKET
  ) {
    throw new Error("R2 raw mail storage is not configured.");
  }

  const { S3Client } = await import("@aws-sdk/client-s3");
  r2Client ??= new S3Client({
    credentials: {
      accessKeyId: serverEnv.R2_ACCESS_KEY_ID,
      secretAccessKey: serverEnv.R2_SECRET_ACCESS_KEY,
    },
    endpoint,
    region: "auto",
  });
  return r2Client;
};

const getRawMailObjectReference = (record: {
  rawObjectBucket: string | null;
  rawObjectKey: string | null;
  rawObjectProvider: RawMailObjectProvider | null;
  s3Bucket: string | null;
  s3Key: string | null;
}): RawMailObjectReference | null => {
  if (record.rawObjectProvider && record.rawObjectBucket && record.rawObjectKey) {
    return {
      bucket: record.rawObjectBucket,
      key: record.rawObjectKey,
      provider: record.rawObjectProvider,
    };
  }
  if (record.s3Bucket && record.s3Key) {
    return {
      bucket: record.s3Bucket,
      key: record.s3Key,
      provider: "s3",
    };
  }
  return null;
};

const deleteRawMailObject = async (object: RawMailObjectReference) => {
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = object.provider === "r2" ? await getR2Client() : await getS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }));
};

const deleteManagedMailRecords = async (
  records: Array<{
    id: string;
    rawObjectBucket: string | null;
    rawObjectKey: string | null;
    rawObjectProvider: RawMailObjectProvider | null;
    s3Bucket: string | null;
    s3Key: string | null;
  }>,
  condition: SQL,
) => {
  const objects = new Map<string, RawMailObjectReference>();
  for (const record of records) {
    const object = getRawMailObjectReference(record);
    if (object) objects.set(`${object.provider}\0${object.bucket}\0${object.key}`, object);
  }

  await db.delete(managedMailMessage).where(condition);
  for (const object of objects.values()) {
    const [otherReference] = await db
      .select({ id: managedMailMessage.id })
      .from(managedMailMessage)
      .where(
        object.provider === "s3"
          ? or(
              and(
                eq(managedMailMessage.rawObjectProvider, object.provider),
                eq(managedMailMessage.rawObjectBucket, object.bucket),
                eq(managedMailMessage.rawObjectKey, object.key),
              ),
              and(
                eq(managedMailMessage.s3Bucket, object.bucket),
                eq(managedMailMessage.s3Key, object.key),
              ),
            )
          : and(
              eq(managedMailMessage.rawObjectProvider, object.provider),
              eq(managedMailMessage.rawObjectBucket, object.bucket),
              eq(managedMailMessage.rawObjectKey, object.key),
            ),
      )
      .limit(1);
    if (otherReference) continue;

    try {
      await deleteRawMailObject(object);
    } catch (error) {
      console.error("Failed to delete managed mail raw object.", {
        bucket: object.bucket,
        error,
        key: object.key,
        provider: object.provider,
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
      rawObjectBucket: managedMailMessage.rawObjectBucket,
      rawObjectKey: managedMailMessage.rawObjectKey,
      rawObjectProvider: managedMailMessage.rawObjectProvider,
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
      rawObjectBucket: managedMailMessage.rawObjectBucket,
      rawObjectKey: managedMailMessage.rawObjectKey,
      rawObjectProvider: managedMailMessage.rawObjectProvider,
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
