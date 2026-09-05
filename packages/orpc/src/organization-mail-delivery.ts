import { createHash, randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailMessage,
  organizationApiMailMessage,
  organizationMailDeliveryEvent,
  organizationMailDeliveryRecipient,
  organizationMailOpenEvent,
  organizationMailRecipientSuppression,
  organizationMailSuppressionAudit,
  organizationMailTrackingSettings,
} from "@quieter/database/schema";
import type {
  OrganizationMailDeliveryEventType,
  OrganizationMailDeliveryStatus,
  OrganizationMailSuppressionAction,
  OrganizationMailSuppressionReason,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import {
  extractMailAddress,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import {
  appendOpenTrackingPixel,
  buildOpenTrackingToken,
} from "@quieter/mail/tracking";
import { reportError } from "@quieter/observability";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { OrganizationMailSendError } from "./organization-mail-policy";
import { hasText } from "./text";

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

const DELIVERY_STATUS_RANK: Record<OrganizationMailDeliveryStatus, number> = {
  bounced: 5,
  complained: 6,
  delayed: 2,
  delivered: 3,
  queued: 0,
  rejected: 4,
  sent: 1,
};

export const isTerminalDeliveryStatus = (
  status: OrganizationMailDeliveryStatus
) => DELIVERY_STATUS_RANK[status] >= DELIVERY_STATUS_RANK.delivered;

export type DeliveryStatePoint = {
  occurredAt: Date;
  status: OrganizationMailDeliveryStatus;
};

export const mergeDeliveryStatus = (
  current: DeliveryStatePoint | null,
  incoming: DeliveryStatePoint
): DeliveryStatePoint => ({
  occurredAt: new Date(
    Math.max(
      current?.occurredAt.getTime() ?? -Infinity,
      incoming.occurredAt.getTime()
    )
  ),
  status:
    current !== null &&
    DELIVERY_STATUS_RANK[current.status] > DELIVERY_STATUS_RANK[incoming.status]
      ? current.status
      : incoming.status,
});

const suppressionSeveritySql = (column: unknown) =>
  sql`case ${column} when 'complaint' then 3 when 'bounce' then 2 when 'unsubscribe' then 1 else 0 end`;

const deliveryStatusRankSql = (column: unknown) => sql`case ${column}
  ${sql.join(
    Object.entries(DELIVERY_STATUS_RANK).map(
      ([status, rank]) => sql`when ${status} then ${rank}`
    ),
    sql` `
  )}
  else -1 end`;

const mergeDeliveryStatusSql = (statusColumn: unknown) => sql`case
  when ${deliveryStatusRankSql(statusColumn)} > ${deliveryStatusRankSql(sql`excluded."status"`)} then ${statusColumn}
  else excluded."status"
end`;

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
    occurredAt?: Date;
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
        when ${organizationMailRecipientSuppression.revokedAt} is not null then ${input.suppressionReason}
        when ${suppressionSeveritySql(organizationMailRecipientSuppression.reason)} >= ${suppressionSeveritySql(input.suppressionReason)}
          then ${organizationMailRecipientSuppression.reason}
        else ${input.suppressionReason}
      end`,
      revokedAt: null,
      sourceProviderMessageId: input.sourceProviderMessageId,
      updatedAt: input.createdAt,
    })
    .where(
      and(
        eq(
          organizationMailRecipientSuppression.organizationId,
          input.organizationId
        ),
        eq(organizationMailRecipientSuppression.recipient, input.recipient),
        ...(input.occurredAt === undefined
          ? []
          : [
              sql`(${organizationMailRecipientSuppression.revokedAt} is null or ${organizationMailRecipientSuppression.revokedAt} < ${input.occurredAt.toISOString()}::timestamp)`,
            ]),
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
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([organizationId, feedback.providerMessageId])}, 0))`
    );
    for (const recipient of recipients.toSorted((a, b) =>
      a.emailAddress.localeCompare(b.emailAddress)
    )) {
      const dedupeKey = createDedupeKey({
        eventType: feedback.eventType,
        provider: feedback.provider,
        providerMessageId: feedback.providerMessageId,
        recipient: recipient.emailAddress,
        sourceEventId: feedback.sourceEventId,
      });
      // oxlint-disable-next-line no-await-in-loop -- Consistent recipient lock order prevents cross-message deadlocks.
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
        continue;
      }

      if (
        feedback.eventType !== "opened" &&
        feedback.eventType !== "unsubscribed"
      ) {
        // oxlint-disable-next-line no-await-in-loop -- Preserve recipient lock order within the transaction.
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
              status: mergeDeliveryStatusSql(
                organizationMailDeliveryRecipient.status
              ),
              updatedAt: now,
            },
            target: [
              organizationMailDeliveryRecipient.organizationId,
              organizationMailDeliveryRecipient.providerMessageId,
              organizationMailDeliveryRecipient.recipient,
            ],
          });
      }
      if (suppressionReason !== null) {
        // oxlint-disable-next-line no-await-in-loop -- Preserve recipient lock order within the transaction.
        await applySuppressionChange(transaction, {
          actorUserId: null,
          createdAt: now,
          occurredAt: feedback.occurredAt,
          organizationId,
          recipient: recipient.emailAddress,
          sourceProviderMessageId: feedback.providerMessageId,
          suppressionReason,
        });
      }
    }
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
}) =>
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.organizationId, input.providerMessageId])}, 0))`
    );
    const events = await transaction
      .select({
        occurredAt: organizationMailDeliveryEvent.occurredAt,
        recipient: organizationMailDeliveryEvent.recipient,
        status: organizationMailDeliveryEvent.eventType,
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
      .orderBy(
        organizationMailDeliveryEvent.occurredAt,
        organizationMailDeliveryEvent.createdAt
      );

    const projections = new Map<string, DeliveryStatePoint>();
    for (const event of events) {
      if (event.status === "opened" || event.status === "unsubscribed") {
        continue;
      }
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
    await transaction
      .delete(organizationMailDeliveryRecipient)
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
      );
    await Promise.all(
      [...projections.entries()].map(([recipient, state]) =>
        transaction
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
  });

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
      count: sql<number>`count(distinct (${organizationMailDeliveryEvent.providerMessageId}, ${organizationMailDeliveryEvent.recipient}))::int`,
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

export type OrganizationMailTrackingSettings = {
  allowPerSendOverride: boolean;
  openTrackingEnabled: boolean;
};

export const getOrganizationMailTrackingSettings = async (input: {
  organizationId: string;
}): Promise<OrganizationMailTrackingSettings> => {
  const [settings] = await db
    .select({
      allowPerSendOverride:
        organizationMailTrackingSettings.allowPerSendOverride,
      openTrackingEnabled: organizationMailTrackingSettings.openTrackingEnabled,
    })
    .from(organizationMailTrackingSettings)
    .where(
      eq(organizationMailTrackingSettings.organizationId, input.organizationId)
    )
    .limit(1);

  return (
    settings ?? {
      allowPerSendOverride: false,
      openTrackingEnabled: false,
    }
  );
};

export const setOrganizationMailTrackingSettings = async (input: {
  actorUserId: string;
  allowPerSendOverride?: boolean;
  openTrackingEnabled?: boolean;
  organizationId: string;
}) => {
  const now = new Date();
  const next = {
    allowPerSendOverride: input.allowPerSendOverride ?? false,
    openTrackingEnabled: input.openTrackingEnabled ?? false,
  };

  const [saved] = await db
    .insert(organizationMailTrackingSettings)
    .values({
      ...next,
      createdAt: now,
      organizationId: input.organizationId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        ...(input.openTrackingEnabled === undefined
          ? {}
          : { openTrackingEnabled: input.openTrackingEnabled }),
        ...(input.allowPerSendOverride === undefined
          ? {}
          : { allowPerSendOverride: input.allowPerSendOverride }),
        updatedAt: now,
      },
      target: organizationMailTrackingSettings.organizationId,
    })
    .returning({
      allowPerSendOverride:
        organizationMailTrackingSettings.allowPerSendOverride,
      openTrackingEnabled: organizationMailTrackingSettings.openTrackingEnabled,
    });
  if (saved === undefined) {
    throw new Error("Tracking settings were not saved.");
  }
  return saved;
};

/**
 * Precedence: tracking stays off unless the organization enables it. A
 * per-send value is honored only when the organization allows overrides.
 */
export const resolveEffectiveOpenTracking = (
  settings: { allowPerSendOverride: boolean; openTrackingEnabled: boolean },
  openTracking?: boolean
) => {
  if (!settings.openTrackingEnabled) {
    return false;
  }
  if (openTracking === undefined) {
    return true;
  }
  return settings.allowPerSendOverride ? openTracking : true;
};

export const resolveOrganizationMailOpenTracking = async (input: {
  openTracking?: boolean;
  organizationId: string;
}) =>
  resolveEffectiveOpenTracking(
    await getOrganizationMailTrackingSettings(input),
    input.openTracking
  );

/**
 * Builds the html transform that appends the signed open marker when tracking
 * is active for a send. Missing signing configuration disables the marker for
 * that send and is reported rather than failing delivery.
 */
export const buildOpenTrackingHtmlTransform = (input: {
  messageHeaderId: string;
  openTrackingEnabled: boolean;
}): { htmlTransform?: (html: string) => string } => {
  if (!input.openTrackingEnabled) {
    return {};
  }
  const secret = serverEnv.BETTER_AUTH_SECRET;
  const baseUrl = serverEnv.BETTER_AUTH_URL;
  if (!hasText(secret) || !hasText(baseUrl)) {
    reportError(
      new Error("Open tracking is enabled but signing config is missing."),
      { operation: "organization-mail:open-tracking-config" }
    );
    return {};
  }
  const token = buildOpenTrackingToken({
    messageHeaderId: input.messageHeaderId,
    secret,
  });
  return {
    htmlTransform: (html: string) =>
      appendOpenTrackingPixel(html, `${baseUrl}/api/v1/o/${token}`),
  };
};

const resolveOpenEventTarget = async (providerMessageId: string) => {
  const [apiMessage] = await db
    .select({
      bcc: organizationApiMailMessage.bcc,
      cc: organizationApiMailMessage.cc,
      organizationId: organizationApiMailMessage.organizationId,
      to: organizationApiMailMessage.to,
    })
    .from(organizationApiMailMessage)
    .where(eq(organizationApiMailMessage.providerMessageId, providerMessageId))
    .limit(1);

  if (apiMessage !== undefined) {
    return apiMessage;
  }

  const [managedMessage] = await db
    .select({
      bcc: managedMailMessage.bcc,
      cc: managedMailMessage.cc,
      organizationId: mailbox.organizationId,
      to: managedMailMessage.to,
    })
    .from(managedMailMessage)
    .innerJoin(mailbox, eq(mailbox.id, managedMailMessage.mailboxId))
    .where(
      and(
        eq(managedMailMessage.providerMessageId, providerMessageId),
        eq(managedMailMessage.direction, "outbound")
      )
    )
    .limit(1);

  return managedMessage ?? null;
};

const MAX_REPORTED_OPENS = 10_000;

/**
 * Records an open marker load. Opens are approximate: mail clients, privacy
 * proxies, and caches can fetch or block the marker arbitrarily. The signal is
 * bounded to one row per message with a capped counter; duplicate loads never
 * inflate history. Only unambiguous single-recipient sends are attributed to a
 * recipient.
 */
export const recordOrganizationMailOpenEvent = async (input: {
  occurredAt: Date;
  providerMessageId: string;
}) => {
  const target = await resolveOpenEventTarget(input.providerMessageId);
  if (target === null) {
    throw new OrganizationMailFeedbackMessageNotFoundError(
      input.providerMessageId
    );
  }
  const recipients = normalizeRecipients([
    ...splitMailAddressList(target.to ?? undefined),
    ...splitMailAddressList(target.cc ?? undefined),
    ...splitMailAddressList(target.bcc ?? undefined),
  ]);
  const attributedRecipient = recipients.length === 1 ? recipients[0] : null;
  const now = input.occurredAt;

  return await db.transaction(async (transaction) => {
    if (attributedRecipient !== null) {
      await transaction
        .insert(organizationMailDeliveryEvent)
        .values({
          createdAt: now,
          dedupeKey: createDedupeKey({
            eventType: "opened",
            provider: "quieter",
            providerMessageId: input.providerMessageId,
            recipient: attributedRecipient,
            sourceEventId: "open-marker",
          }),
          eventType: "opened",
          id: randomUUID(),
          occurredAt: now,
          organizationId: target.organizationId,
          provider: "quieter",
          providerMessageId: input.providerMessageId,
          recipient: attributedRecipient,
        })
        .onConflictDoNothing({
          target: organizationMailDeliveryEvent.dedupeKey,
        })
        .returning({ id: organizationMailDeliveryEvent.id });
    }

    const [openRow] = await transaction
      .insert(organizationMailOpenEvent)
      .values({
        createdAt: now,
        firstOpenedAt: now,
        id: randomUUID(),
        lastOpenedAt: now,
        organizationId: target.organizationId,
        providerMessageId: input.providerMessageId,
        recipient: attributedRecipient,
        reportedOpenCount: 1,
      })
      .onConflictDoUpdate({
        set: {
          firstOpenedAt: sql`least(${organizationMailOpenEvent.firstOpenedAt}, excluded."firstOpenedAt")`,
          lastOpenedAt: sql`greatest(${organizationMailOpenEvent.lastOpenedAt}, excluded."lastOpenedAt")`,
          reportedOpenCount: sql`least(${organizationMailOpenEvent.reportedOpenCount} + 1, ${MAX_REPORTED_OPENS})`,
        },
        target: [
          organizationMailOpenEvent.organizationId,
          organizationMailOpenEvent.providerMessageId,
        ],
      })
      .returning({
        reportedOpenCount: organizationMailOpenEvent.reportedOpenCount,
      });

    return { attributedRecipient, firstOpen: openRow?.reportedOpenCount === 1 };
  });
};

/**
 * Records an open-marker load addressed by the Quieter Message-ID header.
 * Tokens never carry database ids, so this resolves the header to the stored
 * outbound message first.
 */
export const recordOrganizationMailMarkerLoad = async (input: {
  messageHeaderId: string;
  occurredAt: Date;
}) => {
  const [apiRow] = await db
    .select({
      providerMessageId: organizationApiMailMessage.providerMessageId,
    })
    .from(organizationApiMailMessage)
    .where(
      eq(organizationApiMailMessage.messageHeaderId, input.messageHeaderId)
    )
    .limit(1);

  let providerMessageId = apiRow?.providerMessageId;
  if (providerMessageId === undefined) {
    const [managedRow] = await db
      .select({
        providerMessageId: managedMailMessage.providerMessageId,
      })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.messageHeaderId, input.messageHeaderId),
          eq(managedMailMessage.direction, "outbound")
        )
      )
      .limit(1);
    providerMessageId = managedRow?.providerMessageId;
  }

  if (providerMessageId === undefined || providerMessageId === "") {
    throw new OrganizationMailFeedbackMessageNotFoundError(
      input.messageHeaderId
    );
  }

  return await recordOrganizationMailOpenEvent({
    occurredAt: input.occurredAt,
    providerMessageId,
  });
};

export type OrganizationMailDeliveryMetrics = {
  eventsByType: Partial<Record<OrganizationMailDeliveryEventType, number>>;
  openedMessages: number;
};

export const getOrganizationMailDeliveryMetrics = async (input: {
  from?: Date;
  mailboxId?: string;
  organizationId: string;
  to?: Date;
}): Promise<OrganizationMailDeliveryMetrics> => {
  const conditions = [
    eq(organizationMailDeliveryEvent.organizationId, input.organizationId),
  ];
  if (input.from !== undefined) {
    conditions.push(gte(organizationMailDeliveryEvent.occurredAt, input.from));
  }
  if (input.to !== undefined) {
    conditions.push(lte(organizationMailDeliveryEvent.occurredAt, input.to));
  }
  if (input.mailboxId !== undefined && input.mailboxId !== "") {
    conditions.push(
      sql`exists (
        select 1 from ${managedMailMessage}
        where ${managedMailMessage.providerMessageId} = ${organizationMailDeliveryEvent.providerMessageId}
          and ${managedMailMessage.mailboxId} = ${input.mailboxId}
          and ${managedMailMessage.direction} = 'outbound'
      )`
    );
  }

  const [eventRows, [openRow]] = await Promise.all([
    db
      .select({
        count: sql<number>`count(distinct (${organizationMailDeliveryEvent.providerMessageId}, ${organizationMailDeliveryEvent.recipient}))::int`,
        eventType: organizationMailDeliveryEvent.eventType,
      })
      .from(organizationMailDeliveryEvent)
      .where(and(...conditions))
      .groupBy(organizationMailDeliveryEvent.eventType),
    db
      .select({
        openedMessages: sql<number>`count(*)::int`,
      })
      .from(organizationMailOpenEvent)
      .where(
        and(
          eq(organizationMailOpenEvent.organizationId, input.organizationId),
          ...(input.mailboxId === undefined
            ? []
            : [
                sql`exists (
            select 1 from ${managedMailMessage}
            where ${managedMailMessage.providerMessageId} = ${organizationMailOpenEvent.providerMessageId}
              and ${managedMailMessage.mailboxId} = ${input.mailboxId}
              and ${managedMailMessage.direction} = 'outbound'
          )`,
              ]),
          ...(input.from === undefined
            ? []
            : [gte(organizationMailOpenEvent.firstOpenedAt, input.from)]),
          ...(input.to === undefined
            ? []
            : [lte(organizationMailOpenEvent.firstOpenedAt, input.to)])
        )
      ),
  ]);

  return {
    eventsByType: Object.fromEntries(
      eventRows.map((row) => [row.eventType, row.count])
    ),
    openedMessages: openRow?.openedMessages ?? 0,
  } satisfies OrganizationMailDeliveryMetrics;
};
