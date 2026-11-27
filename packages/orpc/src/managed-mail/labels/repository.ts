import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database/schema";
import { and, eq, inArray, ne } from "drizzle-orm";

import { publishMailboxChange } from "../../mailbox-changes";
import { appendManagedMailboxContentChange } from "../changes";

export const assertManagedLabelsBelongToMailbox = async (
  mailboxId: string,
  labelIds: readonly string[],
  database: DatabaseExecutor = db
) => {
  const uniqueLabelIds = [...new Set(labelIds)];
  if (uniqueLabelIds.length === 0) {
    return [];
  }

  const labels = await database
    .select()
    .from(managedMailLabel)
    .where(
      and(
        eq(managedMailLabel.mailboxId, mailboxId),
        inArray(managedMailLabel.id, uniqueLabelIds)
      )
    )
    .for("share");
  if (labels.length !== uniqueLabelIds.length) {
    throw new ORPCError("BAD_REQUEST", {
      message: "One or more labels are unavailable.",
    });
  }
  return labels;
};

export const updateManagedMessageLabelAssignments = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  messageIds: string[];
  removeLabelIds?: string[];
  source: "ai_auto_label" | "backfill" | "inherited" | "manual" | "rule";
  ruleId?: string;
  userId?: string;
  database: DatabaseTransaction;
}) => {
  const addLabelIds =
    input.addLabelIds === undefined ? [] : [...new Set(input.addLabelIds)];
  const removeLabelIds =
    input.removeLabelIds === undefined
      ? []
      : [...new Set(input.removeLabelIds)];
  const { database } = input;
  await assertManagedLabelsBelongToMailbox(
    input.mailboxId,
    [...addLabelIds, ...removeLabelIds],
    database
  );

  const changedMessageIds = new Set<string>();
  if (removeLabelIds.length > 0 && input.messageIds.length > 0) {
    const removed = await database
      .delete(managedMailMessageLabel)
      .where(
        and(
          eq(managedMailMessageLabel.mailboxId, input.mailboxId),
          inArray(managedMailMessageLabel.messageId, input.messageIds),
          inArray(managedMailMessageLabel.labelId, removeLabelIds)
        )
      )
      .returning({ messageId: managedMailMessageLabel.messageId });
    for (const { messageId } of removed) {
      changedMessageIds.add(messageId);
    }
  }

  if (addLabelIds.length > 0 && input.messageIds.length > 0) {
    const added = await database
      .insert(managedMailMessageLabel)
      .values(
        input.messageIds.flatMap((messageId) =>
          addLabelIds.map((labelId) => ({
            assignedByUserId: input.userId ?? null,
            createdAt: new Date(),
            id: randomUUID(),
            labelId,
            mailboxId: input.mailboxId,
            messageId,
            ruleId: input.ruleId ?? null,
            source: input.source,
          }))
        )
      )
      .onConflictDoNothing({
        target: [
          managedMailMessageLabel.messageId,
          managedMailMessageLabel.labelId,
        ],
      })
      .returning({ messageId: managedMailMessageLabel.messageId });
    for (const { messageId } of added) {
      changedMessageIds.add(messageId);
    }
  }

  const assignments =
    input.messageIds.length > 0
      ? await database
          .select({
            labelId: managedMailMessageLabel.labelId,
            messageId: managedMailMessageLabel.messageId,
          })
          .from(managedMailMessageLabel)
          .where(inArray(managedMailMessageLabel.messageId, input.messageIds))
      : [];
  const labelIdsByMessageId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const labelIds = labelIdsByMessageId.get(assignment.messageId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByMessageId.set(assignment.messageId, labelIds);
  }

  return {
    assignments: input.messageIds.map((messageId) => ({
      id: messageId,
      labelIds: labelIdsByMessageId.get(messageId) ?? [],
    })),
    changedMessageIds,
  };
};

export const inheritManagedThreadLabels = async (input: {
  mailboxId: string;
  messageId: string;
  threadId: string;
}) => {
  const assignments = await db
    .selectDistinct({ labelId: managedMailMessageLabel.labelId })
    .from(managedMailMessageLabel)
    .innerJoin(
      managedMailMessage,
      eq(managedMailMessage.id, managedMailMessageLabel.messageId)
    )
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
        ne(managedMailMessage.id, input.messageId)
      )
    );
  if (assignments.length === 0) {
    return;
  }

  const committed = await db.transaction(async (tx) => {
    const { changedMessageIds } = await updateManagedMessageLabelAssignments({
      addLabelIds: assignments.map((assignment) => assignment.labelId),
      database: tx,
      mailboxId: input.mailboxId,
      messageIds: [input.messageId],
      source: "inherited",
    });
    return changedMessageIds.size > 0
      ? await appendManagedMailboxContentChange(tx, {
          changes: [
            {
              kind: "message.labels",
              messageId: input.messageId,
              threadId: input.threadId,
            },
          ],
          mailboxId: input.mailboxId,
        })
      : null;
  });
  await publishMailboxChange(committed);
};
