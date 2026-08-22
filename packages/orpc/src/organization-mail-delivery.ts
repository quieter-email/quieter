import { createHash, randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailMessage,
  organizationApiMailMessage,
  organizationMailDeliveryEvent,
  organizationMailDeliveryRecipient,
  organizationMailRecipientSuppression,
  organizationMailSuppressionAudit,
} from "@quieter/database/schema";
import type {
  OrganizationMailDeliveryEventType,
  OrganizationMailDeliveryStatus,
  OrganizationMailSuppressionAction,
  OrganizationMailSuppressionReason,
} from "@quieter/database/schema";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

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

/**
 * Terminal outcomes are ordered by severity: observing a more severe outcome
 * escalates the status, but nothing regresses an existing terminal one.
 * Non-terminal statuses follow the most recently observed event time.
 */
const TERMINAL_DELIVERY_STATUS_RANK: Partial<
  Record<OrganizationMailDeliveryStatus, number>
> = {
  bounced: 2,
  complained: 3,
  rejected: 1,
  unsubscribed: 0,
};

export const isTerminalDeliveryStatus = (
  status: OrganizationMailDeliveryStatus
) => TERMINAL_DELIVERY_STATUS_RANK[status] !== undefined;

export type DeliveryStatePoint = {
  occurredAt: Date;
  status: OrganizationMailDeliveryStatus;
};

export const mergeDeliveryStatus = (
  current: DeliveryStatePoint | null,
  incoming: DeliveryStatePoint
): DeliveryStatePoint => {
  if (current === null) {
    return incoming;
  }
  const currentRank = TERMINAL_DELIVERY_STATUS_RANK[current.status];
  const incomingRank = TERMINAL_DELIVERY_STATUS_RANK[incoming.status];
  if (currentRank !== undefined && incomingRank !== undefined) {
    return incomingRank > currentRank ? incoming : current;
  }
  if (currentRank !== undefined || incomingRank !== undefined) {
    return currentRank === undefined ? incoming : current;
  }
  return incoming.occurredAt.getTime() >= current.occurredAt.getTime()
    ? incoming
    : current;
};

const suppressionSeveritySql = (column: unknown) =>
  sql`case ${column} when 'complaint' then 3 when 'bounce' then 2 when 'unsubscribe' then 1 else 0 end`;

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

export type MessageDeliveryStatusRow = {
  messageId: string;
  status: OrganizationMailDeliveryStatus;
};

export const groupDeliveryStatusesByMessage = (
  rows: readonly MessageDeliveryStatusRow[]
) => {
  const statuses: Record<string, OrganizationMailDeliveryStatus[]> = {};
  for (const row of rows) {
    const existing = statuses[row.messageId];
    if (existing === undefined) {
      statuses[row.messageId] = [row.status];
    } else {
      existing.push(row.status);
    }
  }
  return statuses;
};

