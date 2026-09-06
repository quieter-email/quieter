import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { canonicalMailJson } from "./mail-ledger-json.ts";
import { mailFeedbackInbox } from "./schema.ts";

export type MailFeedbackClaim = Pick<
  typeof mailFeedbackInbox.$inferSelect,
  "id" | "claimGeneration" | "claimOwner"
>;

export const claimMailFeedback = async (
  database: DatabaseClient,
  input: { owner: string; source: string; region: string; limit: number }
): Promise<MailFeedbackClaim[]> => {
  if (
    !/^[\w-]{1,128}$/u.test(input.owner) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 5
  ) {
    throw new Error("Invalid bounded feedback claim.");
  }
  return await database.transaction(async (transaction) => {
    const due = await transaction
      .select({ id: mailFeedbackInbox.id })
      .from(mailFeedbackInbox)
      .where(
        and(
          eq(mailFeedbackInbox.status, "pending"),
          eq(mailFeedbackInbox.source, input.source),
          eq(mailFeedbackInbox.region, input.region),
          lte(mailFeedbackInbox.dueAt, sql`now()`),
          or(
            isNull(mailFeedbackInbox.leaseUntil),
            lte(mailFeedbackInbox.leaseUntil, sql`now()`)
          )
        )
      )
      .orderBy(mailFeedbackInbox.dueAt, mailFeedbackInbox.id)
      .limit(input.limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) {
      return [];
    }
    return await transaction
      .update(mailFeedbackInbox)
      .set({
        attemptCount: sql`${mailFeedbackInbox.attemptCount} + 1`,
        claimGeneration: sql`${mailFeedbackInbox.claimGeneration} + 1`,
        claimOwner: input.owner,
        dueAt: sql`now() + interval '2 minutes'`,
        leaseUntil: sql`now() + interval '2 minutes'`,
      })
      .where(
        inArray(
          mailFeedbackInbox.id,
          due.map((row) => row.id)
        )
      )
      .returning({
        claimGeneration: mailFeedbackInbox.claimGeneration,
        claimOwner: mailFeedbackInbox.claimOwner,
        id: mailFeedbackInbox.id,
      });
  });
};

export const deferMailFeedback = async (
  database: DatabaseClient,
  claim: MailFeedbackClaim
) => {
  const updated = await database
    .update(mailFeedbackInbox)
    .set({
      claimOwner: null,
      dueAt: sql`now() + interval '1 minute'`,
      lastErrorCode: "feedback_processing_failed",
      leaseUntil: null,
    })
    .where(
      and(
        eq(mailFeedbackInbox.id, claim.id),
        eq(mailFeedbackInbox.status, "pending"),
        eq(mailFeedbackInbox.claimGeneration, claim.claimGeneration),
        eq(mailFeedbackInbox.claimOwner, claim.claimOwner ?? "")
      )
    )
    .returning({ id: mailFeedbackInbox.id });
  return updated.length === 1;
};

export const retainMailFeedback = async (
  database: DatabaseClient,
  input: {
    source: string;
    region: string;
    providerEventId: string;
    providerMessageId: string | null;
    schemaVersion: number;
    payload: Record<string, unknown>;
  }
) => {
  if (
    input.source.length === 0 ||
    input.source.length > 512 ||
    !/^[\w-]{1,128}$/u.test(input.providerEventId) ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/u.test(input.region) ||
    !Number.isInteger(input.schemaVersion) ||
    input.schemaVersion < 1
  ) {
    throw new Error("Invalid authenticated feedback identity.");
  }
  const payload = canonicalMailJson(input.payload);
  if (Buffer.byteLength(payload) > 128 * 1024) {
    throw new Error("Feedback exceeds the bounded inbox size.");
  }
  const digest = createHash("sha256").update(payload).digest("hex");
  return await database.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(mailFeedbackInbox)
      .values({
        ...input,
        dueAt: sql`now()`,
        id: randomUUID(),
        payloadDigest: digest,
        receivedAt: sql`now()`,
      })
      .onConflictDoNothing({
        target: [
          mailFeedbackInbox.source,
          mailFeedbackInbox.region,
          mailFeedbackInbox.providerEventId,
        ],
      })
      .returning({ id: mailFeedbackInbox.id });
    if (created !== undefined) {
      return { id: created.id, replayed: false };
    }
    const [existing] = await transaction
      .select()
      .from(mailFeedbackInbox)
      .where(
        and(
          eq(mailFeedbackInbox.source, input.source),
          eq(mailFeedbackInbox.region, input.region),
          eq(mailFeedbackInbox.providerEventId, input.providerEventId)
        )
      )
      .limit(1);
    if (
      existing === undefined ||
      existing.payloadDigest !== digest ||
      existing.schemaVersion !== input.schemaVersion ||
      (input.providerMessageId !== null &&
        existing.providerMessageId !== input.providerMessageId)
    ) {
      throw new Error("Feedback identity conflicts with retained content.");
    }
    return { id: existing.id, replayed: true };
  });
};
