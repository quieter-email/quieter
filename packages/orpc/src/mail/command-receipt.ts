import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailCommandReceipt } from "@quieter/database/schema";
import type {
  MailCommandExecutionState,
  MailCommandFollowUp,
} from "@quieter/database/schema";
import { isGmailServiceError } from "@quieter/gmail";
import type { MailMutationResult } from "@quieter/mail/data-plane";
import { reportError } from "@quieter/observability";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import type { MailInputs } from "./inputs";

const COMMAND_PENDING_MS = 60_000;

export type MailCommandExecution = {
  dispatch: <T>(write: () => Promise<T>) => Promise<T>;
  followUp: MailCommandFollowUp | undefined;
  saveFollowUp: (work: MailCommandFollowUp) => Promise<void>;
};

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
  execute: (execution: MailCommandExecution) => Promise<MailMutationResult>;
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
  const owner = randomUUID();
  const preparing = { owner, phase: "preparing" } as const;
  const phase = sql`${mailCommandReceipt.executionState}->>'phase'`;
  const currentOwner = sql`${mailCommandReceipt.executionState}->>'owner'`;
  const [claim] = await db
    .insert(mailCommandReceipt)
    .values({
      actorUserId,
      claimedAt: sql`now()`,
      createdAt: sql`now()`,
      executionState: preparing,
      mailboxId,
      requestHash,
      requestId,
    })
    .onConflictDoUpdate({
      set: {
        claimedAt: sql`now()`,
        executionState: sql`case when ${phase} = 'follow-up'
          then jsonb_set(${mailCommandReceipt.executionState}, '{owner}', to_jsonb(${owner}::text))
          else ${JSON.stringify(preparing)}::text::jsonb end`,
      },
      setWhere: and(
        eq(mailCommandReceipt.requestHash, requestHash),
        isNull(mailCommandReceipt.result),
        or(
          and(
            isNull(mailCommandReceipt.executionState),
            isNull(mailCommandReceipt.claimedAt)
          ),
          and(
            sql`${phase} in ('preparing', 'follow-up')`,
            or(
              isNull(currentOwner),
              lt(
                mailCommandReceipt.claimedAt,
                sql`now() - ${COMMAND_PENDING_MS} * interval '1 millisecond'`
              )
            )
          )
        )
      ),
      target: [
        mailCommandReceipt.actorUserId,
        mailCommandReceipt.mailboxId,
        mailCommandReceipt.requestId,
      ],
    })
    .returning({ executionState: mailCommandReceipt.executionState });

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
    if (existing.result !== null) {
      return {
        ...existing.result,
        receipt: {
          replayed: true,
          requestId,
          status: existing.result.receipt?.status ?? "completed",
        },
      };
    }
    const state = existing.executionState;
    const dispatchedPartial =
      state?.phase === "dispatched" ? state.partial : undefined;
    const partial =
      state?.phase === "follow-up" ? state.work.result : dispatchedPartial;
    return {
      ...partial,
      receipt: {
        requestId,
        ...(partial === undefined ? {} : { replayed: true }),
        status:
          existing.claimedAt === null ||
          Date.now() - existing.claimedAt.getTime() < COMMAND_PENDING_MS
            ? "pending"
            : "uncertain",
      },
      targets: partial?.targets ?? [],
    };
  }

  const owned = and(
    identity,
    isNull(mailCommandReceipt.result),
    eq(currentOwner, owner)
  );
  let state: MailCommandExecutionState = claim.executionState ?? preparing;
  const resumed = state.phase === "follow-up";
  const writeState = async (next: MailCommandExecutionState) => {
    const [updated] = await db
      .update(mailCommandReceipt)
      .set({ claimedAt: sql`now()`, executionState: next })
      .where(owned)
      .returning({ requestId: mailCommandReceipt.requestId });
    if (updated === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "This action is already being confirmed.",
      });
    }
    state = next;
  };
  let result: MailMutationResult;
  try {
    const outcome = await execute({
      dispatch: async (write) => {
        const previous = state;
        if (previous.phase === "dispatched") {
          throw new ORPCError("CONFLICT", {
            message: "This action is already being confirmed.",
          });
        }
        await writeState({
          owner,
          partial:
            previous.phase === "follow-up" ? previous.work.result : undefined,
          phase: "dispatched",
        });
        try {
          return await write();
        } catch (error) {
          if (isRejectedGmailWrite(error)) {
            await writeState(previous);
          }
          throw error;
        }
      },
      get followUp() {
        return state.phase === "follow-up" ? state.work : undefined;
      },
      saveFollowUp: async (work) => {
        await writeState({ owner, phase: "follow-up", work });
      },
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
    if (state.phase === "preparing") {
      await db
        .update(mailCommandReceipt)
        .set({ claimedAt: null, executionState: null })
        .where(owned)
        .catch((error_: unknown) => {
          reportError(error_, { operation: "mail-command-release" });
        });
      throw error;
    }
    reportError(error, { operation: "mail-command" });
    if (state.phase === "dispatched") {
      const [persisted] = await db
        .select({ executionState: mailCommandReceipt.executionState })
        .from(mailCommandReceipt)
        .where(owned);
      if (persisted?.executionState?.phase === "follow-up") {
        state = persisted.executionState;
      }
    }
    if (state.phase === "follow-up") {
      const { work } = state;
      await writeState({ ...state, owner: null }).catch((error_: unknown) => {
        reportError(error_, { operation: "mail-command-release-follow-up" });
      });
      await wake?.();
      return {
        ...work.result,
        receipt: {
          requestId,
          ...(resumed ? { replayed: true } : {}),
          retryable: true,
          status: "pending",
        },
      };
    }
    result = {
      ...state.partial,
      receipt: { requestId, status: "uncertain" },
      targets: state.partial?.targets ?? [],
    };
  }

  const [completed] = await db
    .update(mailCommandReceipt)
    .set({ executionState: null, result })
    .where(owned)
    .returning({ result: mailCommandReceipt.result });
  if (completed === undefined || completed.result === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "This mailbox is no longer available.",
    });
  }
  if (wake !== undefined && state.phase !== "preparing") {
    await wake();
  }
  return resumed
    ? {
        ...completed.result,
        receipt: {
          replayed: true,
          requestId,
          status: completed.result.receipt?.status ?? "completed",
        },
      }
    : completed.result;
};
