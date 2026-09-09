import type { DatabaseClient } from "@quieter/database/client";
import { mailSyncSubmission } from "@quieter/database/schema";
import type { SyncMessage } from "@quieter/sync";
import { and, eq, inArray } from "drizzle-orm";

import type { SyncTransaction } from "./repository";
import { SyncSubmissionConflictError } from "./submission-conflict";
import { SyncSubmissionUncertainError } from "./submission-uncertain";

export { SyncSubmissionConflictError } from "./submission-conflict";
export { SyncSubmissionUncertainError } from "./submission-uncertain";

export type SyncSubmissionResult = NonNullable<
  typeof mailSyncSubmission.$inferSelect.result
>;
export type SyncSubmissionIdentity = Pick<
  typeof mailSyncSubmission.$inferInsert,
  | "mailboxId"
  | "userId"
  | "kind"
  | "operationId"
  | "payloadHash"
  | "recoveryKey"
>;

export const confirmProjectedSubmissions = async (
  context: SyncTransaction,
  messages: SyncMessage[]
) => {
  const receipts = new Map<
    string,
    { kind: "draft" | "send"; result: SyncSubmissionResult }
  >();
  for (const message of messages) {
    const key = /^<quieter-(?<key>[a-f0-9]{64})@sync\.quieter\.email>$/u.exec(
      message.messageHeaderId ?? ""
    )?.groups?.key;
    if (key === undefined) {
      continue;
    }
    if (message.draftId) {
      receipts.set(key, {
        kind: "draft",
        result: {
          id: message.draftId,
          messageId: message.id,
          threadId: message.threadId,
        },
      });
    } else if (message.labelIds.includes("SENT")) {
      receipts.set(key, {
        kind: "send",
        result: { id: message.id, threadId: message.threadId },
      });
    }
  }
  if (receipts.size === 0) {
    return;
  }
  const pending = await context.database
    .select()
    .from(mailSyncSubmission)
    .where(
      and(
        eq(mailSyncSubmission.mailboxId, context.mailboxId),
        eq(mailSyncSubmission.status, "unknown"),
        inArray(mailSyncSubmission.recoveryKey, [...receipts.keys()])
      )
    );
  for (const submission of pending) {
    const receipt = receipts.get(submission.recoveryKey);
    if (receipt?.kind === submission.kind) {
      await context.database
        .update(mailSyncSubmission)
        .set({
          result: receipt.result,
          status: "accepted",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailSyncSubmission.mailboxId, context.mailboxId),
            eq(mailSyncSubmission.operationId, submission.operationId),
            eq(mailSyncSubmission.status, "unknown")
          )
        );
    }
  }
};

export class SyncSubmissions {
  private readonly database: DatabaseClient;
  private readonly reportError: (error: unknown) => void;

  constructor(database: DatabaseClient, reportError: (error: unknown) => void) {
    this.database = database;
    this.reportError = reportError;
  }

  async run(
    input: SyncSubmissionIdentity,
    provider: {
      execute: () => Promise<SyncSubmissionResult>;
      reconcile: () => Promise<SyncSubmissionResult | null>;
      isRejected: (error: unknown) => boolean;
    }
  ): Promise<SyncSubmissionResult> {
    const claim = await this.database.transaction(async (database) => {
      const [inserted] = await database
        .insert(mailSyncSubmission)
        .values({ ...input, nextAttemptAt: new Date(Date.now() + 60_000) })
        .onConflictDoNothing()
        .returning();
      if (inserted !== undefined) {
        return { execute: true, result: null };
      }
      const [existing] = await database
        .select()
        .from(mailSyncSubmission)
        .where(
          and(
            eq(mailSyncSubmission.mailboxId, input.mailboxId),
            eq(mailSyncSubmission.operationId, input.operationId)
          )
        )
        .for("update");
      if (
        existing === undefined ||
        existing.userId !== input.userId ||
        existing.kind !== input.kind ||
        (existing.status !== "rejected" &&
          existing.payloadHash !== input.payloadHash)
      ) {
        throw new SyncSubmissionConflictError();
      }
      if (existing.status === "rejected") {
        await database
          .update(mailSyncSubmission)
          .set({
            ...input,
            nextAttemptAt: new Date(Date.now() + 60_000),
            status: "unknown",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mailSyncSubmission.mailboxId, input.mailboxId),
              eq(mailSyncSubmission.operationId, input.operationId)
            )
          );
        return { execute: true, result: null };
      }
      return { execute: false, result: existing.result };
    });
    if (claim.result !== null) {
      return claim.result;
    }
    let result: SyncSubmissionResult;
    if (claim.execute) {
      try {
        result = await provider.execute();
      } catch (error) {
        if (provider.isRejected(error)) {
          await this.database
            .update(mailSyncSubmission)
            .set({ status: "rejected", updatedAt: new Date() })
            .where(
              and(
                eq(mailSyncSubmission.mailboxId, input.mailboxId),
                eq(mailSyncSubmission.operationId, input.operationId),
                eq(mailSyncSubmission.status, "unknown")
              )
            );
          throw error;
        }
        this.reportError(error);
        throw new SyncSubmissionUncertainError();
      }
    } else {
      const recovered = await provider.reconcile();
      if (recovered === null) {
        throw new SyncSubmissionUncertainError();
      }
      result = recovered;
    }
    try {
      await this.confirm(input.mailboxId, input.operationId, result);
    } catch (error) {
      // The external effect is already confirmed; losing its receipt must not repeat it.
      this.reportError(error);
    }
    return result;
  }

  async confirm(
    mailboxId: string,
    operationId: string,
    result: SyncSubmissionResult
  ) {
    await this.database
      .update(mailSyncSubmission)
      .set({ result, status: "accepted", updatedAt: new Date() })
      .where(
        and(
          eq(mailSyncSubmission.mailboxId, mailboxId),
          eq(mailSyncSubmission.operationId, operationId),
          eq(mailSyncSubmission.status, "unknown")
        )
      );
  }
}
