import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import type { DatabaseClient } from "@quieter/database/client";
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
} from "@quieter/mail/mailbox-organization";
import type { ManagedMailboxRuleAction } from "@quieter/mail/mailbox-organization";
import { parseRawMailAttachments } from "@quieter/mail/raw-message";
import { structuredMailSearchSchema } from "@quieter/mail/search";
import { reportError } from "@quieter/observability";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { hasText } from "../../text";
import { updateManagedMessageLabelAssignments } from "../labels/repository";
import { readRawMailObject } from "../messages/raw-object";
import { sendManagedMailboxMessage } from "../messages/service";
import { matchesManagedMailRule } from "../search/evaluator";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;
type ManagedAttachmentRecord = Pick<
  typeof managedMailAttachment.$inferSelect,
  "fileName" | "normalizedFileName"
>;
type ManagedMailDatabase =
  | DatabaseClient
  | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type RuleActionResult = {
  kind: ManagedMailboxRuleAction["kind"];
  message?: string;
  status: "applied" | "skipped";
};

const storedRuleActionResultSchema = z.object({
  kind: z.enum([
    "set-read",
    "move",
    "set-labels",
    "forward",
    "stop-processing",
  ]),
  message: z.string().optional(),
  status: z.enum(["applied", "skipped"]),
});

const parseStoredRuleActionResults = (
  value: unknown,
  _context: { mailboxId: string; messageId: string; ruleId: string }
): RuleActionResult[] | null => {
  if (value === null || value === undefined) {
    return [];
  }
  const parsed = storedRuleActionResultSchema.array().safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  reportError(parsed.error, {
    operation: "managed-mail:parse-rule-action-results",
  });
  return null;
};

const alignStoredRuleActionResults = (
  actions: readonly ManagedMailboxRuleAction[],
  results: readonly RuleActionResult[]
) => {
  const aligned: RuleActionResult[] = [];
  for (
    let index = 0;
    index < actions.length && index < results.length;
    index += 1
  ) {
    const result = results[index];
    if (result === undefined || actions[index]?.kind !== result.kind) {
      break;
    }
    aligned.push(result);
  }
  return aligned;
};

const getHeader = (message: ManagedMessageRecord, name: string) =>
  message.headers.find(
    (header) => header.name.toLowerCase() === name.toLowerCase()
  )?.value;

const describeRuleSearch = (
  currentSearch: { filters: { type: string; value: string }[]; text: string },
  currentMatchMode: "all" | "any"
) => {
  const conditions = [
    ...currentSearch.filters.map((filter) => `${filter.type}:${filter.value}`),
    ...(hasText(currentSearch.text) ? [`text:${currentSearch.text}`] : []),
  ];
  return conditions.length > 0
    ? `Matched ${currentMatchMode === "all" ? "all" : "one or more"} of ${conditions.join(", ")}.`
    : "Matched the rule conditions.";
};

const getConditionExplanation = (
  search: { filters: { type: string; value: string }[]; text: string },
  matchMode: "all" | "any",
  conditionGroups: unknown
) => {
  const parsedGroups = managedMailboxRuleConditionGroupSchema
    .array()
    .safeParse(conditionGroups);
  const descriptions = [
    describeRuleSearch(search, matchMode),
    ...(parsedGroups.success
      ? parsedGroups.data.map((group) =>
          describeRuleSearch(group.search, group.matchMode)
        )
      : []),
  ];
  return descriptions.length === 1
    ? descriptions[0]
    : descriptions
        .map((description, index) => `Condition ${index + 1}: ${description}`)
        .join(" ");
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const createAttachmentFile = (
  content: Uint8Array,
  fileName: string,
  mimeType: string
) => new File([Uint8Array.from(content).buffer], fileName, { type: mimeType });

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
  const groups = managedMailboxRuleConditionGroupSchema
    .array()
    .safeParse(input.conditionGroups);
  if (!groups.success || groups.data.length === 0) {
    return mainMatch;
  }

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
      })
    )
  );
};

