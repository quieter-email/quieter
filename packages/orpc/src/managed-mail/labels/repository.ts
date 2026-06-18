import { ORPCError } from "@orpc/server";
import {
  db,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database";
import { and, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const assertManagedLabelsBelongToMailbox = async (
  mailboxId: string,
  labelIds: readonly string[],
) => {
  const uniqueLabelIds = Array.from(new Set(labelIds));
  if (uniqueLabelIds.length === 0) return [];

  const labels = await db
    .select()
    .from(managedMailLabel)
    .where(
      and(eq(managedMailLabel.mailboxId, mailboxId), inArray(managedMailLabel.id, uniqueLabelIds)),
    );
  if (labels.length !== uniqueLabelIds.length) {
    throw new ORPCError("BAD_REQUEST", { message: "One or more labels are unavailable." });
  }
  return labels;
};

export const updateManagedMessageLabelAssignments = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  messageIds: string[];
  removeLabelIds?: string[];
  source: "backfill" | "inherited" | "manual" | "rule";
  ruleId?: string;
  userId?: string;
}) => {
  const addLabelIds = Array.from(new Set(input.addLabelIds ?? []));
  const removeLabelIds = Array.from(new Set(input.removeLabelIds ?? []));
  await assertManagedLabelsBelongToMailbox(input.mailboxId, [...addLabelIds, ...removeLabelIds]);

  if (removeLabelIds.length > 0 && input.messageIds.length > 0) {
    await db
      .delete(managedMailMessageLabel)
      .where(
        and(
          eq(managedMailMessageLabel.mailboxId, input.mailboxId),
          inArray(managedMailMessageLabel.messageId, input.messageIds),
          inArray(managedMailMessageLabel.labelId, removeLabelIds),
        ),
      );
  }

  if (addLabelIds.length > 0 && input.messageIds.length > 0) {
    await db
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
          })),
        ),
      )
      .onConflictDoNothing({
        target: [managedMailMessageLabel.messageId, managedMailMessageLabel.labelId],
      });
  }

  const assignments =
    input.messageIds.length > 0
      ? await db
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

  return input.messageIds.map((messageId) => ({
    id: messageId,
    labelIds: labelIdsByMessageId.get(messageId) ?? [],
  }));
};

export const inheritManagedThreadLabels = async (input: {
  mailboxId: string;
  messageId: string;
  threadId: string;
}) => {
  const assignments = await db
    .selectDistinct({ labelId: managedMailMessageLabel.labelId })
    .from(managedMailMessageLabel)
    .innerJoin(managedMailMessage, eq(managedMailMessage.id, managedMailMessageLabel.messageId))
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
        ne(managedMailMessage.id, input.messageId),
      ),
    );
  if (assignments.length === 0) return;

  await updateManagedMessageLabelAssignments({
    addLabelIds: assignments.map((assignment) => assignment.labelId),
    mailboxId: input.mailboxId,
    messageIds: [input.messageId],
    source: "inherited",
  });
};
