import { randomUUID } from "node:crypto";

import { AI_MEMORY_CONTENT_MAX_LENGTH } from "@quieter/ai/ai-memory";
import { db } from "@quieter/database/client";
import {
  aiMemory,
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

export const groupAutoLabelMemoryRules = (rules: AutoLabelMemoryRule[]) => {
  const groups = new Map<string, AutoLabelMemoryRule[]>();
  for (const rule of rules) {
    let sourceKind = "global";
    if (rule.source !== null) {
      sourceKind = rule.source.includes("@") ? "correspondent" : "domain";
    }
    const key = JSON.stringify([rule.labelId, rule.policy, sourceKind]);
    const group = groups.get(key) ?? [];
    group.push(rule);
    groups.set(key, group);
  }
  const memories: Parameters<typeof replaceAiMemoryFeedback>[0]["memories"] =
    [];
  for (const [groupKey, group] of [...groups].toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    let chunk: AutoLabelMemoryRule[] = [];
    let chunkIndex = 0;
    const emit = () => {
      const [first] = chunk;
      if (first === undefined) {
        return;
      }
      const label = first.labelName ?? first.labelId;
      const sources = chunk.flatMap(({ source }) =>
        source === null ? [] : [source]
      );
      const content = `${first.policy === "prefer" ? "Prefer applying" : "Avoid applying"} the “${label}” label${sources.length > 0 ? ` to messages from ${sources.join(", ")}` : " when it clearly matches"}.`;
      if (content.length > AI_MEMORY_CONTENT_MAX_LENGTH) {
        throw new Error("A label rule exceeds the memory content limit.");
      }
      const reinforcementCount = chunk.reduce(
        (total, rule) => total + rule.count,
        0
      );
      memories.push({
        confidence: Math.min(
          ...chunk.map((rule) => Math.min(0.98, 0.65 + rule.count * 0.08))
        ),
        content,
        importance: sources.length > 0 ? 4 : 3,
        key: JSON.stringify([groupKey, chunkIndex]),
        metadata: {
          correspondents: sources.filter((source) => source.includes("@")),
          feedbackMembers: chunk.map(({ labelId, policy, source }) => ({
            labelId,
            policy,
            source,
          })),
          labelId: first.labelId,
          policy: first.policy,
        },
        reinforcementCount,
        sourceDomains: [
          ...new Set(
            sources.map((source) => source.split("@").at(-1) ?? source)
          ),
        ],
        summary: `${first.policy === "prefer" ? "Prefers" : "Avoids"} “${label}”${sources.length > 0 ? " for selected senders" : ""}`,
        topics: ["email-labeling", label],
      });
      chunkIndex += 1;
    };
    for (const rule of group.toSorted((left, right) =>
      (left.source ?? "").localeCompare(right.source ?? "")
    )) {
      const next = [...chunk, rule];
      const sources = next.flatMap(({ source }) =>
        source === null ? [] : [source]
      );
      const label = rule.labelName ?? rule.labelId;
      const content = `${rule.policy === "prefer" ? "Prefer applying" : "Avoid applying"} the “${label}” label${sources.length > 0 ? ` to messages from ${sources.join(", ")}` : " when it clearly matches"}.`;
      if (
        chunk.length > 0 &&
        (content.length > AI_MEMORY_CONTENT_MAX_LENGTH ||
          sources.filter((source) => source.includes("@")).length > 20)
      ) {
        emit();
        chunk = [];
      }
      chunk.push(rule);
    }
    emit();
  }
  return memories;
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

  const explicit = await db
    .select({ metadata: aiMemory.metadata })
    .from(aiMemory)
    .where(
      and(
        eq(aiMemory.userId, userId),
        eq(aiMemory.scopeKey, `user:${userId}`),
        eq(aiMemory.source, "explicit"),
        eq(sql`${aiMemory.metadata}->>'sourceMailboxId'`, mailboxId)
      )
    );
  const protectedMembers = explicit.flatMap(({ metadata }) => {
    if (metadata.feedbackMembers) {
      return metadata.feedbackMembers;
    }
    if (
      typeof metadata.labelId === "string" &&
      "feedbackSource" in metadata &&
      (typeof metadata.feedbackSource === "string" ||
        metadata.feedbackSource === null)
    ) {
      return [
        {
          labelId: metadata.labelId,
          policy:
            metadata.policy === "suppress"
              ? ("suppress" as const)
              : ("prefer" as const),
          source: metadata.feedbackSource,
        },
      ];
    }
    return [];
  });
  const profile = buildAutoLabelMemoryProfile(rows);
  await replaceAiMemoryFeedback({
    agent: "auto_label",
    expectedRevision: revision,
    mailboxId,
    memories: groupAutoLabelMemoryRules(
      profile.rules.filter(
        (rule) =>
          !protectedMembers.some(
            (member) =>
              member.labelId === rule.labelId && member.source === rule.source
          )
      )
    ),
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
  return labelChanges;
};
