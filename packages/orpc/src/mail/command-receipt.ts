import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailCommandReceipt } from "@quieter/database/schema";
import { isGmailServiceError } from "@quieter/gmail";
import type { MailMutationResult } from "@quieter/mail/data-plane";
import { reportError } from "@quieter/observability";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { MailInputs } from "./inputs";

const COMMAND_PENDING_MS = 60_000;

export const isRejectedGmailWrite = (error: unknown): boolean =>
  isGmailServiceError(error) &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.status !== 499;

export const executeMailCommandWithReceipt = async ({
  actorUserId,
  execute,
  input,
  requestId,
  wake,
}: {
  actorUserId: string;
  execute: (markDispatched: () => void) => Promise<MailMutationResult>;
  input: MailInputs["applyChanges"];
  requestId: string;
  wake?: () => Promise<void>;
}): Promise<MailMutationResult> => {
  const { command, mailboxId, targets } = input;
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ actorUserId, command, mailboxId, targets }))
    .digest("hex");
  const identity = and(
    eq(mailCommandReceipt.actorUserId, actorUserId),
    eq(mailCommandReceipt.mailboxId, mailboxId),
    eq(mailCommandReceipt.requestId, requestId)
  );
  const [claim] = await db
    .insert(mailCommandReceipt)
    .values({
      actorUserId,
      claimedAt: sql`now()`,
      createdAt: sql`now()`,
      mailboxId,
      requestHash,
      requestId,
    })
    .onConflictDoUpdate({
      set: { claimedAt: sql`now()` },
      setWhere: and(
        eq(mailCommandReceipt.requestHash, requestHash),
        isNull(mailCommandReceipt.claimedAt),
        isNull(mailCommandReceipt.result)
      ),
      target: [
        mailCommandReceipt.actorUserId,
        mailCommandReceipt.mailboxId,
        mailCommandReceipt.requestId,
      ],
    })
    .returning({ requestId: mailCommandReceipt.requestId });

  if (claim === undefined) {
    const [existing] = await db
      .select()
      .from(mailCommandReceipt)
      .where(identity);
    if (existing === undefined) {
      throw new ORPCError("NOT_FOUND", {
        message: "This mailbox is no longer available.",
      });
    }
    if (existing.requestHash !== requestHash) {
      throw new ORPCError("CONFLICT", {
        message:
          "This action identity was already used for a different request.",
      });
    }
    return (
      existing.result ?? {
        receipt: {
          requestId,
          status:
            existing.claimedAt === null ||
            Date.now() - existing.claimedAt.getTime() < COMMAND_PENDING_MS
              ? "pending"
              : "uncertain",
        },
        targets: [],
      }
    );
  }

  const unfinished = and(identity, isNull(mailCommandReceipt.result));
  let dispatched = false;
  let result: MailMutationResult;
  try {
    const outcome = await execute(() => {
      dispatched = true;
    });
    const uncertain = outcome.targets.some(
      (target) =>
        (target.uncertainMessageIds?.length ?? 0) > 0 ||
        target.code === "placement_uncertain" ||
        target.code === "placement_pending" ||
        target.code === "placement_submitting"
    );
    result = {
      ...outcome,
      receipt: { requestId, status: uncertain ? "uncertain" : "completed" },
    };
  } catch (error) {
    if (!dispatched) {
      await db
        .update(mailCommandReceipt)
        .set({ claimedAt: null })
        .where(unfinished);
      throw error;
    }
    reportError(error, { operation: "mail-command" });
    result = { receipt: { requestId, status: "uncertain" }, targets: [] };
  }

  const [completed] = await db
    .update(mailCommandReceipt)
    .set({ result })
    .where(unfinished)
    .returning({ result: mailCommandReceipt.result });
  if (completed === undefined || completed.result === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "This mailbox is no longer available.",
    });
  }
  if (wake !== undefined && dispatched) {
    await wake();
  }
  return completed.result;
};
