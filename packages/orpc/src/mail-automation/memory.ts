import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  aiMemoryScopeConfig,
  gmailCapturedMessage,
  gmailLabel,
  mailAutoLabelFeedback,
  managedMailLabel,
  managedMailMessage,
  user,
} from "@quieter/database/schema";
import type {
  MailAutoLabelFeedbackSignal,
  PersistedMailboxProvider,
} from "@quieter/database/schema";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import { and, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  getPersonalAiMemoryScopeConfig,
  learnAiMemoryFromFeedback,
  replaceAiMemoryFeedback,
} from "../ai-memory";
import { assertAccessibleMailbox } from "../mailbox/service";

const SYSTEM_LABEL_IDS = new Set<string>(Object.values(MAILBOX_LABELS));

export type AutoLabelMemoryRule = {
  count: number;
  labelId: string;
  labelName: string | null;
  policy: "prefer" | "suppress";
  source: string | null;
};

export type AutoLabelMemoryProfile = {
  kind: "auto_label";
  rules: AutoLabelMemoryRule[];
};

export const getSenderSource = (from?: string | null) => {
  const address = extractMailAddress(from ?? "")
    .trim()
    .toLowerCase();
  return z.email().safeParse(address).success ? address : null;
};

const toMemoryKeyPart = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9._:-]+/gu, "-")
    .replaceAll(/-{2,}/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .slice(0, 80);

const listLabelNames = async (
  mailboxId: string,
  provider: PersistedMailboxProvider,
  labelIds: string[]
) => {
  const uniqueLabelIds = [...new Set(labelIds)];
  if (uniqueLabelIds.length === 0) {
    return new Map<string, string | null>();
  }

  const labels =
    provider === "gmail"
      ? await db
          .select({ id: gmailLabel.labelId, name: gmailLabel.name })
          .from(gmailLabel)
          .where(
            and(
              eq(gmailLabel.mailboxId, mailboxId),
              inArray(gmailLabel.labelId, uniqueLabelIds)
            )
          )
      : await db
          .select({ id: managedMailLabel.id, name: managedMailLabel.name })
          .from(managedMailLabel)
          .where(
            and(
              eq(managedMailLabel.mailboxId, mailboxId),
              inArray(managedMailLabel.id, uniqueLabelIds)
            )
          );

  return new Map(labels.map((label) => [label.id, label.name]));
};

const listManagedMessageSources = async (
  mailboxId: string,
  messageIds: string[]
) => {
  if (messageIds.length === 0) {
    return new Map<string, string | null>();
  }

  const rows = await db
    .select({
      from: managedMailMessage.from,
      id: managedMailMessage.id,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, mailboxId),
        inArray(managedMailMessage.id, [...new Set(messageIds)])
      )
    );

  return new Map(rows.map((row) => [row.id, getSenderSource(row.from)]));
};

const listGmailMessageSources = async (
  mailboxId: string,
  messageIds: string[]
) => {
  const rows = await db
    .select({
      headers: sql<
        CapturedMailSnapshot["headers"] | null
      >`${gmailCapturedMessage.snapshot}->'headers'`,
      id: gmailCapturedMessage.messageId,
    })
    .from(gmailCapturedMessage)
    .where(
      and(
        eq(gmailCapturedMessage.mailboxId, mailboxId),
        inArray(gmailCapturedMessage.messageId, messageIds),
        isNull(gmailCapturedMessage.deletedAt)
      )
    );
  return new Map(
    rows.map((row) => [
      row.id,
      getSenderSource(
        row.headers?.find((header) => header.name.toLowerCase() === "from")
          ?.value
      ),
    ])
  );
};

export const buildAutoLabelMemoryProfile = (
  rows: {
    added: number;
    labelId: string;
    labelName: string | null;
    removed: number;
    source: string | null;
  }[]
): AutoLabelMemoryProfile => {
  const rules = rows
    .map((row) => {
      const signal: MailAutoLabelFeedbackSignal =
        row.added >= row.removed ? "added" : "removed";
      const ruleCount = signal === "added" ? row.added : row.removed;

      if (ruleCount < 2 && row.source === null) {
        return null;
      }
      if (
        ruleCount === 0 ||
        ruleCount === (signal === "added" ? row.removed : row.added)
      ) {
        return null;
      }

      return {
        count: ruleCount,
        labelId: row.labelId,
        labelName: row.labelName,
        policy: signal === "added" ? "prefer" : "suppress",
        source: row.source,
      } satisfies AutoLabelMemoryRule;
    })
    .filter((rule): rule is AutoLabelMemoryRule => rule !== null)
    .toSorted((left, right) => {
      const sourceRank =
        Number(right.source !== null) - Number(left.source !== null);
      return (
        sourceRank ||
        right.count - left.count ||
        left.labelId.localeCompare(right.labelId)
      );
    });

  return { kind: "auto_label", rules };
};

