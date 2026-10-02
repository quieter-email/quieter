import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  managedMailRule,
  managedMailRuleApplication,
  managedMailRuleRun,
} from "@quieter/database/schema";
import { composeMessageInputSchema } from "@quieter/mail/compose/schema";
import { managedMailboxRuleConditionGroupSchema } from "@quieter/mail/mailbox-organization";
import type { ManagedMailboxRuleAction } from "@quieter/mail/mailbox-organization";
import { parseRawMailAttachments } from "@quieter/mail/raw-message";
import { structuredMailSearchSchema } from "@quieter/mail/search";
import { reportError } from "@quieter/observability";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { updateManagedMessageLabelAssignments } from "../labels/repository";
import { readRawMailObject } from "../messages/raw-object";
import { sendManagedMailboxMessage } from "../messages/send";
import { matchesManagedMailRule } from "../search/evaluator";
import { managedRuleSnapshotSchema, snapshotManagedRule } from "./snapshot";
import type { ManagedRuleSnapshot } from "./snapshot";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;
type ManagedAttachmentRecord = Pick<
  typeof managedMailAttachment.$inferSelect,
  "fileName" | "normalizedFileName"
>;
const actionResultsSchema = z.array(
  z.object({
    kind: z.enum([
      "set-read",
      "move",
      "set-labels",
      "forward",
      "stop-processing",
    ]),
    message: z.string().optional(),
    status: z.enum(["applied", "skipped"]),
  })
);
type ActionResults = z.infer<typeof actionResultsSchema>;

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
    .parse(input.conditionGroups ?? []);
  if (groups.length === 0) {
    return mainMatch;
  }

  return (
    mainMatch &&
    groups.every((group) =>
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
  action: Extract<ManagedMailboxRuleAction, { kind: "forward" }>;
  localId: string;
  message: ManagedMessageRecord;
  ruleId: string;
}) => {
  const subject = input.message.subject?.trim() || "(No subject)";
  const text = (input.message.bodyText ?? input.message.snippet ?? "").trim();
  const [escapedFrom, escapedSubject, escapedText] = [
    input.message.from,
    subject,
    text,
  ].map((value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
  );
  const attachments: z.infer<typeof composeMessageInputSchema>["attachments"] =
    [];
  const inlineImages: z.infer<
    typeof composeMessageInputSchema
  >["inlineImages"] = [];
  const originalAttachments = input.action.includeAttachments
    ? await parseRawMailAttachments(await readRawMailObject(input.message))
    : [];
  for (const [index, attachment] of originalAttachments.entries()) {
    const file = new File(
      [Uint8Array.from(attachment.content).buffer],
      attachment.fileName,
      { type: attachment.mimeType }
    );
    const metadata = {
      file,
      id: `${input.localId}:${index}`,
      mimeType: attachment.mimeType,
      name: attachment.fileName,
      size: file.size,
    };
    if (attachment.inline && attachment.contentId) {
      inlineImages.push({
        ...metadata,
        contentId: attachment.contentId,
        isInline: true,
      });
    } else {
      attachments.push({ ...metadata, isInline: false });
    }
  }
  return composeMessageInputSchema.parse({
    attachments,
    bodyHtml: `<p>---------- Forwarded message ----------</p><p><strong>From:</strong> ${escapedFrom}<br><strong>Subject:</strong> ${escapedSubject}</p>${input.message.bodyHtml?.trim() || `<p>${escapedText.replaceAll("\n", "<br>")}</p>`}`,
    bodyText: [
      "---------- Forwarded message ----------",
      `From: ${input.message.from}`,
      `Subject: ${subject}`,
      "",
      text,
    ].join("\n"),
    headers: [{ name: "X-Quieter-Rule-Forwarded", value: input.ruleId }],
    inlineImages,
    localId: input.localId,
    recipients: { bcc: "", cc: "", to: input.action.recipients.join(", ") },
    replyContext: null,
    saveStatus: "idle",
    subject: subject.toLowerCase().startsWith("fwd:")
      ? subject
      : `Fwd: ${subject}`,
    updatedAt: Date.now(),
  });
};

const prepareRuleRun = async (input: {
  mailboxId: string;
  messageId: string;
  reapply: boolean;
  rule: ManagedRuleSnapshot;
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
      .for("update");
    if (message === undefined || message.direction !== "inbound") {
      return null;
    }
    const [existing] = await tx
      .select()
      .from(managedMailRuleRun)
      .where(
        and(
          eq(managedMailRuleRun.ruleId, input.rule.id),
          eq(managedMailRuleRun.messageId, input.messageId),
          input.reapply
            ? eq(managedMailRuleRun.revision, input.rule.revision)
            : undefined
        )
      )
      .orderBy(asc(managedMailRuleRun.createdAt))
      .limit(1);
    if (existing !== undefined) {
      return existing;
    }

    // Historical applications have no immutable send identity. Never replay an uncertain forward.
    const [legacy] = await tx
      .select()
      .from(managedMailRuleApplication)
      .where(
        and(
          eq(managedMailRuleApplication.ruleId, input.rule.id),
          eq(managedMailRuleApplication.messageId, input.messageId)
        )
      )
      .limit(1);
    if (legacy !== undefined) {
      if (legacy.error) {
        throw new ORPCError("CONFLICT", {
          message:
            "An earlier rule attempt needs review before this message can be processed again.",
        });
      }
      if (!input.reapply) {
        return {
          legacyMatched: legacy.matched,
          legacyStop:
            legacy.matched &&
            actionResultsSchema
              .parse(legacy.actionResults ?? [])
              .some((result) => result.kind === "stop-processing"),
        };
      }
    }
    const attachments = await tx
      .select({
        fileName: managedMailAttachment.fileName,
        normalizedFileName: managedMailAttachment.normalizedFileName,
      })
      .from(managedMailAttachment)
      .where(eq(managedMailAttachment.messageId, input.messageId));
    const labels = await tx
      .select({
        id: managedMailLabel.id,
        name: managedMailLabel.normalizedName,
      })
      .from(managedMailMessageLabel)
      .innerJoin(
        managedMailLabel,
        eq(managedMailLabel.id, managedMailMessageLabel.labelId)
      )
      .where(eq(managedMailMessageLabel.messageId, input.messageId));
    const matched = matchesRuleConditions({
      attachments,
      conditionGroups: input.rule.conditionGroups,
      customLabelIds: labels.map((label) => label.id),
      customLabelNames: labels.map((label) => label.name),
      matchMode: input.rule.matchMode,
      message,
      search: input.rule.search,
    });
    const now = new Date();
    const [run] = await tx
      .insert(managedMailRuleRun)
      .values({
        actionResults: [],
        completedAt: matched ? null : now,
        createdAt: now,
        definition: input.rule,
        id: randomUUID(),
        mailboxId: input.mailboxId,
        matched,
        messageId: input.messageId,
        revision: input.rule.revision,
        ruleId: input.rule.id,
        updatedAt: now,
      })
      .returning();
    return run;
  });

type PendingForward = {
  action: Extract<ManagedMailboxRuleAction, { kind: "forward" }>;
  actionResults: ActionResults;
  message: ManagedMessageRecord;
  ownerUserId: string | null;
  ruleId: string;
};

const advanceRuleRun = async (
  run: typeof managedMailRuleRun.$inferSelect
): Promise<PendingForward | null> =>
  await db.transaction(async (tx) => {
    const [message] = await tx
      .select()
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.id, run.messageId),
          eq(managedMailMessage.mailboxId, run.mailboxId)
        )
      )
      .for("update");
    if (message === undefined) {
      return null;
    }
    const [current] = await tx
      .select()
      .from(managedMailRuleRun)
      .where(eq(managedMailRuleRun.id, run.id));
    if (current === undefined || current.completedAt !== null) {
      return null;
    }
    const [rule] = await tx
      .select({ enabled: managedMailRule.enabled })
      .from(managedMailRule)
      .where(
        and(
          eq(managedMailRule.id, run.ruleId),
          eq(managedMailRule.mailboxId, run.mailboxId)
        )
      );
    if (!rule?.enabled) {
      throw new ORPCError("CONFLICT", {
        message:
          "This rule was disabled before its remaining actions finished.",
      });
    }
    const definition = managedRuleSnapshotSchema.parse(current.definition);
    const results = actionResultsSchema.parse(current.actionResults);
    if (
      results.some(
        (result, index) => result.kind !== definition.actions[index]?.kind
      )
    ) {
      throw new Error("Stored rule results do not match their definition.");
    }
    let forward: PendingForward | null = null;
    let changed = false;
    for (const action of definition.actions.slice(results.length)) {
      if (action.kind === "forward") {
        if (
          message.headers.some(
            (header) => header.name.toLowerCase() === "x-quieter-rule-forwarded"
          )
        ) {
          results.push({
            kind: action.kind,
            message:
              "Skipped a message already forwarded by an automatic rule.",
            status: "skipped",
          });
          continue;
        }
        forward = {
          action,
          actionResults: [...results],
          message,
          ownerUserId: definition.ownerUserId,
          ruleId: definition.id,
        };
        break;
      }
      if (action.kind === "set-read") {
        await tx
          .update(managedMailMessage)
          .set({ isRead: action.read, updatedAt: new Date() })
          .where(eq(managedMailMessage.id, message.id));
        message.isRead = action.read;
        changed = true;
      } else if (action.kind === "move") {
        const mailboxState = (
          {
            archive: "archived",
            inbox: "active",
            spam: "spam",
            trash: "trash",
          } as const
        )[action.destination];
        await tx
          .update(managedMailMessage)
          .set({ mailboxState, updatedAt: new Date() })
          .where(eq(managedMailMessage.id, message.id));
        message.mailboxState = mailboxState;
        changed = true;
      } else if (action.kind === "set-labels") {
        await updateManagedMessageLabelAssignments({
          addLabelIds: action.addIds,
          database: tx,
          mailboxId: run.mailboxId,
          messageIds: [message.id],
          removeLabelIds: action.removeIds,
          ruleId: run.ruleId,
          source: "rule",
        });
        changed = true;
      }
      results.push({ kind: action.kind, status: "applied" });
      if (action.kind === "stop-processing") {
        break;
      }
    }
    await tx
      .update(managedMailRuleRun)
      .set({
        actionResults: results,
        completedAt: forward === null ? new Date() : null,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(managedMailRuleRun.id, run.id));
    if (changed) {
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, run.mailboxId));
    }
    return forward;
  });