const createForwardMessage = async (input: {
  includeAttachments: boolean;
  message: ManagedMessageRecord;
  recipients: string[];
  ruleId: string;
}) => {
  const subject = hasText(input.message.subject)
    ? input.message.subject.trim()
    : "(No subject)";
  let forwardedBodyText = "";
  if (hasText(input.message.bodyText)) {
    forwardedBodyText = input.message.bodyText.trim();
  } else if (hasText(input.message.snippet)) {
    forwardedBodyText = input.message.snippet.trim();
  }
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
    hasText(input.message.bodyHtml)
      ? input.message.bodyHtml.trim()
      : `<p>${escapeHtml(forwardedBodyText).replaceAll("\n", "<br>")}</p>`,
  ].join("");

  const originalAttachments = input.includeAttachments
    ? await parseRawMailAttachments(await readRawMailObject(input.message))
    : [];
  const attachments = originalAttachments
    .filter(
      (attachment) => !attachment.inline || !hasText(attachment.contentId)
    )
    .map((attachment) => ({
      contentId: attachment.contentId,
      file: createAttachmentFile(
        attachment.content,
        attachment.fileName,
        attachment.mimeType
      ),
      fileName: attachment.fileName,
      id: randomUUID(),
      isInline: false,
      mimeType: attachment.mimeType,
      name: attachment.fileName,
      size: attachment.content.byteLength,
    }));
  const inlineImages = originalAttachments
    .filter(
      (attachment): attachment is typeof attachment & { contentId: string } =>
        attachment.inline && hasText(attachment.contentId)
    )
    .map((attachment) => ({
      contentId: attachment.contentId,
      file: createAttachmentFile(
        attachment.content,
        attachment.fileName,
        attachment.mimeType
      ),
      id: randomUUID(),
      isInline: true,
      mimeType: attachment.mimeType,
      name: attachment.fileName,
      size: attachment.content.byteLength,
    }));

  return composeMessageInputSchema.parse({
    attachments,
    bodyHtml,
    bodyText,
    headers: [{ name: "X-Quieter-Rule-Forwarded", value: input.ruleId }],
    inlineImages,
    lastSavedAt: null,
    localId: randomUUID(),
    messageId: null,
    recipients: { bcc: "", cc: "", to: input.recipients.join(", ") },
    replyContext: null,
    saveStatus: "idle",
    subject: subject.toLowerCase().startsWith("fwd:")
      ? subject
      : `Fwd: ${subject}`,
    updatedAt: Date.now(),
  });
};

const applyRuleActions = async (input: {
  actions: readonly ManagedMailboxRuleAction[];
  completedActionResults: readonly RuleActionResult[];
  database: ManagedMailDatabase;
  mailboxId: string;
  message: ManagedMessageRecord;
  persistActionResults: (
    actionResults: readonly RuleActionResult[]
  ) => Promise<void>;
  ruleId: string;
  ruleOwnerUserId: string | null;
}) => {
  const results: RuleActionResult[] = [...input.completedActionResults];
  let contentChanged = false;
  const recordActionResult = async (result: RuleActionResult) => {
    results.push(result);
    await input.persistActionResults(results);
  };

  const processActionAtIndex = async (index: number): Promise<void> => {
    if (index >= input.actions.length) {
      return;
    }

    const action = input.actions[index];
    if (action.kind === "set-read") {
      if (input.message.isRead === action.read) {
        await recordActionResult({
          kind: action.kind,
          message: "Already in that state.",
          status: "skipped",
        });
      } else {
        await input.database
          .update(managedMailMessage)
          .set({ isRead: action.read, updatedAt: new Date() })
          .where(
            and(
              eq(managedMailMessage.id, input.message.id),
              eq(managedMailMessage.mailboxId, input.mailboxId)
            )
          );
        input.message.isRead = action.read;
        contentChanged = true;
        await recordActionResult({ kind: action.kind, status: "applied" });
      }
      await processActionAtIndex(index + 1);
      return;
    }

    if (action.kind === "move") {
      let state: typeof managedMailMessage.$inferSelect.mailboxState;
      if (action.destination === "archive") {
        state = "archived";
      } else if (action.destination === "inbox") {
        state = "active";
      } else {
        state = action.destination;
      }
      if (input.message.mailboxState === state) {
        await recordActionResult({
          kind: action.kind,
          message: "Already in that mailbox.",
          status: "skipped",
        });
      } else {
        await input.database
          .update(managedMailMessage)
          .set({ mailboxState: state, updatedAt: new Date() })
          .where(
            and(
              eq(managedMailMessage.id, input.message.id),
              eq(managedMailMessage.mailboxId, input.mailboxId)
            )
          );
        input.message.mailboxState = state;
        contentChanged = true;
        await recordActionResult({ kind: action.kind, status: "applied" });
      }
      await processActionAtIndex(index + 1);
      return;
    }

    if (action.kind === "set-labels") {
      await updateManagedMessageLabelAssignments({
        addLabelIds: action.addIds,
        database: input.database,
        mailboxId: input.mailboxId,
        messageIds: [input.message.id],
        removeLabelIds: action.removeIds,
        ruleId: input.ruleId,
        source: "rule",
      });
      contentChanged = true;
      await recordActionResult({ kind: action.kind, status: "applied" });
      await processActionAtIndex(index + 1);
      return;
    }

    if (action.kind === "forward") {
      if (hasText(getHeader(input.message, "X-Quieter-Rule-Forwarded"))) {
        await recordActionResult({
          kind: action.kind,
          message:
            "Skipped a message that was already forwarded by an automatic rule.",
          status: "skipped",
        });
      } else if (hasText(input.ruleOwnerUserId)) {
        await sendManagedMailboxMessage({
          mailboxId: input.mailboxId,
          message: await createForwardMessage({
            includeAttachments: action.includeAttachments,
            message: input.message,
            recipients: action.recipients,
            ruleId: input.ruleId,
          }),
          userId: input.ruleOwnerUserId,
        });
        contentChanged = true;
        await recordActionResult({ kind: action.kind, status: "applied" });
      } else {
        throw new Error(
          "The rule owner is no longer available to send an automatic forward."
        );
      }
      await processActionAtIndex(index + 1);
      return;
    }

    if (action.kind === "stop-processing") {
      await recordActionResult({ kind: action.kind, status: "applied" });
      return;
    }

    await processActionAtIndex(index + 1);
  };

  await processActionAtIndex(input.completedActionResults.length);

  if (contentChanged) {
    await input.database
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(mailbox.id, input.mailboxId));
  }

  return results;
};

