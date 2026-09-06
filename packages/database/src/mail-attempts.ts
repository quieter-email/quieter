import { randomUUID } from "node:crypto";

import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import {
  billingCreditUsageEvent,
  mailSendAttempt,
  mailSubmission,
  mailSubmissionOutbox,
  mailUsageReservation,
  organizationMailUsageEvent,
} from "./schema.ts";

type LedgerTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
type Submission = typeof mailSubmission.$inferSelect;
type Attempt = typeof mailSendAttempt.$inferSelect;
export type MailSendOutcome =
  | { outcome: "accepted"; providerMessageId: string }
  | { outcome: "rejected"; code: string; retryAt?: Date }
  | { outcome: "unknown"; code: string };

export const beginMailSendAttempt = async (
  database: DatabaseClient,
  input: {
    organizationId: string;
    submissionId: string;
    owner: string;
    region: string;
    assertPolicy: (
      transaction: LedgerTransaction,
      submission: Submission
    ) => Promise<void>;
  }
): Promise<Attempt | null> => {
  if (
    !/^[\w-]{1,128}$/u.test(input.owner) ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/u.test(input.region)
  ) {
    throw new Error("Invalid sender claim.");
  }
  return await database.transaction(async (transaction) => {
    const [submission] = await transaction
      .select()
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.id, input.submissionId),
          eq(mailSubmission.organizationId, input.organizationId)
        )
      )
      .for("update");
    if (submission === undefined || submission.status !== "queued") {
      return null;
    }
    const [reservation] = await transaction
      .select()
      .from(mailUsageReservation)
      .where(eq(mailUsageReservation.submissionId, submission.id))
      .for("update");
    if (reservation === undefined || reservation.status !== "reserved") {
      throw new Error("Queued submission has no active usage reservation.");
    }
    // The policy callback performs authoritative database checks using this transaction only.
    await input.assertPolicy(transaction, submission);
    const [claimed] = await transaction
      .update(mailSubmission)
      .set({
        dispatchGeneration: sql`${mailSubmission.dispatchGeneration} + 1`,
        nextActionAt: sql`now() + interval '1 minute'`,
        status: "dispatching",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(mailSubmission.id, submission.id),
          lte(mailSubmission.sendAfter, sql`now()`)
        )
      )
      .returning();
    if (claimed === undefined) {
      return null;
    }
    const [attempt] = await transaction
      .insert(mailSendAttempt)
      .values({
        attemptNumber: claimed.dispatchGeneration,
        deadline: sql`now() + interval '1 minute'`,
        dispatchGeneration: claimed.dispatchGeneration,
        id: randomUUID(),
        intentAt: sql`now()`,
        organizationId: input.organizationId,
        owner: input.owner,
        region: input.region,
        submissionId: input.submissionId,
        updatedAt: sql`now()`,
      })
      .returning();
    return attempt;
  });
};

