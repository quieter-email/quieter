import { and, eq, isNull } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { MailIdempotencyConflictError } from "./mail-acceptance.ts";
import { mailSubmission } from "./schema.ts";

type SubmissionReadScope = {
  organizationId: string;
  mailboxId: string | null;
  assertAuthorization: (
    transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]
  ) => Promise<void>;
};

export const findMailSubmissionReplay = async (
  database: DatabaseClient,
  input: SubmissionReadScope & { idempotencyKey: string; requestHash: string }
) =>
  await database.transaction(async (transaction) => {
    await input.assertAuthorization(transaction);
    const [existing] = await transaction
      .select({
        acceptedResult: mailSubmission.acceptedResult,
        mailboxId: mailSubmission.mailboxId,
        requestHash: mailSubmission.requestHash,
      })
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.organizationId, input.organizationId),
          eq(mailSubmission.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    if (existing === undefined) {
      return null;
    }
    if (
      existing.mailboxId !== input.mailboxId ||
      existing.requestHash !== input.requestHash
    ) {
      throw new MailIdempotencyConflictError();
    }
    return existing.acceptedResult;
  });

export const readMailSubmissionStatus = async (
  database: DatabaseClient,
  input: SubmissionReadScope & { messageId: string }
) =>
  await database.transaction(async (transaction) => {
    await input.assertAuthorization(transaction);
    const [submission] = await transaction
      .select({
        acceptedAt: mailSubmission.acceptedAt,
        completedAt: mailSubmission.completedAt,
        messageId: mailSubmission.id,
        status: mailSubmission.status,
        updatedAt: mailSubmission.updatedAt,
      })
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.id, input.messageId),
          eq(mailSubmission.organizationId, input.organizationId),
          input.mailboxId === null
            ? isNull(mailSubmission.mailboxId)
            : eq(mailSubmission.mailboxId, input.mailboxId)
        )
      )
      .limit(1);
    return submission ?? null;
  });