export const refreshAutoLabelMemoryProfile = async (
  mailboxId: string,
  userId: string,
  expectedRevision?: number
) => {
  let revision = expectedRevision;
  if (revision === undefined) {
    ({ revision } = await getPersonalAiMemoryScopeConfig(userId));
  }
  const rows = await db
    .select({
      added:
        sql`${count()} filter (where ${eq(mailAutoLabelFeedback.signal, "added")})`.mapWith(
          Number
        ),
      labelId: mailAutoLabelFeedback.labelId,
      labelName: max(mailAutoLabelFeedback.labelName),
      removed:
        sql`${count()} filter (where ${eq(mailAutoLabelFeedback.signal, "removed")})`.mapWith(
          Number
        ),
      source: mailAutoLabelFeedback.source,
    })
    .from(mailAutoLabelFeedback)
    .where(
      and(
        eq(mailAutoLabelFeedback.mailboxId, mailboxId),
        eq(mailAutoLabelFeedback.createdByUserId, userId)
      )
    )
    .groupBy(mailAutoLabelFeedback.labelId, mailAutoLabelFeedback.source)
    .orderBy(desc(count()));

  const profile = buildAutoLabelMemoryProfile(rows);
  await replaceAiMemoryFeedback({
    agent: "auto_label",
    expectedRevision: revision,
    mailboxId,
    memories: profile.rules.map((rule) => {
      const label = rule.labelName ?? rule.labelId;
      const action =
        rule.policy === "prefer" ? "Prefer applying" : "Avoid applying";
      const scope = rule.source
        ? ` to messages from ${rule.source}`
        : " when it clearly matches";
      return {
        confidence: Math.min(0.98, 0.65 + rule.count * 0.08),
        content: `${action} the “${label}” label${scope}; learned from ${rule.count} manual correction${rule.count === 1 ? "" : "s"}.`,
        importance: rule.source ? 4 : 3,
        key: `${toMemoryKeyPart(rule.labelId)}:${toMemoryKeyPart(rule.source ?? "all")}`,
        metadata: {
          correspondents:
            rule.source?.includes("@") === true ? [rule.source] : [],
          feedbackSource: rule.source,
          labelId: rule.labelId,
          policy: rule.policy,
        },
        reinforcementCount: rule.count,
        sourceDomains: rule.source
          ? [rule.source.split("@").at(-1) ?? rule.source]
          : [],
        summary: `${rule.policy === "prefer" ? "Prefers" : "Avoids"} “${label}”${rule.source ? ` for ${rule.source}` : ""}`,
        topics: [
          "email-labeling",
          label,
          ...(rule.source ? [rule.source] : []),
        ],
      };
    }),
    userId,
  });
};

const refreshAutoLabelMemoryInBackground = async (
  mailboxId: string,
  userId: string,
  expectedRevision?: number
) => {
  try {
    await refreshAutoLabelMemoryProfile(mailboxId, userId, expectedRevision);
  } catch (error: unknown) {
    reportError(error, { operation: "mail-automation:refresh-memory" });
  }
};

export const enrichMailAutoLabelFeedbackSource = async (input: {
  from?: string;
  mailboxId: string;
  providerMessageId: string;
  userId: string;
}) => {
  const source = getSenderSource(input.from);
  if (source === null) {
    return;
  }
  const { getMailboxMemoryActor } = await import("../ai-memory-capture");
  const [actor, config] = await Promise.all([
    getMailboxMemoryActor({
      actorUserId: input.userId,
      mailboxId: input.mailboxId,
    }),
    getPersonalAiMemoryScopeConfig(input.userId),
  ]);
  if (actor === null) {
    return;
  }
  const enriched = await db
    .update(mailAutoLabelFeedback)
    .set({ source })
    .where(
      and(
        eq(mailAutoLabelFeedback.mailboxId, input.mailboxId),
        eq(mailAutoLabelFeedback.createdByUserId, input.userId),
        eq(mailAutoLabelFeedback.providerMessageId, input.providerMessageId),
        isNull(mailAutoLabelFeedback.source)
      )
    )
    .returning({ id: mailAutoLabelFeedback.id });
  if (enriched.length === 0) {
    const [existing] = await db
      .select({ id: mailAutoLabelFeedback.id })
      .from(mailAutoLabelFeedback)
      .where(
        and(
          eq(mailAutoLabelFeedback.mailboxId, input.mailboxId),
          eq(mailAutoLabelFeedback.createdByUserId, input.userId),
          eq(mailAutoLabelFeedback.providerMessageId, input.providerMessageId),
          eq(mailAutoLabelFeedback.source, source)
        )
      )
      .limit(1);
    if (existing === undefined) {
      return;
    }
  }
  await refreshAutoLabelMemoryProfile(
    input.mailboxId,
    actor.userId,
    config.revision
  );
};

