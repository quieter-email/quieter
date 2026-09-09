import {
  mailbox,
  managedMailMessage,
  organizationMailDeliveryRecipient,
  organizationMailDeliveryEvent,
} from "@quieter/database/schema";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { SyncTransaction } from "./repository";

export const projectManagedDelivery = async (
  context: SyncTransaction,
  messageIds: string[]
) => {
  if (messageIds.length === 0) {
    return;
  }
  const messages = await context.database
    .select({
      id: managedMailMessage.id,
      organizationId: mailbox.organizationId,
      providerMessageId: managedMailMessage.providerMessageId,
      threadId: managedMailMessage.threadId,
    })
    .from(managedMailMessage)
    .innerJoin(mailbox, eq(mailbox.id, managedMailMessage.mailboxId))
    .where(
      and(
        eq(managedMailMessage.mailboxId, context.mailboxId),
        eq(managedMailMessage.direction, "outbound"),
        ne(managedMailMessage.mailboxState, "draft"),
        inArray(managedMailMessage.id, messageIds)
      )
    );
  const [first] = messages;
  if (first?.organizationId === null || first === undefined) {
    return;
  }
  const recipients = await context.database
    .select()
    .from(organizationMailDeliveryRecipient)
    .where(
      and(
        eq(
          organizationMailDeliveryRecipient.organizationId,
          first.organizationId
        ),
        inArray(
          organizationMailDeliveryRecipient.providerMessageId,
          messages.map((message) => message.providerMessageId)
        )
      )
    )
    .orderBy(asc(organizationMailDeliveryRecipient.recipient));
  const byMessage = new Map<string, typeof recipients>();
  const events = await context.database
    .select({
      providerMessageId: organizationMailDeliveryEvent.providerMessageId,
      updatedAt: sql<string>`max(${organizationMailDeliveryEvent.createdAt})`,
    })
    .from(organizationMailDeliveryEvent)
    .where(
      and(
        eq(organizationMailDeliveryEvent.organizationId, first.organizationId),
        inArray(
          organizationMailDeliveryEvent.providerMessageId,
          messages.map((message) => message.providerMessageId)
        )
      )
    )
    .groupBy(organizationMailDeliveryEvent.providerMessageId);
  const eventTimes = new Map(
    events.map((event) => [
      event.providerMessageId,
      new Date(event.updatedAt).getTime(),
    ])
  );
  for (const recipient of recipients) {
    const rows = byMessage.get(recipient.providerMessageId) ?? [];
    rows.push(recipient);
    byMessage.set(recipient.providerMessageId, rows);
  }
  for (const message of messages) {
    const rows = byMessage.get(message.providerMessageId) ?? [];
    context.put({
      data: {
        kind: "delivery",
        value: {
          messageId: message.id,
          recipients: rows.map((row) => ({
            lastEventAt: row.lastEventAt.toISOString(),
            recipient: row.recipient,
            status: row.status,
          })),
          threadId: message.threadId,
          updatedAt: new Date(
            Math.max(
              eventTimes.get(message.providerMessageId) ?? 0,
              ...rows.map((row) => row.updatedAt.getTime())
            )
          ).toISOString(),
        },
      },
      id: message.id,
      kind: "delivery",
      threadId: message.threadId,
    });
  }
};
