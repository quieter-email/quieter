import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { db } from "@quieter/database/client";
import { mailboxAction, mailboxActionRevision, mailboxActionRun } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { executeMailboxActionRun } from "./executor";

const sqsClient = new SQSClient({});

const sendRunToQueue = async (runId: string) => {
  if (!serverEnv.MAILBOX_ACTION_QUEUE_URL) {
    await executeMailboxActionRun(runId);
    return;
  }

  await sqsClient.send(
    new SendMessageCommand({
      MessageBody: JSON.stringify({ runId }),
      QueueUrl: serverEnv.MAILBOX_ACTION_QUEUE_URL,
    }),
  );
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
        isNotNull(mailboxAction.publishedRevisionId),
      ),
    );

  const runIds: string[] = [];
  for (const action of actions) {
    if (!action.revisionId) continue;
    const [revision] = await db
      .select({ graph: mailboxActionRevision.graph })
      .from(mailboxActionRevision)
      .where(eq(mailboxActionRevision.id, action.revisionId))
      .limit(1);
    if (!revision) continue;

    const triggers = revision.graph.nodes.filter((node) => node.type === "email_received");
    for (const trigger of triggers) {
      const dedupeKey = [
        action.revisionId,
        action.mailboxId,
        input.sourceMessageId,
        trigger.id,
      ].join(":");
      const now = new Date();
      const [insertedRun] = await db
        .insert(mailboxActionRun)
        .values({
          actionId: action.actionId,
          createdAt: now,
          dedupeKey,
          id: randomUUID(),
          mailboxId: action.mailboxId,
          organizationId: action.organizationId,
          revisionId: action.revisionId,
          sourceMessageId: input.sourceMessageId,
          sourceThreadId: input.sourceThreadId ?? null,
          status: "queued",
          triggerNodeId: trigger.id,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: mailboxActionRun.dedupeKey })
        .returning({ id: mailboxActionRun.id });
      if (insertedRun) {
        runIds.push(insertedRun.id);
      }
    }
  }

  await Promise.all(
    runIds.map(async (runId) => {
      try {
        await sendRunToQueue(runId);
      } catch (error) {
        console.error("Failed to enqueue mailbox action run", { error, runId });
      }
    }),
  );

  return { enqueuedRunIds: runIds };
};
