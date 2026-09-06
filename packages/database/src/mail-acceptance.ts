import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { canonicalMailJson } from "./mail-ledger-json.ts";
import {
  mailSubmission,
  mailSubmissionOutbox,
  mailUsageReservation,
} from "./schema.ts";
import type { MailSubmissionPayload } from "./schema.ts";

type LedgerTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
export type MailAcceptanceBudget = Pick<
  typeof mailUsageReservation.$inferInsert,
  | "billableCostMicroCents"
  | "creditAmountMicroCents"
  | "includedCostMicroCents"
  | "sesCostMicroCents"
  | "periodStart"
  | "periodEnd"
>;

export class MailIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with a different message.");
    this.name = "MailIdempotencyConflictError";
  }
}

export const acceptMailSubmission = async (
  database: DatabaseClient,
  input: {
    organizationId: string;
    mailboxId: string | null;
    idempotencyKey: string;
    requestHash: string;
    payload: MailSubmissionPayload;
    messageBytes: number;
    attachmentBytes: number;
    recipientCount: number;
    assertAuthorization: (transaction: LedgerTransaction) => Promise<void>;
    reserveBudget: (
      transaction: LedgerTransaction
    ) => Promise<MailAcceptanceBudget>;
  }
) => {
  if (
    !/^[\u0021-\u007E]{1,128}$/u.test(input.idempotencyKey) ||
    !/^[a-f\d]{64}$/u.test(input.requestHash)
  ) {
    throw new Error("Invalid submission idempotency metadata.");
  }
  const payload = canonicalMailJson(input.payload);
  if (Buffer.byteLength(payload) > 25 * 1024 * 1024) {
    throw new Error("Submission payload exceeds the acceptance limit.");
  }
  const payloadDigest = createHash("sha256").update(payload).digest("hex");
  return await database.transaction(async (transaction) => {
    // Share the legacy mail budget lock until all senders use reservations.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.organizationId}, 0))`
    );
    await input.assertAuthorization(transaction);
    const [existing] = await transaction
      .select()
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.organizationId, input.organizationId),
          eq(mailSubmission.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    if (existing !== undefined) {
      if (
        existing.requestHash !== input.requestHash ||
        existing.mailboxId !== input.mailboxId
      ) {
        throw new MailIdempotencyConflictError();
      }
      return { replayed: true, result: existing.acceptedResult };
    }
    // Callers must check authorization and budget through this transaction, without external I/O.
    const budget = await input.reserveBudget(transaction);
    const id = randomUUID();
    const result = { messageId: id, status: "queued" } as const;
    await transaction.insert(mailSubmission).values({
      acceptedAt: sql`now()`,
      acceptedResult: result,
      attachmentBytes: input.attachmentBytes,
      id,
      idempotencyKey: input.idempotencyKey,
      idempotencyRetainUntil: sql`now() + interval '7 days'`,
      mailboxId: input.mailboxId,
      messageBytes: input.messageBytes,
      nextActionAt: sql`now() + interval '5 minutes'`,
      organizationId: input.organizationId,
      payload: input.payload,
      payloadDigest,
      recipientCount: input.recipientCount,
      requestHash: input.requestHash,
      sendAfter: sql`now()`,
      updatedAt: sql`now()`,
    });
    await transaction.insert(mailUsageReservation).values({
      ...budget,
      attachmentBytes: input.attachmentBytes,
      createdAt: sql`now()`,
      organizationId: input.organizationId,
      recipientCount: input.recipientCount,
      submissionId: id,
    });
    await transaction.insert(mailSubmissionOutbox).values({
      createdAt: sql`now()`,
      dueAt: sql`now()`,
      eventType: "submission.dispatch",
      id: randomUUID(),
      organizationId: input.organizationId,
      submissionId: id,
    });
    return { replayed: false, result };
  });
};
