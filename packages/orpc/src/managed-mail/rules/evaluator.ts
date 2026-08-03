import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  managedMailRule,
  managedMailRuleApplication,
} from "@quieter/database/schema";
import { composeMessageInputSchema } from "@quieter/mail/compose/schema";
import {
  getManagedMailboxRuleActions,
  managedMailboxRuleConditionGroupSchema,
  type ManagedMailboxRuleAction,
} from "@quieter/mail/mailbox-organization";
import { structuredMailSearchSchema } from "@quieter/mail/search";
import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { updateManagedMessageLabelAssignments } from "../labels/repository";
import { sendManagedMailboxMessage } from "../messages/service";
import { matchesManagedMailRule } from "../search/evaluator";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;
type ManagedAttachmentRecord = Pick<
  typeof managedMailAttachment.$inferSelect,
  "fileName" | "normalizedFileName"
>;
type RuleActionResult = {
  kind: ManagedMailboxRuleAction["kind"];
  message?: string;
  status: "applied" | "skipped";
};

const storedRuleActionResultSchema = z.object({
  kind: z.enum(["set-read", "move", "set-labels", "forward", "stop-processing"]),
  message: z.string().optional(),
  status: z.enum(["applied", "skipped"]),
});

const parseStoredRuleActionResults = (value: unknown): RuleActionResult[] => {
  const parsed = storedRuleActionResultSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
};

const getHeader = (message: ManagedMessageRecord, name: string) =>
  message.headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;