type ManagedRuleRecord = typeof managedMailRule.$inferSelect;
type ManagedRuleApplicationRecord =
  typeof managedMailRuleApplication.$inferSelect;

const applyManagedRuleLabelUpdates = (
  actions: readonly ManagedMailboxRuleAction[],
  customLabelIds: Set<string>,
  customLabelNames: Set<string>,
  labelNameById: Map<string, string>
) => {
  for (const action of actions) {
    if (action.kind !== "set-labels") {
      continue;
    }
    for (const labelId of action.removeIds) {
      customLabelIds.delete(labelId);
    }
    for (const labelId of action.removeIds) {
      const name = labelNameById.get(labelId);
      if (hasText(name)) {
        customLabelNames.delete(name);
      }
    }
    for (const labelId of action.addIds) {
      customLabelIds.add(labelId);
      const name = labelNameById.get(labelId);
      if (hasText(name)) {
        customLabelNames.add(name);
      }
    }
  }
};

const persistManagedRuleApplication = async (input: {
  actionResults: readonly RuleActionResult[];
  appliedAt: Date | null;
  database: ManagedMailDatabase;
  explanation: string;
  mailboxId: string;
  matched: boolean;
  messageId: string;
  now: Date;
  ruleId: string;
}) => {
  await input.database
    .insert(managedMailRuleApplication)
    .values({
      actionResults: [...input.actionResults],
      appliedAt: input.appliedAt,
      createdAt: input.now,
      explanation: input.explanation,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      matched: input.matched,
      messageId: input.messageId,
      ruleId: input.ruleId,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      set: {
        actionResults: [...input.actionResults],
        appliedAt: input.appliedAt,
        error: null,
        explanation: input.explanation,
        matched: input.matched,
        updatedAt: input.now,
      },
      target: [
        managedMailRuleApplication.ruleId,
        managedMailRuleApplication.messageId,
      ],
    });
};