export const getSuppressionReason = (
  feedback: Pick<OrganizationMailFeedback, "eventType" | "permanentFailure">
): OrganizationMailSuppressionReason | null => {
  if (feedback.eventType === "complained") {
    return "complaint";
  }
  if (feedback.eventType === "unsubscribed") {
    return "unsubscribe";
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

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const recordSuppressionAudit = async (
  transaction: DatabaseTransaction,
  input: {
    action: OrganizationMailSuppressionAction;
    actorUserId: string | null;
    createdAt: Date;
    organizationId: string;
    reason: OrganizationMailSuppressionReason;
    recipient: string;
    sourceProviderMessageId: string | null;
  }
) => {
  await transaction.insert(organizationMailSuppressionAudit).values({
    action: input.action,
    actorUserId: input.actorUserId,
    createdAt: input.createdAt,
    id: randomUUID(),
    organizationId: input.organizationId,
    reason: input.reason,
    recipient: input.recipient,
    sourceProviderMessageId: input.sourceProviderMessageId,
  });
};

const applySuppressionChange = async (
  transaction: DatabaseTransaction,
  input: {
    actorUserId: string | null;
    createdAt: Date;
    organizationId: string;
    recipient: string;
    sourceProviderMessageId: string | null;
    suppressionReason: OrganizationMailSuppressionReason;
  }
) => {
  const inserted = await transaction
    .insert(organizationMailRecipientSuppression)
    .values({
      createdAt: input.createdAt,
      organizationId: input.organizationId,
      reason: input.suppressionReason,
      recipient: input.recipient,
      revokedAt: null,
      sourceProviderMessageId: input.sourceProviderMessageId,
      updatedAt: input.createdAt,
    })
    .onConflictDoNothing({
      target: [
        organizationMailRecipientSuppression.organizationId,
        organizationMailRecipientSuppression.recipient,
      ],
    })
    .returning({ recipient: organizationMailRecipientSuppression.recipient });

  if (inserted.length > 0) {
    await recordSuppressionAudit(transaction, {
      action: "suppressed",
      actorUserId: input.actorUserId,
      createdAt: input.createdAt,
      organizationId: input.organizationId,
      reason: input.suppressionReason,
      recipient: input.recipient,
      sourceProviderMessageId: input.sourceProviderMessageId,
    });
    return true;
  }

  const updated = await transaction
    .update(organizationMailRecipientSuppression)
    .set({
      reason: sql`case
        when ${suppressionSeveritySql(organizationMailRecipientSuppression.reason)} >= ${suppressionSeveritySql(input.suppressionReason)}
          then ${organizationMailRecipientSuppression.reason}
        else ${input.suppressionReason}
      end`,
      revokedAt: null,
      updatedAt: input.createdAt,
      ...(input.sourceProviderMessageId === null
        ? {}
        : { sourceProviderMessageId: input.sourceProviderMessageId }),
    })
    .where(
      and(
        eq(
          organizationMailRecipientSuppression.organizationId,
          input.organizationId
        ),
        eq(organizationMailRecipientSuppression.recipient, input.recipient),
        sql`(
          ${organizationMailRecipientSuppression.revokedAt} is not null
          or ${suppressionSeveritySql(organizationMailRecipientSuppression.reason)} < ${suppressionSeveritySql(input.suppressionReason)}
        )`
      )
    )
    .returning({
      reason: organizationMailRecipientSuppression.reason,
    });

  if (updated.length === 0) {
    return false;
  }

  await recordSuppressionAudit(transaction, {
    action: "suppressed",
    actorUserId: input.actorUserId,
    createdAt: input.createdAt,
    organizationId: input.organizationId,
    reason: updated[0].reason,
    recipient: input.recipient,
    sourceProviderMessageId: input.sourceProviderMessageId,
  });
  return true;
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
                when ${organizationMailDeliveryRecipient.status} = 'bounced' then ${organizationMailDeliveryRecipient.status}
                when excluded."status" = 'bounced' then excluded."status"
                when ${organizationMailDeliveryRecipient.status} = 'rejected' then ${organizationMailDeliveryRecipient.status}
                when excluded."status" = 'rejected' then excluded."status"
                when ${organizationMailDeliveryRecipient.status} = 'unsubscribed' then ${organizationMailDeliveryRecipient.status}
                when excluded."status" = 'unsubscribed' then excluded."status"
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
          await applySuppressionChange(transaction, {
            actorUserId: null,
            createdAt: now,
            organizationId,
            recipient: recipient.emailAddress,
            sourceProviderMessageId: feedback.providerMessageId,
            suppressionReason,
          });
        }
      })
    );
  });
};

export const suppressOrganizationMailRecipient = async (input: {
  actorUserId: string;
  organizationId: string;
  recipient: string;
}) => {
  const recipient = normalizeRecipient(input.recipient);
  if (recipient === "") {
    throw new OrganizationMailSendError("A valid address is required.", 422);
  }
  const changed = await db.transaction(
    async (transaction) =>
      await applySuppressionChange(transaction, {
        actorUserId: input.actorUserId,
        createdAt: new Date(),
        organizationId: input.organizationId,
        recipient,
        sourceProviderMessageId: null,
        suppressionReason: "manual",
      })
  );
  return { changed };
};