export const recordMailSendOutcome = async (
  database: DatabaseClient,
  identity: Pick<
    Attempt,
    "id" | "submissionId" | "organizationId" | "dispatchGeneration"
  >,
  outcome: MailSendOutcome
) => {
  if (
    outcome.outcome === "accepted"
      ? !/^[\w-]{1,256}$/u.test(outcome.providerMessageId)
      : !/^[a-z_]{1,64}$/u.test(outcome.code)
  ) {
    throw new Error("Invalid provider outcome metadata.");
  }
  if (
    outcome.outcome === "rejected" &&
    outcome.retryAt !== undefined &&
    !Number.isFinite(outcome.retryAt.getTime())
  ) {
    throw new Error("Invalid safe retry time.");
  }
  return await database.transaction(async (transaction) => {
    const [submission] = await transaction
      .select()
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.id, identity.submissionId),
          eq(mailSubmission.organizationId, identity.organizationId)
        )
      )
      .for("update");
    const [attempt] = await transaction
      .select()
      .from(mailSendAttempt)
      .where(
        and(
          eq(mailSendAttempt.id, identity.id),
          eq(mailSendAttempt.submissionId, identity.submissionId),
          eq(mailSendAttempt.organizationId, identity.organizationId),
          eq(mailSendAttempt.dispatchGeneration, identity.dispatchGeneration)
        )
      )
      .for("update");
    if (submission === undefined || attempt === undefined) {
      throw new Error("Provider outcome has no matching durable attempt.");
    }
    if (attempt.outcome === "accepted" || attempt.outcome === "rejected") {
      if (
        attempt.outcome !== outcome.outcome ||
        (outcome.outcome === "accepted" &&
          attempt.providerMessageId !== outcome.providerMessageId)
      ) {
        throw new Error("Provider outcome conflicts with a completed attempt.");
      }
      return "duplicate";
    }
    if (
      submission.dispatchGeneration !== identity.dispatchGeneration ||
      !["dispatching", "pending_confirmation"].includes(submission.status)
    ) {
      throw new Error(
        "Provider outcome was fenced by another submission state."
      );
    }
    const [reservation] = await transaction
      .select()
      .from(mailUsageReservation)
      .where(eq(mailUsageReservation.submissionId, submission.id))
      .for("update");
    if (reservation === undefined || reservation.status !== "reserved") {
      throw new Error("Unresolved send has no active usage reservation.");
    }
    const retryAt =
      outcome.outcome === "rejected" ? outcome.retryAt : undefined;
    await transaction
      .update(mailSendAttempt)
      .set({
        completedAt: outcome.outcome === "unknown" ? null : sql`now()`,
        failureCode: outcome.outcome === "accepted" ? null : outcome.code,
        outcome: outcome.outcome,
        providerMessageId:
          outcome.outcome === "accepted" ? outcome.providerMessageId : null,
        updatedAt: sql`now()`,
      })
      .where(eq(mailSendAttempt.id, attempt.id));
    let status: Submission["status"] = "pending_confirmation";
    if (outcome.outcome === "accepted") {
      status = "accepted";
    } else if (outcome.outcome === "rejected") {
      status = retryAt === undefined ? "failed" : "queued";
    }
    await transaction
      .update(mailSubmission)
      .set({
        completedAt: ["accepted", "failed"].includes(status)
          ? sql`now()`
          : null,
        failureCode: outcome.outcome === "accepted" ? null : outcome.code,
        nextActionAt: retryAt ?? sql`now() + interval '5 minutes'`,
        sendAfter: retryAt ?? submission.sendAfter,
        status,
        updatedAt: sql`now()`,
      })
      .where(eq(mailSubmission.id, submission.id));
    if (outcome.outcome !== "unknown" && retryAt === undefined) {
      await transaction
        .update(mailUsageReservation)
        .set({
          settledAt: sql`now()`,
          status: outcome.outcome === "accepted" ? "finalized" : "released",
        })
        .where(eq(mailUsageReservation.submissionId, submission.id));
    }
    if (outcome.outcome === "accepted") {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`organization:${submission.organizationId}`}, 0))`
      );
      const [usage] = await transaction
        .select({
          cost: sql`coalesce(sum(${billingCreditUsageEvent.costMicroCents}), 0)`.mapWith(
            Number
          ),
        })
        .from(billingCreditUsageEvent)
        .where(
          and(
            eq(
              billingCreditUsageEvent.organizationId,
              submission.organizationId
            ),
            gte(billingCreditUsageEvent.createdAt, reservation.periodStart),
            lt(billingCreditUsageEvent.createdAt, reservation.periodEnd)
          )
        );
      const used = usage?.cost ?? 0;
      const cost =
        reservation.billableCostMicroCents + reservation.includedCostMicroCents;
      const billable =
        Math.max(0, used + cost - reservation.creditAmountMicroCents) -
        Math.max(0, used - reservation.creditAmountMicroCents);
      if (
        ![
          used,
          cost,
          used + cost,
          billable,
          reservation.creditAmountMicroCents,
        ].every((value) => Number.isSafeInteger(value) && value >= 0)
      ) {
        throw new Error(
          "Confirmed mail usage exceeds the safe accounting range."
        );
      }
      await transaction.insert(billingCreditUsageEvent).values({
        billableCostMicroCents: billable,
        category: "mail",
        costMicroCents: cost,
        createdAt: submission.acceptedAt,
        dedupeKey: `mail:submission:${submission.id}`,
        id: randomUUID(),
        metadata: { direction: "outbound", submissionId: submission.id },
        organizationId: submission.organizationId,
        scope: "team",
      });
      await transaction.insert(organizationMailUsageEvent).values({
        attachmentSizeBytes: submission.attachmentBytes,
        billableCostMicroCents: billable,
        createdAt: submission.acceptedAt,
        dedupeKey: `outbound:submission:${submission.id}`,
        direction: "outbound",
        id: randomUUID(),
        includedSesCostMicroCents: cost - billable,
        incomingChunkCount: 0,
        messageCount: submission.recipientCount,
        messageSizeBytes: submission.messageBytes,
        metadata: { submissionId: submission.id },
        organizationId: submission.organizationId,
        provider: "ses",
        providerMessageId: outcome.providerMessageId,
        recipientCount: submission.recipientCount,
        sesCostMicroCents: reservation.sesCostMicroCents,
      });
      await transaction
        .update(mailUsageReservation)
        .set({
          billableCostMicroCents: billable,
          includedCostMicroCents: cost - billable,
        })
        .where(eq(mailUsageReservation.submissionId, submission.id));
      await transaction
        .insert(mailSubmissionOutbox)
        .values({
          createdAt: sql`now()`,
          dueAt: sql`now()`,
          eventType: "submission.accepted",
          id: randomUUID(),
          organizationId: submission.organizationId,
          submissionId: submission.id,
        })
        .onConflictDoNothing();
    } else if (retryAt !== undefined) {
      await transaction
        .update(mailSubmissionOutbox)
        .set({
          claimGeneration: sql`${mailSubmissionOutbox.claimGeneration} + 1`,
          claimOwner: null,
          dueAt: retryAt,
          leaseUntil: null,
          publicationReceipt: null,
          publishedAt: null,
        })
        .where(
          and(
            eq(mailSubmissionOutbox.submissionId, submission.id),
            eq(mailSubmissionOutbox.eventType, "submission.dispatch"),
            eq(mailSubmissionOutbox.schemaVersion, 1)
          )
        );
    }
    return "recorded";
  });
};

export const recoverUnknownMailAttempts = async (
  database: DatabaseClient,
  limit = 100
) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid bounded attempt recovery batch.");
  }
  return await database.transaction(async (transaction) => {
    const due = await transaction
      .select({ id: mailSubmission.id })
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.status, "dispatching"),
          lte(mailSubmission.nextActionAt, sql`now()`)
        )
      )
      .orderBy(mailSubmission.nextActionAt, mailSubmission.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) {
      return 0;
    }
    const attempts = await transaction
      .update(mailSendAttempt)
      .set({
        failureCode: "sender_deadline_expired",
        outcome: "unknown",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(
            mailSendAttempt.submissionId,
            due.map((row) => row.id)
          ),
          eq(mailSendAttempt.outcome, "intent"),
          lte(mailSendAttempt.deadline, sql`now()`)
        )
      )
      .returning({ submissionId: mailSendAttempt.submissionId });
    if (attempts.length > 0) {
      await transaction
        .update(mailSubmission)
        .set({
          failureCode: "sender_deadline_expired",
          nextActionAt: sql`now() + interval '5 minutes'`,
          status: "pending_confirmation",
          updatedAt: sql`now()`,
        })
        .where(
          inArray(
            mailSubmission.id,
            attempts.map((attempt) => attempt.submissionId)
          )
        );
    }
    return attempts.length;
  });
};
