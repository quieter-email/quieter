import { createHash, randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailMessage,
  organizationApiMailMessage,
  organizationMailDeliveryEvent,
  organizationMailDeliveryRecipient,
  organizationMailRecipientSuppression,
} from "@quieter/database/schema";
import type {
  OrganizationMailDeliveryEventType,
  OrganizationMailSuppressionReason,
} from "@quieter/database/schema";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { OrganizationMailSendError } from "./organization-mail-policy";

export type OrganizationMailFeedbackRecipient = {
  diagnosticCode?: string;
  emailAddress: string;
  providerStatus?: string;
  reason?: string;
};

export type OrganizationMailFeedback = {
  eventType: OrganizationMailDeliveryEventType;
  occurredAt: Date;
  permanentFailure?: boolean;
  provider: string;
  providerMessageId: string;
  recipients: OrganizationMailFeedbackRecipient[];
  sourceEventId: string;
};

export class OrganizationMailFeedbackMessageNotFoundError extends Error {
  constructor(providerMessageId: string) {
    super(`Outbound message ${providerMessageId} is not available yet.`);
    this.name = "OrganizationMailFeedbackMessageNotFoundError";
  }
}

const normalizeRecipient = (recipient: string) =>
  extractMailAddress(recipient).trim().toLowerCase();

const normalizeRecipients = (recipients: string[]) => [
  ...new Set(recipients.map(normalizeRecipient).filter(Boolean)),
];

const resolveOrganizationId = async (providerMessageId: string) => {
  const [apiMessage] = await db
    .select({ organizationId: organizationApiMailMessage.organizationId })
    .from(organizationApiMailMessage)
    .where(eq(organizationApiMailMessage.providerMessageId, providerMessageId))
    .limit(1);

  if (apiMessage !== undefined) {
    return apiMessage.organizationId;
  }

  const [managedMessage] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(managedMailMessage)
    .innerJoin(mailbox, eq(mailbox.id, managedMailMessage.mailboxId))
    .where(
      and(
        eq(managedMailMessage.providerMessageId, providerMessageId),
        eq(managedMailMessage.direction, "outbound")
      )
    )
    .limit(1);

  return managedMessage?.organizationId ?? null;
};

const createDedupeKey = (input: {
  eventType: OrganizationMailDeliveryEventType;
  provider: string;
  providerMessageId: string;
  recipient: string;
  sourceEventId: string;
}) =>
  createHash("sha256")
    .update(
      [
        input.provider,
        input.sourceEventId,
        input.providerMessageId,
        input.eventType,
        input.recipient,
      ].join("\n")
    )
    .digest("hex");

const getSuppressionReason = (
  feedback: OrganizationMailFeedback
): OrganizationMailSuppressionReason | null => {
  if (feedback.eventType === "complained") {
    return "complaint";
  }
  if (feedback.eventType === "bounced" && feedback.permanentFailure === true) {
    return "bounce";
  }
  return null;
};

export const assertOrganizationMailRecipientsNotSuppressed = async (input: {
  organizationId: string;
  recipients: string[];
}) => {
  const recipients = normalizeRecipients(input.recipients);
  if (recipients.length === 0) {
    return;
  }

  const [suppression] = await db
    .select({ recipient: organizationMailRecipientSuppression.recipient })
    .from(organizationMailRecipientSuppression)
    .where(
      and(
        eq(
          organizationMailRecipientSuppression.organizationId,
          input.organizationId
        ),
        inArray(organizationMailRecipientSuppression.recipient, recipients),
        isNull(organizationMailRecipientSuppression.revokedAt)
      )
    )
    .limit(1);

  if (suppression !== undefined) {
    throw new OrganizationMailSendError(
      "One or more recipients cannot receive mail from this team.",
      422
    );
  }
};