const getConditionExplanation = (
  search: { filters: Array<{ type: string; value: string }>; text: string },
  matchMode: "all" | "any",
  conditionGroups: unknown,
) => {
  const describeSearch = (
    currentSearch: { filters: Array<{ type: string; value: string }>; text: string },
    currentMatchMode: "all" | "any",
  ) => {
    const conditions = [
      ...currentSearch.filters.map((filter) => `${filter.type}:${filter.value}`),
      ...(currentSearch.text ? [`text:${currentSearch.text}`] : []),
    ];
    return conditions.length > 0
      ? `Matched ${currentMatchMode === "all" ? "all" : "one or more"} of ${conditions.join(", ")}.`
      : "Matched the rule conditions.";
  };
  const parsedGroups = managedMailboxRuleConditionGroupSchema.array().safeParse(conditionGroups);
  const descriptions = [
    describeSearch(search, matchMode),
    ...(parsedGroups.success
      ? parsedGroups.data.map((group) => describeSearch(group.search, group.matchMode))
      : []),
  ];
  return descriptions.length === 1
    ? descriptions[0]
    : descriptions.map((description, index) => `Condition ${index + 1}: ${description}`).join(" ");
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const matchesRuleConditions = (input: {
  attachments: readonly ManagedAttachmentRecord[];
  customLabelIds: readonly string[];
  customLabelNames: readonly string[];
  message: ManagedMessageRecord;
  matchMode: "all" | "any";
  search: unknown;
  conditionGroups: unknown;
}) => {
  const search = structuredMailSearchSchema.parse(input.search);
  const mainMatch = matchesManagedMailRule({
    attachments: input.attachments,
    customLabelIds: input.customLabelIds,
    customLabelNames: input.customLabelNames,
    matchMode: input.matchMode,
    message: input.message,
    search,
  });
  const groups = managedMailboxRuleConditionGroupSchema.array().safeParse(input.conditionGroups);
  if (!groups.success || groups.data.length === 0) return mainMatch;

  return (
    mainMatch &&
    groups.data.every((group) =>
      matchesManagedMailRule({
        attachments: input.attachments,
        customLabelIds: input.customLabelIds,
        customLabelNames: input.customLabelNames,
        matchMode: group.matchMode,
        message: input.message,
        search: group.search,
      }),
    )
  );
};

const createForwardMessage = (input: {
  message: ManagedMessageRecord;
  recipients: string[];
  ruleId: string;
}) => {
  const subject = input.message.subject?.trim() || "(No subject)";
  const forwardedBodyText = input.message.bodyText?.trim() || input.message.snippet?.trim() || "";
  const bodyText = [
    "---------- Forwarded message ----------",
    `From: ${input.message.from}`,
    `Subject: ${subject}`,
    "",
    forwardedBodyText,
  ].join("\n");
  const bodyHtml = [
    "<p>---------- Forwarded message ----------</p>",
    `<p><strong>From:</strong> ${escapeHtml(input.message.from)}<br><strong>Subject:</strong> ${escapeHtml(subject)}</p>`,
    input.message.bodyHtml?.trim() ||
      `<p>${escapeHtml(forwardedBodyText).replaceAll("\n", "<br>")}</p>`,
  ].join("");

  return composeMessageInputSchema.parse({
    attachments: [],
    bodyHtml,
    bodyText,
    headers: [{ name: "X-Quieter-Rule-Forwarded", value: input.ruleId }],
    inlineImages: [],
    lastSavedAt: null,
    localId: randomUUID(),
    messageId: null,
    recipients: { bcc: "", cc: "", to: input.recipients.join(", ") },
    replyContext: null,
    saveStatus: "idle",
    subject: subject.toLowerCase().startsWith("fwd:") ? subject : `Fwd: ${subject}`,
    updatedAt: Date.now(),
  });
};

const applyRuleActions = async (input: {
  actions: readonly ManagedMailboxRuleAction[];
  completedActionResults: readonly RuleActionResult[];
  mailboxId: string;
  message: ManagedMessageRecord;
  persistActionResults: (actionResults: readonly RuleActionResult[]) => Promise<void>;
  ruleId: string;
  ruleOwnerUserId: string | null;
}) => {
  const results: RuleActionResult[] = [...input.completedActionResults];
  let contentChanged = false;
  const recordActionResult = async (result: RuleActionResult) => {
    results.push(result);
    await input.persistActionResults(results);
  };

  for (let index = input.completedActionResults.length; index < input.actions.length; index += 1) {
    const action = input.actions[index];
    if (action.kind === "set-read") {
      if (input.message.isRead === action.read) {
        await recordActionResult({
          kind: action.kind,
          status: "skipped",
          message: "Already in that state.",
        });
      } else {
        await db
          .update(managedMailMessage)
          .set({ isRead: action.read, updatedAt: new Date() })
          .where(
            and(
              eq(managedMailMessage.id, input.message.id),
              eq(managedMailMessage.mailboxId, input.mailboxId),
            ),
          );
        input.message.isRead = action.read;
        contentChanged = true;
        await recordActionResult({ kind: action.kind, status: "applied" });
      }
      continue;
    }

    if (action.kind === "move") {
      const state =
        action.destination === "archive"
          ? "archived"
          : action.destination === "inbox"
            ? "active"
            : action.destination;
      if (input.message.mailboxState === state) {
        await recordActionResult({
          kind: action.kind,
          status: "skipped",
          message: "Already in that mailbox.",
        });
      } else {
        await db
          .update(managedMailMessage)
          .set({ mailboxState: state, updatedAt: new Date() })
          .where(
            and(
              eq(managedMailMessage.id, input.message.id),
              eq(managedMailMessage.mailboxId, input.mailboxId),
            ),
          );
        input.message.mailboxState = state;
        contentChanged = true;
        await recordActionResult({ kind: action.kind, status: "applied" });
      }
      continue;
    }

    if (action.kind === "set-labels") {
      await updateManagedMessageLabelAssignments({
        addLabelIds: action.addIds,
        database: db,
        mailboxId: input.mailboxId,
        messageIds: [input.message.id],
        removeLabelIds: action.removeIds,
        ruleId: input.ruleId,
        source: "rule",
      });
      contentChanged = true;
      await recordActionResult({ kind: action.kind, status: "applied" });
      continue;
    }

    if (action.kind === "forward") {
      if (getHeader(input.message, "X-Quieter-Rule-Forwarded")) {
        await recordActionResult({
          kind: action.kind,
          message: "Skipped a message that was already forwarded by an automatic rule.",
          status: "skipped",
        });
      } else if (!input.ruleOwnerUserId) {
        throw new Error("The rule owner is no longer available to send an automatic forward.");
      } else {
        await sendManagedMailboxMessage({
          mailboxId: input.mailboxId,
          message: createForwardMessage({
            message: input.message,
            recipients: action.recipients,
            ruleId: input.ruleId,
          }),
          userId: input.ruleOwnerUserId,
        });
        contentChanged = true;
        await recordActionResult({ kind: action.kind, status: "applied" });
      }
      continue;
    }

    if (action.kind === "stop-processing") {
      await recordActionResult({ kind: action.kind, status: "applied" });
      break;
    }
  }

  if (contentChanged) {
    await db
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
      .where(eq(mailbox.id, input.mailboxId));
  }

  return results;
};

export const applyManagedRulesToMessage = async (input: {
  mailboxId: string;
  messageId: string;
  ruleId?: string;
}) => {
  const [message, attachments, labels, mailboxLabels, rules, applications] = await Promise.all([
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
      .select({ labelId: managedMailMessageLabel.labelId })
      .from(managedMailMessageLabel)
      .where(eq(managedMailMessageLabel.messageId, input.messageId)),
    db
      .select({ id: managedMailLabel.id, name: managedMailLabel.normalizedName })
      .from(managedMailLabel)
      .where(eq(managedMailLabel.mailboxId, input.mailboxId)),
    db
      .select()
      .from(managedMailRule)
      .where(
        and(
          eq(managedMailRule.mailboxId, input.mailboxId),
          eq(managedMailRule.enabled, true),
          input.ruleId ? eq(managedMailRule.id, input.ruleId) : undefined,
        ),
      )
      .orderBy(asc(managedMailRule.priority), asc(managedMailRule.name)),
    db
      .select()
      .from(managedMailRuleApplication)
      .where(
        and(
          eq(managedMailRuleApplication.mailboxId, input.mailboxId),
          eq(managedMailRuleApplication.messageId, input.messageId),
        ),
      ),
  ]);
  if (!message || message.direction !== "inbound") return { matched: false, error: null };

  const applicationByRuleId = new Map(
    applications.map((application) => [application.ruleId, application]),
  );
  const labelNameById = new Map(mailboxLabels.map((label) => [label.id, label.name]));
  const customLabelIds = new Set(labels.map((label) => label.labelId));
  const customLabelNames = new Set(
    labels.flatMap((label) => {
      const name = labelNameById.get(label.labelId);
      return name ? [name] : [];
    }),
  );
  let matchedRule = false;
  let ruleError: string | null = null;

  for (const rule of rules) {
    const previousApplication = applicationByRuleId.get(rule.id);
    const actions = getManagedMailboxRuleActions({
      actions: rule.actions,
      labelIds: rule.labelIds,
    });
    const previousActionResults = parseStoredRuleActionResults(previousApplication?.actionResults);
    const applicationIsComplete =
      previousApplication?.matched &&
      !previousApplication.error &&
      previousActionResults.length >= actions.length;
    if (applicationIsComplete) {
      matchedRule ||= true;
      if (actions.some((action) => action.kind === "stop-processing")) {
        break;
      }
      continue;
    }

    const now = new Date();
    let matched = false;
    try {
      matched = matchesRuleConditions({
        attachments,
        conditionGroups: rule.conditionGroups,
        customLabelIds: Array.from(customLabelIds),
        customLabelNames: Array.from(customLabelNames),
        matchMode: rule.matchMode,
        message,
        search: rule.search,
      });
      matchedRule ||= matched;
      const explanation = matched
        ? getConditionExplanation(
            structuredMailSearchSchema.parse(rule.search),
            rule.matchMode,
            rule.conditionGroups,
          )
        : "The rule conditions did not match this message.";
      const actionResults = matched
        ? await applyRuleActions({
            actions,
            completedActionResults: previousActionResults,
            mailboxId: input.mailboxId,
            message,
            persistActionResults: async (partialActionResults) => {
              await db
                .insert(managedMailRuleApplication)
                .values({
                  actionResults: Array.from(partialActionResults),
                  appliedAt: now,
                  createdAt: now,
                  explanation,
                  id: randomUUID(),
                  mailboxId: input.mailboxId,
                  matched: true,
                  messageId: input.messageId,
                  ruleId: rule.id,
                  updatedAt: now,
                })
                .onConflictDoUpdate({
                  target: [managedMailRuleApplication.ruleId, managedMailRuleApplication.messageId],
                  set: {
                    actionResults: Array.from(partialActionResults),
                    appliedAt: now,
                    error: null,
                    explanation,
                    matched: true,
                    updatedAt: now,
                  },
                });
            },
            ruleId: rule.id,
            ruleOwnerUserId: rule.updatedByUserId ?? rule.createdByUserId,
          })
        : [];
      if (matched) {
        for (const action of actions) {
          if (action.kind !== "set-labels") continue;
          for (const labelId of action.removeIds) customLabelIds.delete(labelId);
          for (const labelId of action.removeIds) {
            const name = labelNameById.get(labelId);
            if (name) customLabelNames.delete(name);
          }
          for (const labelId of action.addIds) {
            customLabelIds.add(labelId);
            const name = labelNameById.get(labelId);
            if (name) customLabelNames.add(name);
          }
        }
      }
      const stopProcessing = matched && actions.some((action) => action.kind === "stop-processing");
      await db
        .insert(managedMailRuleApplication)
        .values({
          actionResults,
          appliedAt: matched ? now : null,
          createdAt: now,
          explanation,
          id: randomUUID(),
          mailboxId: input.mailboxId,
          matched,
          messageId: input.messageId,
          ruleId: rule.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [managedMailRuleApplication.ruleId, managedMailRuleApplication.messageId],
          set: {
            actionResults,
            appliedAt: matched ? now : null,
            error: null,
            explanation,
            matched,
            updatedAt: now,
          },
        });
      if (stopProcessing) break;
    } catch (error) {
      ruleError = error instanceof Error ? error.message : "Rule evaluation failed.";
      const explanation = matched
        ? "The rule matched, but one or more actions could not be completed."
        : "The rule conditions could not be evaluated.";
      await db
        .insert(managedMailRuleApplication)
        .values({
          createdAt: now,
          error: error instanceof Error ? error.message : "Rule evaluation failed.",
          explanation,
          id: randomUUID(),
          mailboxId: input.mailboxId,
          matched,
          messageId: input.messageId,
          ruleId: rule.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [managedMailRuleApplication.ruleId, managedMailRuleApplication.messageId],
          set: {
            error: error instanceof Error ? error.message : "Rule evaluation failed.",
            explanation,
            matched,
            updatedAt: now,
          },
        });
    }
  }
  return { matched: matchedRule, error: ruleError };
};
