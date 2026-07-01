import { db } from "@quieter/database/client";
import {
  managedMailAttachment,
  managedMailMessage,
  managedMailRule,
  managedMailRuleApplication,
} from "@quieter/database/schema";
import { structuredMailSearchSchema } from "@quieter/mail/search";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { updateManagedMessageLabelAssignments } from "../labels/repository";
import { matchesManagedMailRule } from "../search/evaluator";

export const applyManagedRulesToMessage = async (input: {
  mailboxId: string;
  messageId: string;
}) => {
  const [message, attachments, rules] = await Promise.all([
    db
      .select()
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.id, input.messageId),
          eq(managedMailMessage.mailboxId, input.mailboxId),
        ),
      )
      .limit(1)
      .then((records) => records[0]),
    db
      .select({
        fileName: managedMailAttachment.fileName,
        normalizedFileName: managedMailAttachment.normalizedFileName,
      })
      .from(managedMailAttachment)
      .where(eq(managedMailAttachment.messageId, input.messageId)),
    db
      .select()
      .from(managedMailRule)
      .where(and(eq(managedMailRule.mailboxId, input.mailboxId), eq(managedMailRule.enabled, true)))
      .orderBy(asc(managedMailRule.priority)),
  ]);
  if (!message || message.direction !== "inbound") return;

  for (const rule of rules) {
    const now = new Date();
    try {
      const search = structuredMailSearchSchema.parse(rule.search);
      const matched = matchesManagedMailRule({
        attachments,
        matchMode: rule.matchMode,
        message,
        search,
      });
      if (matched) {
        await updateManagedMessageLabelAssignments({
          addLabelIds: rule.labelIds,
          mailboxId: input.mailboxId,
          messageIds: [input.messageId],
          ruleId: rule.id,
          source: "rule",
        });
      }
      await db
        .insert(managedMailRuleApplication)
        .values({
          appliedAt: matched ? now : null,
          createdAt: now,
          id: randomUUID(),
          mailboxId: input.mailboxId,
          matched,
          messageId: input.messageId,
          ruleId: rule.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [managedMailRuleApplication.ruleId, managedMailRuleApplication.messageId],
          set: { appliedAt: matched ? now : null, error: null, matched, updatedAt: now },
        });
    } catch (error) {
      await db
        .insert(managedMailRuleApplication)
        .values({
          createdAt: now,
          error: error instanceof Error ? error.message : "Rule evaluation failed.",
          id: randomUUID(),
          mailboxId: input.mailboxId,
          matched: false,
          messageId: input.messageId,
          ruleId: rule.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [managedMailRuleApplication.ruleId, managedMailRuleApplication.messageId],
          set: {
            error: error instanceof Error ? error.message : "Rule evaluation failed.",
            matched: false,
            updatedAt: now,
          },
        });
    }
  }
};