export const recordOrganizationMailFeedback = async (
  feedback: OrganizationMailFeedback
) => {
  const organizationId = await resolveOrganizationId(
    feedback.providerMessageId
  );
  if (organizationId === null) {
    throw new OrganizationMailFeedbackMessageNotFoundError(
      feedback.providerMessageId
    );
  }

  const recipients = feedback.recipients
    .map((recipient) => ({
      ...recipient,
      emailAddress: normalizeRecipient(recipient.emailAddress),
    }))
    .filter((recipient) => recipient.emailAddress !== "");
  const suppressionReason = getSuppressionReason(feedback);
  const now = new Date();

  await db.transaction(async (transaction) => {
    await Promise.all(
      recipients.map(async (recipient) => {
        const dedupeKey = createDedupeKey({
          eventType: feedback.eventType,
          provider: feedback.provider,
          providerMessageId: feedback.providerMessageId,
          recipient: recipient.emailAddress,
          sourceEventId: feedback.sourceEventId,
        });
        const insertedEvents = await transaction
          .insert(organizationMailDeliveryEvent)
          .values({
            createdAt: now,
            dedupeKey,
            diagnosticCode: recipient.diagnosticCode,
            eventType: feedback.eventType,
            id: randomUUID(),
            occurredAt: feedback.occurredAt,
            organizationId,
            provider: feedback.provider,
            providerMessageId: feedback.providerMessageId,
            providerStatus: recipient.providerStatus,
            reason: recipient.reason,
            recipient: recipient.emailAddress,
          })
          .onConflictDoNothing({
            target: organizationMailDeliveryEvent.dedupeKey,
          })
          .returning({ id: organizationMailDeliveryEvent.id });

        if (insertedEvents.length === 0) {
          return;
        }

        await transaction
          .insert(organizationMailDeliveryRecipient)
          .values({
            createdAt: now,
            lastEventAt: feedback.occurredAt,
            organizationId,
            providerMessageId: feedback.providerMessageId,
            recipient: recipient.emailAddress,
            status: feedback.eventType,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: {
              lastEventAt: sql`greatest(${organizationMailDeliveryRecipient.lastEventAt}, excluded."lastEventAt")`,
              status: sql`case
                when ${organizationMailDeliveryRecipient.status} = 'complained' then ${organizationMailDeliveryRecipient.status}
                when excluded."status" = 'complained' then excluded."status"
                when ${organizationMailDeliveryRecipient.status} in ('bounced', 'rejected') then ${organizationMailDeliveryRecipient.status}
                when excluded."status" in ('bounced', 'rejected') then excluded."status"
                when excluded."lastEventAt" >= ${organizationMailDeliveryRecipient.lastEventAt} then excluded."status"
                else ${organizationMailDeliveryRecipient.status}
              end`,
              updatedAt: now,
            },
            target: [
              organizationMailDeliveryRecipient.organizationId,
              organizationMailDeliveryRecipient.providerMessageId,
              organizationMailDeliveryRecipient.recipient,
            ],
          });

        if (suppressionReason !== null) {
          await transaction
            .insert(organizationMailRecipientSuppression)
            .values({
              createdAt: now,
              organizationId,
              reason: suppressionReason,
              recipient: recipient.emailAddress,
              revokedAt: null,
              sourceProviderMessageId: feedback.providerMessageId,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              set: {
                reason: sql`case
                  when ${organizationMailRecipientSuppression.reason} = 'complaint' then ${organizationMailRecipientSuppression.reason}
                  else excluded."reason"
                end`,
                revokedAt: null,
                sourceProviderMessageId: feedback.providerMessageId,
                updatedAt: now,
              },
              target: [
                organizationMailRecipientSuppression.organizationId,
                organizationMailRecipientSuppression.recipient,
              ],
            });
        }
      })
    );
  });
};

export const getOrganizationMailDelivery = async (input: {
  organizationId: string;
  providerMessageId: string;
}) => {
  const organizationId = await resolveOrganizationId(input.providerMessageId);
  if (organizationId !== input.organizationId) {
    return null;
  }

  const [recipients, events] = await Promise.all([
    db
      .select({
        lastEventAt: organizationMailDeliveryRecipient.lastEventAt,
        recipient: organizationMailDeliveryRecipient.recipient,
        status: organizationMailDeliveryRecipient.status,
      })
      .from(organizationMailDeliveryRecipient)
      .where(
        and(
          eq(
            organizationMailDeliveryRecipient.organizationId,
            input.organizationId
          ),
          eq(
            organizationMailDeliveryRecipient.providerMessageId,
            input.providerMessageId
          )
        )
      ),
    db
      .select({
        diagnosticCode: organizationMailDeliveryEvent.diagnosticCode,
        eventType: organizationMailDeliveryEvent.eventType,
        occurredAt: organizationMailDeliveryEvent.occurredAt,
        providerStatus: organizationMailDeliveryEvent.providerStatus,
        reason: organizationMailDeliveryEvent.reason,
        recipient: organizationMailDeliveryEvent.recipient,
      })
      .from(organizationMailDeliveryEvent)
      .where(
        and(
          eq(
            organizationMailDeliveryEvent.organizationId,
            input.organizationId
          ),
          eq(
            organizationMailDeliveryEvent.providerMessageId,
            input.providerMessageId
          )
        )
      )
      .orderBy(desc(organizationMailDeliveryEvent.occurredAt)),
  ]);

  return {
    events,
    messageId: input.providerMessageId,
    recipients,
  };
};

export const listOrganizationMailRecipientSuppressions = async (input: {
  organizationId: string;
  limit?: number;
}) =>
  await db
    .select({
      createdAt: organizationMailRecipientSuppression.createdAt,
      reason: organizationMailRecipientSuppression.reason,
      recipient: organizationMailRecipientSuppression.recipient,
      sourceProviderMessageId:
        organizationMailRecipientSuppression.sourceProviderMessageId,
    })
    .from(organizationMailRecipientSuppression)
    .where(
      and(
        eq(
          organizationMailRecipientSuppression.organizationId,
          input.organizationId
        ),
        isNull(organizationMailRecipientSuppression.revokedAt)
      )
    )
    .orderBy(desc(organizationMailRecipientSuppression.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