const runManagedRuleEvaluation = async (input: {
  actions: readonly ManagedMailboxRuleAction[];
  attachments: readonly ManagedAttachmentRecord[];
  customLabelIds: Set<string>;
  customLabelNames: Set<string>;
  labelNameById: Map<string, string>;
  mailboxId: string;
  message: ManagedMessageRecord;
  messageId: string;
  now: Date;
  previousActionResults: readonly RuleActionResult[];
  rule: ManagedRuleRecord;
  tx: ManagedMailDatabase;
}) => {
  const matched = matchesRuleConditions({
    attachments: input.attachments,
    conditionGroups: input.rule.conditionGroups,
    customLabelIds: [...input.customLabelIds],
    customLabelNames: [...input.customLabelNames],
    matchMode: input.rule.matchMode,
    message: input.message,
    search: input.rule.search,
  });
  const explanation = matched
    ? getConditionExplanation(
        structuredMailSearchSchema.parse(input.rule.search),
        input.rule.matchMode,
        input.rule.conditionGroups
      )
    : "The rule conditions did not match this message.";
  const actionResults = matched
    ? await applyRuleActions({
        actions: input.actions,
        completedActionResults: input.previousActionResults,
        database: input.tx,
        mailboxId: input.mailboxId,
        message: input.message,
        persistActionResults: async (partialActionResults) => {
          await persistManagedRuleApplication({
            actionResults: partialActionResults,
            appliedAt: input.now,
            database: input.tx,
            explanation,
            mailboxId: input.mailboxId,
            matched: true,
            messageId: input.messageId,
            now: input.now,
            ruleId: input.rule.id,
          });
        },
        ruleId: input.rule.id,
        ruleOwnerUserId:
          input.rule.updatedByUserId ?? input.rule.createdByUserId,
      })
    : [];
  if (matched) {
    applyManagedRuleLabelUpdates(
      input.actions,
      input.customLabelIds,
      input.customLabelNames,
      input.labelNameById
    );
  }
  await persistManagedRuleApplication({
    actionResults,
    appliedAt: matched ? input.now : null,
    database: input.tx,
    explanation,
    mailboxId: input.mailboxId,
    matched,
    messageId: input.messageId,
    now: input.now,
    ruleId: input.rule.id,
  });
  return {
    breakLoop:
      matched &&
      input.actions.some((action) => action.kind === "stop-processing"),
    matched,
  };
};

const persistManagedRuleFailure = async (input: {
  database: ManagedMailDatabase;
  errorMessage: string;
  explanation: string;
  mailboxId: string;
  matched: boolean;
  messageId: string;
  now: Date;
  ruleId: string;
}) => {
  await input.database
    .insert(managedMailRuleApplication)
    .values({
      createdAt: input.now,
      error: input.errorMessage,
      explanation: input.explanation,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      matched: input.matched,
      messageId: input.messageId,
      ruleId: input.ruleId,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      set: {
        error: input.errorMessage,
        explanation: input.explanation,
        matched: input.matched,
        updatedAt: input.now,
      },
      target: [
        managedMailRuleApplication.ruleId,
        managedMailRuleApplication.messageId,
      ],
    });
};

const evaluateManagedRuleForMessage = async (input: {
  attachments: readonly ManagedAttachmentRecord[];
  customLabelIds: Set<string>;
  customLabelNames: Set<string>;
  labelNameById: Map<string, string>;
  mailboxId: string;
  message: ManagedMessageRecord;
  messageId: string;
  previousApplication: ManagedRuleApplicationRecord | undefined;
  rule: ManagedRuleRecord;
  tx: ManagedMailDatabase;
}): Promise<{
  breakLoop: boolean;
  error: string | null;
  matched: boolean;
}> => {
  const actions = getManagedMailboxRuleActions({
    actions: input.rule.actions,
    labelIds: input.rule.labelIds,
  });
  const storedActionResults = parseStoredRuleActionResults(
    input.previousApplication?.actionResults,
    {
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      ruleId: input.rule.id,
    }
  );
  if (storedActionResults === null) {
    return {
      breakLoop: true,
      error: "Stored rule action history is invalid.",
      matched: false,
    };
  }

  const previousActionResults = alignStoredRuleActionResults(
    actions,
    storedActionResults
  );
  const applicationIsComplete =
    input.previousApplication?.matched === true &&
    !hasText(input.previousApplication.error) &&
    previousActionResults.length === actions.length;
  if (applicationIsComplete) {
    return {
      breakLoop: actions.some((action) => action.kind === "stop-processing"),
      error: null,
      matched: true,
    };
  }

  const now = new Date();
  const matched = false;
  try {
    const result = await runManagedRuleEvaluation({
      actions,
      attachments: input.attachments,
      customLabelIds: input.customLabelIds,
      customLabelNames: input.customLabelNames,
      labelNameById: input.labelNameById,
      mailboxId: input.mailboxId,
      message: input.message,
      messageId: input.messageId,
      now,
      previousActionResults,
      rule: input.rule,
      tx: input.tx,
    });
    return {
      breakLoop: result.breakLoop,
      error: null,
      matched: result.matched,
    };
  } catch (error) {
    const explanation = matched
      ? "The rule matched, but one or more actions could not be completed."
      : "The rule conditions could not be evaluated.";
    const errorMessage =
      error instanceof Error ? error.message : "Rule evaluation failed.";
    await persistManagedRuleFailure({
      database: input.tx,
      errorMessage,
      explanation,
      mailboxId: input.mailboxId,
      matched,
      messageId: input.messageId,
      now,
      ruleId: input.rule.id,
    });
    return {
      breakLoop: false,
      error: errorMessage,
      matched,
    };
  }
};

