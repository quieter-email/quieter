import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailboxAction,
  mailboxActionRevision,
  mailboxActionRun,
} from "@quieter/database/schema";
import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";

import { hasText } from "../text";

const enqueueActionTriggers = async (input: {
  action: {
    actionId: string;
    mailboxId: string;
    organizationId: string;
    revisionId: string;
  };
  sourceMessageId: string;
  sourceThreadId?: string | null;
}) => {
  const [revision] = await db
    .select({ graph: mailboxActionRevision.graph })
    .from(mailboxActionRevision)
    .where(eq(mailboxActionRevision.id, input.action.revisionId))
    .limit(1);
  if (revision === undefined) {
    return [];
  }

  const triggers = revision.graph.nodes.filter(
    (node) => node.type === "email_received"
  );
  const runIds: string[] = [];

  await Promise.all(
    triggers.map(async (trigger) => {
      const dedupeKey = [
        input.action.revisionId,
        input.action.mailboxId,
        input.sourceMessageId,
        trigger.id,
      ].join(":");
      const now = new Date();
      const [insertedRun] = await db
        .insert(mailboxActionRun)
        .values({
          actionId: input.action.actionId,
          createdAt: now,
          dedupeKey,
          id: randomUUID(),
          mailboxId: input.action.mailboxId,
          organizationId: input.action.organizationId,
          revisionId: input.action.revisionId,
          sourceMessageId: input.sourceMessageId,
          sourceThreadId: input.sourceThreadId ?? null,
          status: "queued",
          triggerNodeId: trigger.id,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: mailboxActionRun.dedupeKey })
        .returning({ id: mailboxActionRun.id });
      if (insertedRun !== undefined) {
        runIds.push(insertedRun.id);
      }
    })
  );

  return runIds;
};

export const enqueueMailboxActionsForMessage = async (input: {
  mailboxId: string;
  sourceMessageId: string;
  sourceThreadId?: string | null;
}) => {
  const actions = await db
    .select({
      actionId: mailboxAction.id,
      mailboxId: mailboxAction.mailboxId,
      organizationId: mailboxAction.organizationId,
      revisionId: mailboxAction.publishedRevisionId,
    })
    .from(mailboxAction)
    .where(
      and(
        eq(mailboxAction.mailboxId, input.mailboxId),
        eq(mailboxAction.enabled, true),
        eq(mailboxAction.status, "ready"),
        isNotNull(mailboxAction.publishedRevisionId)
      )
    );

  const runIdGroups = await Promise.all(
    actions.flatMap((action) => {
      if (!hasText(action.revisionId)) {
        return [];
      }

      return [
        enqueueActionTriggers({
          action: {
            actionId: action.actionId,
            mailboxId: action.mailboxId,
            organizationId: action.organizationId,
            revisionId: action.revisionId,
          },
          sourceMessageId: input.sourceMessageId,
          sourceThreadId: input.sourceThreadId,
        }),
      ];
    })
  );
  const runIds = runIdGroups.flat();

  return { enqueuedRunIds: runIds };
};

/** How long a dispatched message chain (initial delivery plus queue retries
 * with backoff) is assumed to own a run before the fallback dispatcher may
 * consider it lost and re-dispatch it.
 */
const DISPATCH_LEASE_MS = 15 * 60 * 1000;

/**
 * Atomically claims runs that need a dispatch message: never-dispatched or
 * stale-dispatched queued rows, plus lease-expired running rows for crash
 * recovery. The conditional UPDATE makes overlapping dispatcher invocations
 * safe; each run is claimed by at most one invocation.
 */
export const claimPendingMailboxActionRuns = async () => {
  const now = new Date();
  const dispatchLeaseExpiry = new Date(now.getTime() - DISPATCH_LEASE_MS);
  return await db
    .update(mailboxActionRun)
    .set({ dispatchedAt: now, updatedAt: now })
    .where(
      or(
        and(
          eq(mailboxActionRun.status, "queued"),
          or(
            isNull(mailboxActionRun.dispatchedAt),
            lte(mailboxActionRun.dispatchedAt, dispatchLeaseExpiry)
          )
        ),
        and(
          eq(mailboxActionRun.status, "running"),
          or(
            isNull(mailboxActionRun.leasedUntil),
            lt(mailboxActionRun.leasedUntil, now)
          )
        )
      )
    )
    .returning({ runId: mailboxActionRun.id });
};

/** Records successful dispatches so the fallback dispatcher leaves them alone. */
export const markMailboxActionRunsDispatched = async (runIds: string[]) => {
  if (runIds.length === 0) {
    return;
  }

  const now = new Date();
  await db
    .update(mailboxActionRun)
    .set({ dispatchedAt: now })
    .where(inArray(mailboxActionRun.id, runIds));
};

/**
 * Releases dispatch claims after a failed send so the affected runs are
 * re-dispatched on the next tick instead of waiting out the dispatch lease.
 */
export const releaseMailboxActionRunDispatchClaims = async (
  runIds: string[]
) => {
  if (runIds.length === 0) {
    return;
  }

  await db
    .update(mailboxActionRun)
    .set({ dispatchedAt: null })
    .where(inArray(mailboxActionRun.id, runIds));
};