export const applyManagedRulesToMessage = async (input: {
  mailboxId: string;
  messageId: string;
  ruleId?: string;
  snapshot?: ManagedRuleSnapshot;
}) => {
  let rules: ManagedRuleSnapshot[];
  if (input.snapshot === undefined) {
    const records = await db
      .select()
      .from(managedMailRule)
      .where(
        and(
          eq(managedMailRule.mailboxId, input.mailboxId),
          eq(managedMailRule.enabled, true),
          input.ruleId ? eq(managedMailRule.id, input.ruleId) : undefined
        )
      )
      .orderBy(asc(managedMailRule.priority), asc(managedMailRule.name));
    rules = records.map(snapshotManagedRule);
  } else {
    rules = [input.snapshot];
  }
  let matched = false;
  for (const rule of rules) {
    let run: typeof managedMailRuleRun.$inferSelect | undefined;
    try {
      const prepared = await prepareRuleRun({
        ...input,
        reapply: input.ruleId !== undefined,
        rule,
      });
      if (prepared === null) {
        continue;
      }
      if ("legacyMatched" in prepared) {
        matched ||= prepared.legacyMatched;
        if (prepared.legacyStop) {
          break;
        }
        continue;
      }
      run = prepared;
      if (!run.matched) {
        continue;
      }
      matched = true;
      while (true) {
        const forward = await advanceRuleRun(run);
        if (forward === null) {
          break;
        }
        if (forward.ownerUserId === null) {
          throw new ORPCError("CONFLICT", {
            message:
              "The rule owner is no longer available to send an automatic forward.",
          });
        }
        await sendManagedMailboxMessage({
          mailboxId: input.mailboxId,
          message: await createForwardMessage({
            action: forward.action,
            localId: `rule:${run.id}:${forward.actionResults.length}`,
            message: forward.message,
            ruleId: forward.ruleId,
          }),
          userId: forward.ownerUserId,
        });
        await db
          .update(managedMailRuleRun)
          .set({
            actionResults: [
              ...forward.actionResults,
              { kind: "forward", status: "applied" },
            ],
            error: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managedMailRuleRun.id, run.id),
              sql`${managedMailRuleRun.actionResults} = ${JSON.stringify(forward.actionResults)}::jsonb`
            )
          );
      }
      if (
        managedRuleSnapshotSchema
          .parse(run.definition)
          .actions.some((action) => action.kind === "stop-processing")
      ) {
        break;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Rule execution failed.";
      if (run !== undefined) {
        await db
          .update(managedMailRuleRun)
          .set({ error: message.slice(0, 2000), updatedAt: new Date() })
          .where(
            and(
              eq(managedMailRuleRun.id, run.id),
              isNull(managedMailRuleRun.completedAt)
            )
          );
      }
      if (
        !(error instanceof ORPCError) ||
        error.code === "INTERNAL_SERVER_ERROR"
      ) {
        reportError(error, { operation: "managed-mail:apply-rules" });
      }
      return { error: message, matched };
    }
  }
  return { error: null, matched };
};
