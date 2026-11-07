import { db } from "@quieter/database/client";
import {
  gmailComposeOperation,
  gmailMessageOpenTracking,
} from "@quieter/database/schema";
import {
  extractMailAddress,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

export const prepareGmailOpenTracking = async (input: {
  operation: typeof gmailComposeOperation.$inferSelect;
  enabled: boolean;
  recipients: { to: string; cc: string; bcc: string };
}) => {
  if (!input.enabled) {
    await db
      .delete(gmailMessageOpenTracking)
      .where(
        eq(gmailMessageOpenTracking.composeOperationId, input.operation.id)
      );
    return;
  }
  const recipients = [
    ...new Set(
      Object.values(input.recipients).flatMap((field) =>
        splitMailAddressList(field).map((address) =>
          extractMailAddress(address).trim().toLowerCase()
        )
      )
    ),
  ].filter(Boolean);
  const recipient = recipients.length === 1 ? recipients[0] : null;
  await db
    .insert(gmailMessageOpenTracking)
    .values({
      composeOperationId: input.operation.id,
      createdAt: new Date(),
      mailboxId: input.operation.mailboxId,
      messageHeaderId: input.operation.messageHeaderId,
      recipient,
    })
    .onConflictDoUpdate({
      set: { recipient },
      target: gmailMessageOpenTracking.composeOperationId,
    });
};

export const recordGmailMailMarkerLoad = async (input: {
  messageHeaderId: string;
  occurredAt: Date;
}) => {
  const occurredAt = sql.param(
    input.occurredAt,
    gmailMessageOpenTracking.firstLoadedAt
  );
  const [recorded] = await db
    .update(gmailMessageOpenTracking)
    .set({
      firstLoadedAt: sql`least(coalesce(${gmailMessageOpenTracking.firstLoadedAt}, ${occurredAt}), ${occurredAt})`,
      lastLoadedAt: sql`greatest(coalesce(${gmailMessageOpenTracking.lastLoadedAt}, ${occurredAt}), ${occurredAt})`,
      reportedLoadCount: sql`least(${gmailMessageOpenTracking.reportedLoadCount} + 1, 10000)`,
    })
    .from(gmailComposeOperation)
    .where(
      and(
        eq(gmailMessageOpenTracking.messageHeaderId, input.messageHeaderId),
        eq(
          gmailMessageOpenTracking.composeOperationId,
          gmailComposeOperation.id
        ),
        eq(gmailMessageOpenTracking.mailboxId, gmailComposeOperation.mailboxId),
        eq(gmailComposeOperation.kind, "send"),
        inArray(gmailComposeOperation.status, [
          "submitting",
          "unknown",
          "accepted",
        ])
      )
    )
    .returning({
      count: gmailMessageOpenTracking.reportedLoadCount,
      recipient: gmailMessageOpenTracking.recipient,
    });
  return recorded === undefined
    ? null
    : {
        attributedRecipient: recorded.recipient,
        firstOpen: recorded.count === 1,
      };
};

export const getGmailMessageDelivery = async (input: {
  mailboxId: string;
  messageId: string;
}) => {
  const [tracking] = await db
    .select()
    .from(gmailMessageOpenTracking)
    .where(
      and(
        eq(gmailMessageOpenTracking.mailboxId, input.mailboxId),
        eq(gmailMessageOpenTracking.messageId, input.messageId)
      )
    )
    .limit(1);
  if (tracking === undefined) {
    return null;
  }
  return {
    deliveryTrackingAvailable: false,
    events:
      tracking.recipient !== null && tracking.firstLoadedAt !== null
        ? [
            {
              diagnosticCode: null,
              eventType: "opened" as const,
              occurredAt: tracking.firstLoadedAt,
              providerStatus: null,
              reason: null,
              recipient: tracking.recipient,
            },
          ]
        : [],
    messageId: input.messageId,
    openTracking: {
      firstLoadedAt: tracking.firstLoadedAt,
      lastLoadedAt: tracking.lastLoadedAt,
      reportedLoadCount: tracking.reportedLoadCount,
    },
    recipients: [],
  };
};
