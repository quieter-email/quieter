import { randomUUID } from "node:crypto";

import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { db } from "@quieter/database/client";
import {
  mailboxAction,
  mailboxActionRevision,
  mailboxActionRun,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, eq, isNotNull } from "drizzle-orm";

import { hasText } from "../text";
import { executeMailboxActionRun } from "./executor";

const sqsClient = new SQSClient({});

const sendRunToQueue = async (runId: string) => {
  if (!hasText(serverEnv.MAILBOX_ACTION_QUEUE_URL)) {
    await executeMailboxActionRun(runId);
    return;
  }

  await sqsClient.send(
    new SendMessageCommand({
      MessageBody: JSON.stringify({ runId }),
      QueueUrl: serverEnv.MAILBOX_ACTION_QUEUE_URL,
    })
  );
};

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

  await Promise.all(
    runIds.map(async (runId) => {
      try {
        await sendRunToQueue(runId);
      } catch (error) {
        reportError(error, { operation: "mailbox-actions:enqueue-run" });
      }
    })
  );

  return { enqueuedRunIds: runIds };
};
