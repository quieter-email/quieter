import { db } from "@quieter/database/client";
import {
  mailbox,
  mailObjectCleanup,
  managedMailMessage,
  user,
} from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

import type { RawMailObjectReference } from "../managed-mail/messages/raw-object";
import {
  getAuthorizedManagedMailbox,
  MAILBOX_PROVIDER_MANAGED,
} from "./access";

export const deleteManagedMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) =>
  await db.transaction(async (tx) => {
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
    const messages = await tx
      .selectDistinct({
        rawObjectBucket: managedMailMessage.rawObjectBucket,
        rawObjectKey: managedMailMessage.rawObjectKey,
        rawObjectProvider: managedMailMessage.rawObjectProvider,
        s3Bucket: managedMailMessage.s3Bucket,
        s3Key: managedMailMessage.s3Key,
      })
      .from(managedMailMessage)
      .where(eq(managedMailMessage.mailboxId, input.mailboxId));
    const objectsByKey = new Map<string, RawMailObjectReference>();
    for (const message of messages) {
      if (
        message.rawObjectProvider !== null &&
        message.rawObjectBucket &&
        message.rawObjectKey
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
      if (message.s3Bucket && message.s3Key) {
        objectsByKey.set(`s3\0${message.s3Bucket}\0${message.s3Key}`, {
          bucket: message.s3Bucket,
          key: message.s3Key,
          provider: "s3",
        });
      }
    }
    const now = new Date();
    const objects = [...objectsByKey.values()];
    for (let index = 0; index < objects.length; index += 500) {
      await tx
        .insert(mailObjectCleanup)
        .values(
          objects.slice(index, index + 500).map((object) => ({
            ...object,
            createdAt: now,
            id: crypto.randomUUID(),
            notBefore: now,
          }))
        )
        .onConflictDoUpdate({
          set: { notBefore: now },
          target: [
            mailObjectCleanup.provider,
            mailObjectCleanup.bucket,
            mailObjectCleanup.key,
          ],
        });
    }
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
    };
  });
