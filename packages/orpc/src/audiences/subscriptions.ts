import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  organization,
  organizationAudienceMembership,
  organizationMailRecipientSuppression,
  organizationMailSuppressionAudit,
} from "@quieter/database/schema";
import {
  audienceContactSchema,
  audienceRemoveContactInputSchema,
  audienceResubscribeContactInputSchema,
  audienceSetSuppressionInputSchema,
  audienceUnsubscribeContactInputSchema,
} from "@quieter/mail/audiences";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { GrowthActor } from "../growth-access";
import { lockAudienceForSnapshot } from "./eligibility";
import {
  appendLifecycleEvent,
  assertOccurrenceTime,
  authorizeAudience,
  getContact,
  requireMembership,
  runAudienceOperation,
} from "./internal";

const changeSubscription = async (
  transaction: DatabaseTransaction,
  actor: GrowthActor | null,
  input: {
    organizationId: string;
    audienceId: string;
    membershipId: string;
    source?: string;
    channel: string;
    reason?: string;
    occurredAt: Date;
  },
  status: "unsubscribed" | "removed"
) => {
  const membership = await requireMembership(transaction, input);
  const fresh =
    input.occurredAt.getTime() >= membership.lastLifecycleOccurredAt.getTime();
  const changed = fresh && membership.status !== status;
  if (fresh) {
    await transaction
      .update(organizationAudienceMembership)
      .set({
        lastLifecycleOccurredAt: input.occurredAt,
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(
            organizationAudienceMembership.organizationId,
            input.organizationId
          ),
          eq(organizationAudienceMembership.id, membership.id)
        )
      );
  }
  await appendLifecycleEvent(transaction, {
    actor,
    afterStatus: changed ? status : membership.status,
    applied: changed,
    beforeStatus: membership.status,
    channel: input.channel,
    eventType: status,
    membership,
    occurredAt: input.occurredAt,
    reason:
      input.reason ??
      (fresh ? null : "A newer lifecycle event already exists."),
    source: input.source ?? input.channel,
  });
  return await getContact(transaction, input);
};

export const unsubscribeContact = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceUnsubscribeContactInputSchema>
) => {
  const input = audienceUnsubscribeContactInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  assertOccurrenceTime(occurredAt);
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    return await runAudienceOperation(
      transaction,
      input,
      "unsubscribeContact",
      input,
      audienceContactSchema,
      async () =>
        await changeSubscription(
          transaction,
          actor,
          { ...input, occurredAt },
          "unsubscribed"
        )
    );
  });
};

export const removeContact = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceRemoveContactInputSchema>
) => {
  const input = audienceRemoveContactInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  assertOccurrenceTime(occurredAt);
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    return await runAudienceOperation(
      transaction,
      input,
      "removeContact",
      input,
      audienceContactSchema,
      async () =>
        await changeSubscription(
          transaction,
          actor,
          { ...input, occurredAt },
          "removed"
        )
    );
  });
};

export const resubscribeContact = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceResubscribeContactInputSchema>
) => {
  const input = audienceResubscribeContactInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  const occurredAt = new Date(input.occurredAt);
  assertOccurrenceTime(occurredAt);
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    return await runAudienceOperation(
      transaction,
      input,
      "resubscribeContact",
      input,
      audienceContactSchema,
      async () => {
        const membership = await requireMembership(transaction, input);
        if (
          occurredAt.getTime() <= membership.lastLifecycleOccurredAt.getTime()
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "Resubscribing requires consent recorded after the last contact change.",
          });
        }
        await transaction
          .update(organizationAudienceMembership)
          .set({
            consentOccurredAt: occurredAt,
            consentSource: input.consentSource,
            lastLifecycleOccurredAt: occurredAt,
            status: "subscribed",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                organizationAudienceMembership.organizationId,
                input.organizationId
              ),
              eq(organizationAudienceMembership.id, membership.id)
            )
          );
        await appendLifecycleEvent(transaction, {
          actor,
          afterStatus: "subscribed",
          applied: true,
          beforeStatus: membership.status,
          channel: input.channel,
          eventType: "resubscribed",
          membership,
          occurredAt,
          source: input.consentSource,
        });
        return await getContact(transaction, input);
      }
    );
  });
};

export const setSuppression = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceSetSuppressionInputSchema>
) => {
  const input = audienceSetSuppressionInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  return await db.transaction(async (transaction) => {
    await transaction
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    return await runAudienceOperation(
      transaction,
      input,
      "setSuppression",
      input,
      audienceContactSchema,
      async () => {
        const membership = await requireMembership(transaction, input);
        const contact = await getContact(transaction, input);
        const now = new Date();
        const [suppression] = await transaction
          .select()
          .from(organizationMailRecipientSuppression)
          .where(
            and(
              eq(
                organizationMailRecipientSuppression.organizationId,
                input.organizationId
              ),
              eq(organizationMailRecipientSuppression.recipient, contact.email),
              isNull(organizationMailRecipientSuppression.revokedAt)
            )
          )
          .limit(1);
        if (
          !input.suppressed &&
          suppression !== undefined &&
          suppression.reason !== "manual"
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "This safety block must be reviewed before it can be cleared.",
          });
        }
        const changed = input.suppressed
          ? suppression === undefined
          : suppression !== undefined;
        if (changed) {
          if (input.suppressed) {
            await transaction
              .insert(organizationMailRecipientSuppression)
              .values({
                createdAt: now,
                organizationId: input.organizationId,
                reason: "manual",
                recipient: contact.email,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                set: {
                  createdAt: now,
                  reason: "manual",
                  revokedAt: null,
                  sourceProviderMessageId: null,
                  updatedAt: now,
                },
                target: [
                  organizationMailRecipientSuppression.organizationId,
                  organizationMailRecipientSuppression.recipient,
                ],
              });
          } else {
            await transaction
              .update(organizationMailRecipientSuppression)
              .set({ revokedAt: now, updatedAt: now })
              .where(
                and(
                  eq(
                    organizationMailRecipientSuppression.organizationId,
                    input.organizationId
                  ),
                  eq(
                    organizationMailRecipientSuppression.recipient,
                    contact.email
                  ),
                  eq(organizationMailRecipientSuppression.reason, "manual")
                )
              );
          }
          await transaction.insert(organizationMailSuppressionAudit).values({
            action: input.suppressed ? "suppressed" : "unsuppressed",
            actorUserId: actor.userId ?? null,
            createdAt: now,
            id: randomUUID(),
            organizationId: input.organizationId,
            reason: "manual",
            recipient: contact.email,
          });
        }
        await appendLifecycleEvent(transaction, {
          actor,
          afterStatus: membership.status,
          applied: changed,
          beforeStatus: membership.status,
          channel: actor.userId === undefined ? "api" : "manual",
          eventType: input.suppressed
            ? "safety_suppressed"
            : "safety_unsuppressed",
          membership,
          occurredAt: now,
          reason: input.reason,
          source: "safety_management",
        });
        return await getContact(transaction, input);
      }
    );
  });
};

// This entry point is called only after validating a recipient capability.
export const unsubscribeAudienceMembership = async (input: {
  organizationId: string;
  audienceId: string;
  membershipId: string;
  source: "campaign";
  idempotencyKey?: string;
}) =>
  await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    const membership = await requireMembership(transaction, input);
    if (membership.status === "unsubscribed") {
      return await getContact(transaction, input);
    }
    return await changeSubscription(
      transaction,
      null,
      { ...input, channel: "campaign", occurredAt: new Date() },
      "unsubscribed"
    );
  });