export const unsuppressOrganizationMailRecipient = async (input: {
  actorUserId: string;
  organizationId: string;
  recipient: string;
}) => {
  const recipient = normalizeRecipient(input.recipient);
  if (recipient === "") {
    throw new OrganizationMailSendError("A valid address is required.", 422);
  }
  const now = new Date();
  return await db.transaction(async (transaction) => {
    const revoked = await transaction
      .update(organizationMailRecipientSuppression)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(
            organizationMailRecipientSuppression.organizationId,
            input.organizationId
          ),
          eq(organizationMailRecipientSuppression.recipient, recipient),
          isNull(organizationMailRecipientSuppression.revokedAt)
        )
      )
      .returning({
        reason: organizationMailRecipientSuppression.reason,
      });

    if (revoked.length === 0) {
      return { changed: false };
    }

    await recordSuppressionAudit(transaction, {
      action: "unsuppressed",
      actorUserId: input.actorUserId,
      createdAt: now,
      organizationId: input.organizationId,
      reason: revoked[0].reason,
      recipient,
      sourceProviderMessageId: null,
    });
    return { changed: true };
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

export const listOrganizationMailSuppressionAudit = async (input: {
  organizationId: string;
  limit?: number;
  recipient?: string;
}) => {
  const conditions = [
    eq(organizationMailSuppressionAudit.organizationId, input.organizationId),
  ];
  if (input.recipient !== undefined && input.recipient.trim() !== "") {
    conditions.push(
      eq(
        organizationMailSuppressionAudit.recipient,
        normalizeRecipient(input.recipient)
      )
    );
  }

  return await db
    .select({
      action: organizationMailSuppressionAudit.action,
      actorUserId: organizationMailSuppressionAudit.actorUserId,
      createdAt: organizationMailSuppressionAudit.createdAt,
      id: organizationMailSuppressionAudit.id,
      reason: organizationMailSuppressionAudit.reason,
      recipient: organizationMailSuppressionAudit.recipient,
      sourceProviderMessageId:
        organizationMailSuppressionAudit.sourceProviderMessageId,
    })
    .from(organizationMailSuppressionAudit)
    .where(and(...conditions))
    .orderBy(desc(organizationMailSuppressionAudit.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
};

/**
 * Recomputes recipient projections from the immutable event log without
 * touching events. Repairs projection drift; missed notifications are repaired
 * by replaying them through the normal idempotent ingestion path.
 */
export const reconcileOrganizationMailDeliveryRecipients = async (input: {
  organizationId: string;
  providerMessageId: string;
}) => {
  const events = await db
    .select({
      occurredAt: organizationMailDeliveryEvent.occurredAt,
      recipient: organizationMailDeliveryEvent.recipient,
      status: organizationMailDeliveryEvent.eventType,
    })
    .from(organizationMailDeliveryEvent)
    .where(
      and(
        eq(organizationMailDeliveryEvent.organizationId, input.organizationId),
        eq(
          organizationMailDeliveryEvent.providerMessageId,
          input.providerMessageId
        )
      )
    )
    .orderBy(
      organizationMailDeliveryEvent.occurredAt,
      organizationMailDeliveryEvent.createdAt
    );

  const projections = new Map<string, DeliveryStatePoint>();
  for (const event of events) {
    const merged = mergeDeliveryStatus(
      projections.get(event.recipient) ?? null,
      {
        occurredAt: event.occurredAt,
        status: event.status,
      }
    );
    projections.set(event.recipient, merged);
  }

  const now = new Date();
  await Promise.all(
    [...projections.entries()].map(([recipient, state]) =>
      db
        .insert(organizationMailDeliveryRecipient)
        .values({
          createdAt: now,
          lastEventAt: state.occurredAt,
          organizationId: input.organizationId,
          providerMessageId: input.providerMessageId,
          recipient,
          status: state.status,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            lastEventAt: state.occurredAt,
            status: state.status,
            updatedAt: now,
          },
          target: [
            organizationMailDeliveryRecipient.organizationId,
            organizationMailDeliveryRecipient.providerMessageId,
            organizationMailDeliveryRecipient.recipient,
          ],
        })
    )
  );
  return { reconciled: projections.size };
};

export const summarizeOrganizationMailDeliveryEvents = async (input: {
  from?: Date;
  organizationId: string;
  to?: Date;
}) => {
  const conditions = [
    eq(organizationMailDeliveryEvent.organizationId, input.organizationId),
  ];
  if (input.from !== undefined) {
    conditions.push(gte(organizationMailDeliveryEvent.occurredAt, input.from));
  }
  if (input.to !== undefined) {
    conditions.push(lte(organizationMailDeliveryEvent.occurredAt, input.to));
  }

  const rows = await db
    .select({
      count: sql<number>`count(*)::int`,
      eventType: organizationMailDeliveryEvent.eventType,
    })
    .from(organizationMailDeliveryEvent)
    .where(and(...conditions))
    .groupBy(organizationMailDeliveryEvent.eventType);

  const summary: Partial<Record<OrganizationMailDeliveryEventType, number>> =
    {};
  for (const row of rows) {
    summary[row.eventType] = row.count;
  }
  return summary;
};
