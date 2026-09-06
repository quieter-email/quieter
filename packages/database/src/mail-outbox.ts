import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { mailSubmission, mailSubmissionOutbox } from "./schema.ts";

export type MailOutboxEvent = Pick<
  typeof mailSubmissionOutbox.$inferSelect,
  "id" | "eventType" | "schemaVersion" | "submissionId" | "organizationId"
>;
export type ClaimedMailOutboxEvent = typeof mailSubmissionOutbox.$inferSelect;

export const claimMailOutbox = async (
  database: DatabaseClient,
  input: { owner: string; limit: number; leaseSeconds: number }
): Promise<ClaimedMailOutboxEvent[]> => {
  if (
    !/^[\w-]{1,128}$/u.test(input.owner) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    !Number.isInteger(input.leaseSeconds) ||
    input.leaseSeconds < 30 ||
    input.leaseSeconds > 300
  ) {
    throw new Error("Invalid bounded outbox claim.");
  }
  return await database.transaction(async (transaction) => {
    const due = await transaction
      .select({ id: mailSubmissionOutbox.id })
      .from(mailSubmissionOutbox)
      .where(
        and(
          isNull(mailSubmissionOutbox.publishedAt),
          lte(mailSubmissionOutbox.dueAt, sql`now()`),
          or(
            isNull(mailSubmissionOutbox.leaseUntil),
            lte(mailSubmissionOutbox.leaseUntil, sql`now()`)
          )
        )
      )
      .orderBy(mailSubmissionOutbox.dueAt, mailSubmissionOutbox.id)
      .limit(input.limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) {
      return [];
    }
    return await transaction
      .update(mailSubmissionOutbox)
      .set({
        attemptCount: sql`${mailSubmissionOutbox.attemptCount} + 1`,
        claimGeneration: sql`${mailSubmissionOutbox.claimGeneration} + 1`,
        claimOwner: input.owner,
        dueAt: sql`now() + ${input.leaseSeconds} * interval '1 second'`,
        leaseUntil: sql`now() + ${input.leaseSeconds} * interval '1 second'`,
      })
      .where(
        inArray(
          mailSubmissionOutbox.id,
          due.map((row) => row.id)
        )
      )
      .returning();
  });
};

export const completeMailOutbox = async (
  database: DatabaseClient,
  claim: ClaimedMailOutboxEvent,
  receipt: string
) => {
  if (receipt.length === 0 || receipt.length > 512) {
    throw new Error("Invalid queue publication receipt.");
  }
  const updated = await database
    .update(mailSubmissionOutbox)
    .set({
      claimOwner: null,
      lastErrorCode: null,
      leaseUntil: null,
      publicationReceipt: receipt,
      publishedAt: sql`now()`,
    })
    .where(
      and(
        eq(mailSubmissionOutbox.id, claim.id),
        eq(mailSubmissionOutbox.claimGeneration, claim.claimGeneration),
        eq(mailSubmissionOutbox.claimOwner, claim.claimOwner ?? ""),
        isNull(mailSubmissionOutbox.publishedAt)
      )
    )
    .returning({ id: mailSubmissionOutbox.id });
  return updated.length === 1;
};

export const deferMailOutbox = async (
  database: DatabaseClient,
  claim: ClaimedMailOutboxEvent,
  jitter: number = Math.random()
) => {
  if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1) {
    throw new Error("Invalid outbox retry jitter.");
  }
  const seconds =
    Math.min(300, 2 ** Math.min(claim.attemptCount, 8)) * (0.5 + jitter / 2);
  const updated = await database
    .update(mailSubmissionOutbox)
    .set({
      claimOwner: null,
      dueAt: sql`now() + ${seconds} * interval '1 second'`,
      lastErrorCode: "publication_failed",
      leaseUntil: null,
    })
    .where(
      and(
        eq(mailSubmissionOutbox.id, claim.id),
        eq(mailSubmissionOutbox.claimGeneration, claim.claimGeneration),
        eq(mailSubmissionOutbox.claimOwner, claim.claimOwner ?? ""),
        isNull(mailSubmissionOutbox.publishedAt)
      )
    )
    .returning({ id: mailSubmissionOutbox.id });
  return updated.length === 1;
};

export const dispatchMailOutbox = async (
  database: DatabaseClient,
  input: {
    owner: string;
    limit: number;
    publish: (event: MailOutboxEvent) => Promise<string>;
  }
) => {
  // Five concurrent calls fit inside the lease when the queue adapter enforces a ten-second deadline.
  const claims = await claimMailOutbox(database, {
    leaseSeconds: 120,
    limit: Math.min(input.limit, 5),
    owner: input.owner,
  });
  const outcomes = await Promise.all(
    claims.map(async (claim) => {
      try {
        const receipt = await input.publish({
          eventType: claim.eventType,
          id: claim.id,
          organizationId: claim.organizationId,
          schemaVersion: claim.schemaVersion,
          submissionId: claim.submissionId,
        });
        return (await completeMailOutbox(database, claim, receipt))
          ? "published"
          : "superseded";
      } catch {
        // Publication can have succeeded. Retrying keeps the same event identity.
        await deferMailOutbox(database, claim);
        return "deferred";
      }
    })
  );
  return {
    claimed: claims.length,
    deferred: outcomes.filter((outcome) => outcome === "deferred").length,
    published: outcomes.filter((outcome) => outcome === "published").length,
  };
};

export const recoverQueuedMailOutbox = async (
  database: DatabaseClient,
  limit = 100
) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid bounded mail recovery batch.");
  }
  return await database.transaction(async (transaction) => {
    const due = await transaction
      .select({ id: mailSubmission.id })
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.status, "queued"),
          lte(mailSubmission.nextActionAt, sql`now()`)
        )
      )
      .orderBy(mailSubmission.nextActionAt, mailSubmission.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) {
      return 0;
    }
    const ids = due.map((row) => row.id);
    const reset = await transaction
      .update(mailSubmissionOutbox)
      .set({
        claimGeneration: sql`${mailSubmissionOutbox.claimGeneration} + 1`,
        claimOwner: null,
        dueAt: sql`now()`,
        leaseUntil: null,
        publicationReceipt: null,
        publishedAt: null,
      })
      .where(
        and(
          inArray(mailSubmissionOutbox.submissionId, ids),
          eq(mailSubmissionOutbox.eventType, "submission.dispatch"),
          eq(mailSubmissionOutbox.schemaVersion, 1),
          or(
            isNull(mailSubmissionOutbox.leaseUntil),
            lte(mailSubmissionOutbox.leaseUntil, sql`now()`)
          )
        )
      )
      .returning({ submissionId: mailSubmissionOutbox.submissionId });
    if (reset.length > 0) {
      await transaction
        .update(mailSubmission)
        .set({
          nextActionAt: sql`now() + interval '5 minutes'`,
          updatedAt: sql`now()`,
        })
        .where(
          inArray(
            mailSubmission.id,
            reset.map((row) => row.submissionId)
          )
        );
    }
    return reset.length;
  });
};
