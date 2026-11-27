import { db } from "@quieter/database/client";
import {
  gmailComposeOperation,
  organizationMailSendIdempotency,
  scheduledMailSend,
} from "@quieter/database/schema";
import type { MessageListItem } from "@quieter/mail/messages";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export const attachScheduledSendMetadata = async ({
  mailboxId,
  messages,
  source,
  userId,
}: {
  mailboxId: string;
  messages: MessageListItem[];
  source:
    | { provider: "gmail" }
    | { provider: "managed"; organizationId: string };
  userId: string;
}) => {
  if (messages.length === 0) {
    return messages;
  }

  const messageIds = messages.map((message) => message.id);
  const scope = and(
    eq(scheduledMailSend.mailboxId, mailboxId),
    eq(scheduledMailSend.userId, userId),
    eq(scheduledMailSend.deliveryKind, "scheduled"),
    inArray(scheduledMailSend.status, ["sending", "uncertain", "sent"])
  );
  const schedule = {
    sendAt: scheduledMailSend.sendAt,
    timeZone: scheduledMailSend.timeZone,
  };
  const managedMessageId = sql<string>`coalesce(${scheduledMailSend.sentMessageId}, ${organizationMailSendIdempotency.id})`;
  const gmailMessageId = sql<string>`coalesce(${scheduledMailSend.sentMessageId}, ${gmailComposeOperation.response}->>'id')`;
  // Older sends have no stored message ID. Use their receipt while it exists.
  const needsReceipt = isNull(scheduledMailSend.sentMessageId);
  const rows =
    source.provider === "managed"
      ? await db
          .select({
            ...schedule,
            messageId: managedMessageId,
          })
          .from(scheduledMailSend)
          .leftJoin(
            organizationMailSendIdempotency,
            and(
              needsReceipt,
              eq(
                organizationMailSendIdempotency.organizationId,
                source.organizationId
              ),
              eq(
                organizationMailSendIdempotency.idempotencyKey,
                sql`concat('compose:', ${scheduledMailSend.mailboxId}, ':', ${scheduledMailSend.sendOperationId})`
              ),
              inArray(organizationMailSendIdempotency.status, [
                "accepted",
                "completed",
              ])
            )
          )
          .where(and(scope, inArray(managedMessageId, messageIds)))
      : await db
          .select({ ...schedule, messageId: gmailMessageId })
          .from(scheduledMailSend)
          .leftJoin(
            gmailComposeOperation,
            and(
              needsReceipt,
              eq(gmailComposeOperation.mailboxId, mailboxId),
              eq(
                gmailComposeOperation.operationKey,
                sql`concat('send:', ${scheduledMailSend.sendOperationId})`
              ),
              eq(gmailComposeOperation.status, "accepted")
            )
          )
          .where(and(scope, inArray(gmailMessageId, messageIds)));

  const byMessage = new Map(
    rows.map(({ messageId, sendAt, timeZone }) => [
      messageId,
      { sendAt: sendAt.toISOString(), timeZone },
    ])
  );
  return messages.map((message) => {
    const scheduledSend = byMessage.get(message.id);
    return scheduledSend === undefined
      ? message
      : { ...message, scheduledSend };
  });
};