const recordAutoLabelFeedbackMemoryInBackground = async (input: {
  addedLabels: string;
  mailboxId: string;
  messageCount: number;
  removedLabels: string;
  sources: string;
  userId: string;
}) => {
  try {
    await learnAiMemoryFromFeedback({
      kind: "auto_label_feedback",
      mailboxId: input.mailboxId,
      metadata: {
        addedLabels: input.addedLabels,
        messageCount: input.messageCount,
        removedLabels: input.removedLabels,
        sources: input.sources,
      },
      userId: input.userId,
    });
  } catch (error: unknown) {
    reportError(error, { operation: "mail-automation:learn-feedback" });
  }
};

export const recordMailAutoLabelFeedback = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  messageSources?: Record<string, string | null | undefined>;
  providerMessageIds: string[];
  removeLabelIds?: string[];
  userId: string;
}) => {
  const selectedMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const addLabelIds = (input.addLabelIds ?? []).filter(
    (labelId) => !SYSTEM_LABEL_IDS.has(labelId)
  );
  const removeLabelIds = (input.removeLabelIds ?? []).filter(
    (labelId) => !SYSTEM_LABEL_IDS.has(labelId)
  );
  const providerMessageIds = [...new Set(input.providerMessageIds)];

  if (
    providerMessageIds.length === 0 ||
    (addLabelIds.length === 0 && removeLabelIds.length === 0)
  ) {
    return null;
  }

  const config = await getPersonalAiMemoryScopeConfig(input.userId);
  if (!config.activeLearningEnabled) {
    return null;
  }

  const labelNames = await listLabelNames(
    input.mailboxId,
    selectedMailbox.provider,
    [...addLabelIds, ...removeLabelIds]
  );
  const sources =
    selectedMailbox.provider === "managed"
      ? await listManagedMessageSources(input.mailboxId, providerMessageIds)
      : await listGmailMessageSources(input.mailboxId, providerMessageIds);
  const sourceOverrides = new Map(Object.entries(input.messageSources ?? {}));
  const resolveSource = (providerMessageId: string) =>
    sourceOverrides.has(providerMessageId)
      ? (sourceOverrides.get(providerMessageId) ?? null)
      : (sources.get(providerMessageId) ?? null);
  const now = new Date();
  const values = providerMessageIds.flatMap((providerMessageId) => [
    ...addLabelIds.map((labelId) => ({
      createdAt: now,
      createdByUserId: input.userId,
      id: randomUUID(),
      labelId,
      labelName: labelNames.get(labelId) ?? null,
      mailboxId: input.mailboxId,
      provider: selectedMailbox.provider,
      providerMessageId,
      signal: "added" as const,
      source: resolveSource(providerMessageId),
      updatedAt: now,
    })),
    ...removeLabelIds.map((labelId) => ({
      createdAt: now,
      createdByUserId: input.userId,
      id: randomUUID(),
      labelId,
      labelName: labelNames.get(labelId) ?? null,
      mailboxId: input.mailboxId,
      provider: selectedMailbox.provider,
      providerMessageId,
      signal: "removed" as const,
      source: resolveSource(providerMessageId),
      updatedAt: now,
    })),
  ]);

  const captured = await db.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    const [currentConfig = { activeLearningEnabled: true, revision: 0 }] =
      await tx
        .select({
          activeLearningEnabled: aiMemoryScopeConfig.activeLearningEnabled,
          revision: aiMemoryScopeConfig.revision,
        })
        .from(aiMemoryScopeConfig)
        .where(eq(aiMemoryScopeConfig.scopeKey, `user:${input.userId}`))
        .for("share");
    if (
      !currentConfig.activeLearningEnabled ||
      currentConfig.revision !== config.revision
    ) {
      return false;
    }
    await tx
      .insert(mailAutoLabelFeedback)
      .values(values)
      .onConflictDoUpdate({
        set: {
          createdByUserId: input.userId,
          labelName: alias(mailAutoLabelFeedback, "excluded").labelName,
          signal: alias(mailAutoLabelFeedback, "excluded").signal,
          source: alias(mailAutoLabelFeedback, "excluded").source,
          updatedAt: now,
        },
        target: [
          mailAutoLabelFeedback.mailboxId,
          mailAutoLabelFeedback.providerMessageId,
          mailAutoLabelFeedback.labelId,
        ],
      });
    return true;
  });
  if (!captured) {
    return null;
  }

  const labelChanges = {
    addedLabels: addLabelIds
      .map((labelId) => labelNames.get(labelId) ?? labelId)
      .join(", ")
      .slice(0, 600),
    removedLabels: removeLabelIds
      .map((labelId) => labelNames.get(labelId) ?? labelId)
      .join(", ")
      .slice(0, 600),
  };
  await refreshAutoLabelMemoryInBackground(
    input.mailboxId,
    input.userId,
    config.revision
  );
  await recordAutoLabelFeedbackMemoryInBackground({
    ...labelChanges,
    mailboxId: input.mailboxId,
    messageCount: providerMessageIds.length,
    sources: [
      ...new Set(
        providerMessageIds.map((providerMessageId) =>
          resolveSource(providerMessageId)
        )
      ),
    ]
      .filter((source): source is string => !!source)
      .join(", ")
      .slice(0, 600),
    userId: input.userId,
  });
  return labelChanges;
};
