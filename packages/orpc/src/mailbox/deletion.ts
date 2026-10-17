import { db } from "@quieter/database/client";
import type { ManagedMailRawObjectProvider } from "@quieter/database/schema";
import {
  mailbox,
  mailObjectCleanup,
  managedMailMessage,
  user,
} from "@quieter/database/schema";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import { listMailUpdateRecipients, publishMailUpdate } from "../mail-updates";
import {
  getAuthorizedManagedMailbox,
  MAILBOX_PROVIDER_MANAGED,
} from "./access";

export const deleteManagedMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const { recipientUserIds: recipients, ...result } = await db.transaction(
    async (tx) => {
      await tx
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(
          and(
            eq(mailbox.id, input.mailboxId),
            eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)
          )
        )
        .for("update");
      const selectedMailbox = await getAuthorizedManagedMailbox(
        { ...input, requiredRoles: ["manager"] },
        tx
      );
      const recipientUserIds = await listMailUpdateRecipients(
        input.mailboxId,
        tx
      );
      const objects = tx
        .select({
          bucket: sql<string>`${managedMailMessage.rawObjectBucket}`.as(
            "bucket"
          ),
          key: sql<string>`${managedMailMessage.rawObjectKey}`.as("key"),
          provider:
            sql<ManagedMailRawObjectProvider>`${managedMailMessage.rawObjectProvider}`.as(
              "provider"
            ),
        })
        .from(managedMailMessage)
        .where(
          and(
            eq(managedMailMessage.mailboxId, input.mailboxId),
            isNotNull(managedMailMessage.rawObjectProvider),
            ne(managedMailMessage.rawObjectBucket, ""),
            ne(managedMailMessage.rawObjectKey, "")
          )
        )
        .union(
          tx
            .select({
              bucket: sql<string>`${managedMailMessage.s3Bucket}`.as("bucket"),
              key: sql<string>`${managedMailMessage.s3Key}`.as("key"),
              provider: sql<ManagedMailRawObjectProvider>`'s3'`.as("provider"),
            })
            .from(managedMailMessage)
            .where(
              and(
                eq(managedMailMessage.mailboxId, input.mailboxId),
                ne(managedMailMessage.s3Bucket, ""),
                ne(managedMailMessage.s3Key, "")
              )
            )
        )
        .as("mailbox_objects");
      const now = new Date();
      await tx
        .insert(mailObjectCleanup)
        .select(
          tx
            .select({
              bucket: objects.bucket,
              createdAt: sql<Date>`${now.toISOString()}::timestamp`.as(
                "createdAt"
              ),
              id: sql<string>`gen_random_uuid()::text`.as("id"),
              key: objects.key,
              notBefore: sql<Date>`${now.toISOString()}::timestamp`.as(
                "notBefore"
              ),
              provider: objects.provider,
            })
            .from(objects)
        )
        .onConflictDoUpdate({
          set: { notBefore: now },
          target: [
            mailObjectCleanup.provider,
            mailObjectCleanup.bucket,
            mailObjectCleanup.key,
          ],
        });
      await tx
        .update(user)
        .set({ defaultMailboxId: null, updatedAt: now })
        .where(eq(user.defaultMailboxId, input.mailboxId));
      await tx
        .delete(mailbox)
        .where(
          and(
            eq(mailbox.id, input.mailboxId),
            eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)
          )
        );
      return {
        deleted: true,
        mailboxId: input.mailboxId,
        organizationId: selectedMailbox.organizationId,
        recipientUserIds,
      };
    }
  );
  await publishMailUpdate(
    { mailboxId: input.mailboxId, type: "mailbox.changed" },
    { recipientUserIds: recipients }
  );
  return result;
};
