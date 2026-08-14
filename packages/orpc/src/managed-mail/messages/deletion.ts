import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailbox, managedMailMessage } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { deleteRawMailObject, getRawMailObjectReference } from "./raw-object";
import type {
  RawMailObjectProvider,
  RawMailObjectReference,
} from "./raw-object";

const requireDeleteCondition = (condition: SQL | undefined) => {
  if (condition === undefined) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Delete condition is invalid.",
    });
  }
  return condition;
};

const getOtherReferenceCondition = (object: RawMailObjectReference) => {
  if (object.provider === "s3") {
    return or(
      and(
        eq(managedMailMessage.rawObjectProvider, object.provider),
        eq(managedMailMessage.rawObjectBucket, object.bucket),
        eq(managedMailMessage.rawObjectKey, object.key)
      ),
      and(
        eq(managedMailMessage.s3Bucket, object.bucket),
        eq(managedMailMessage.s3Key, object.key)
      )
    );
  }
  return and(
    eq(managedMailMessage.rawObjectProvider, object.provider),
    eq(managedMailMessage.rawObjectBucket, object.bucket),
    eq(managedMailMessage.rawObjectKey, object.key)
  );
};

const deleteOrphanedRawObjects = async (
  objects: Iterable<RawMailObjectReference>
) => {
  await Promise.all(
    [...objects].map(async (object) => {
      const [otherReference] = await db
        .select({ id: managedMailMessage.id })
        .from(managedMailMessage)
        .where(getOtherReferenceCondition(object))
        .limit(1);
      if (otherReference !== undefined) {
        return;
      }

      try {
        await deleteRawMailObject(object);
      } catch (error) {
        reportError(error, { operation: "managed-mail:delete-raw-object" });
      }
    })
  );
};

const deleteManagedMailRecords = async (
  mailboxId: string,
  records: {
    id: string;
    rawObjectBucket: string | null;
    rawObjectKey: string | null;
    rawObjectProvider: RawMailObjectProvider | null;
    s3Bucket: string | null;
    s3Key: string | null;
  }[],
  condition: SQL
) => {
  const objects = new Map<string, RawMailObjectReference>();
  for (const record of records) {
    const object = getRawMailObjectReference(record);
    if (object !== null) {
      objects.set(
        `${object.provider}\0${object.bucket}\0${object.key}`,
        object
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(managedMailMessage).where(condition);
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(mailbox.id, mailboxId));
  });
  await deleteOrphanedRawObjects(objects.values());
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
  const condition = requireDeleteCondition(
    and(
      eq(managedMailMessage.mailboxId, input.mailboxId),
      eq(managedMailMessage.id, input.messageId)
    )
  );
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

  await deleteManagedMailRecords(input.mailboxId, records, condition);
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
  const condition = requireDeleteCondition(
    and(
      eq(managedMailMessage.mailboxId, input.mailboxId),
      eq(managedMailMessage.threadId, input.threadId)
    )
  );
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

  await deleteManagedMailRecords(input.mailboxId, records, condition);
  return {
    messages: records.map((record) => ({
      id: record.id,
      isUnread: false,
      labelIds: [],
    })),
    threadId: input.threadId,
  };
};