const processManagedRulesAtIndex = async (input: {
  applicationByRuleId: Map<string, ManagedRuleApplicationRecord>;
  attachments: readonly ManagedAttachmentRecord[];
  customLabelIds: Set<string>;
  customLabelNames: Set<string>;
  index: number;
  labelNameById: Map<string, string>;
  mailboxId: string;
  matchedRule: boolean;
  message: ManagedMessageRecord;
  messageId: string;
  ruleError: string | null;
  rules: readonly ManagedRuleRecord[];
  tx: ManagedMailDatabase;
}): Promise<{ error: string | null; matched: boolean }> => {
  if (input.index >= input.rules.length || input.ruleError !== null) {
    return { error: input.ruleError, matched: input.matchedRule };
  }

  const rule = input.rules[input.index];
  const evaluation = await evaluateManagedRuleForMessage({
    attachments: input.attachments,
    customLabelIds: input.customLabelIds,
    customLabelNames: input.customLabelNames,
    labelNameById: input.labelNameById,
    mailboxId: input.mailboxId,
    message: input.message,
    messageId: input.messageId,
    previousApplication: input.applicationByRuleId.get(rule.id),
    rule,
    tx: input.tx,
  });
  if (evaluation.error !== null) {
    return {
      error: evaluation.error,
      matched: input.matchedRule || evaluation.matched,
    };
  }
  if (evaluation.breakLoop) {
    return { error: null, matched: input.matchedRule || evaluation.matched };
  }

  return await processManagedRulesAtIndex({
    ...input,
    index: input.index + 1,
    matchedRule: input.matchedRule || evaluation.matched,
  });
};

export const applyManagedRulesToMessage = async (input: {
  mailboxId: string;
  messageId: string;
  ruleId?: string;
}) =>
  await db.transaction(async (tx) => {
    const [message] = await tx
      .select()
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.id, input.messageId),
          eq(managedMailMessage.mailboxId, input.mailboxId)
        )
      )
      .for("update", { skipLocked: true })
      .limit(1);
    if (message === undefined || message.direction !== "inbound") {
      return { error: null, matched: false };
    }

    const [attachments, labels, mailboxLabels, rules, applications] =
      await Promise.all([
        tx
          .select({
            fileName: managedMailAttachment.fileName,
            normalizedFileName: managedMailAttachment.normalizedFileName,
          })
          .from(managedMailAttachment)
          .where(eq(managedMailAttachment.messageId, input.messageId)),
        tx
          .select({ labelId: managedMailMessageLabel.labelId })
          .from(managedMailMessageLabel)
          .where(eq(managedMailMessageLabel.messageId, input.messageId)),
        tx
          .select({
            id: managedMailLabel.id,
            name: managedMailLabel.normalizedName,
          })
          .from(managedMailLabel)
          .where(eq(managedMailLabel.mailboxId, input.mailboxId)),
        tx
          .select()
          .from(managedMailRule)
          .where(
            and(
              eq(managedMailRule.mailboxId, input.mailboxId),
              eq(managedMailRule.enabled, true),
              hasText(input.ruleId)
                ? eq(managedMailRule.id, input.ruleId)
                : undefined
            )
          )
          .orderBy(asc(managedMailRule.priority), asc(managedMailRule.name)),
        tx
          .select()
          .from(managedMailRuleApplication)
          .where(
            and(
              eq(managedMailRuleApplication.mailboxId, input.mailboxId),
              eq(managedMailRuleApplication.messageId, input.messageId)
            )
          ),
      ]);

    const applicationByRuleId = new Map(
      applications.map((application) => [application.ruleId, application])
    );
    const labelNameById = new Map(
      mailboxLabels.map((label) => [label.id, label.name])
    );
    const customLabelIds = new Set(labels.map((label) => label.labelId));
    const customLabelNames = new Set(
      labels.flatMap((label) => {
        const name = labelNameById.get(label.labelId);
        return hasText(name) ? [name] : [];
      })
    );
    return await processManagedRulesAtIndex({
      applicationByRuleId,
      attachments,
      customLabelIds,
      customLabelNames,
      index: 0,
      labelNameById,
      mailboxId: input.mailboxId,
      matchedRule: false,
      message,
      messageId: input.messageId,
      ruleError: null,
      rules,
      tx,
    });
  });
