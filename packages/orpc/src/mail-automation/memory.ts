import { db } from "@quieter/database/client";
import {
  gmailLabel,
  gmailUsefulDetailFeedback,
  mailAutomationMemoryProfile,
  mailAutoLabelFeedback,
  managedMailLabel,
  managedMailMessage,
  mailbox,
  type MailAutomationAgent,
  type MailAutoLabelFeedbackSignal,
  type MailboxProvider,
} from "@quieter/database/schema";
import { MAILBOX_LABELS } from "@quieter/gmail";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { recordAndRefreshUserAiContext } from "../user-ai-context";

const AUTOMATION_MEMORY_PROMPT_BUDGET = 900;
const AUTO_LABEL_CORRECTION_PROMPT_BUDGET = 1_200;
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

export type AutoLabelUserCorrection = {
  count: number;
  labelId: string;
  labelName: string | null;
  signal: MailAutoLabelFeedbackSignal;
  source: string | null;
};

export type AutoLabelUserCorrectionContext = {
  corrections: AutoLabelUserCorrection[];
  kind: "auto_label_user_corrections";
};

export type UsefulDetailMemoryRule = {
  count: number;
  kind: string;
  policy: "prefer" | "suppress";
  source: string | null;
};

export type UsefulDetailMemoryProfile = {
  kind: "useful_detail";
  rules: UsefulDetailMemoryRule[];
};

const serializeProfile = (profile: object) => JSON.stringify(profile);

const trimAutoLabelProfileToBudget = (profile: AutoLabelMemoryProfile): AutoLabelMemoryProfile => {
  const rules = [...profile.rules];

  while (
    rules.length > 0 &&
    serializeProfile({ ...profile, rules }).length > AUTOMATION_MEMORY_PROMPT_BUDGET
  ) {
    rules.pop();
  }

  return { ...profile, rules };
};

const trimAutoLabelCorrectionContextToBudget = (
  context: AutoLabelUserCorrectionContext,
): AutoLabelUserCorrectionContext => {
  const corrections = [...context.corrections];

  while (
    corrections.length > 0 &&
    serializeProfile({ ...context, corrections }).length > AUTO_LABEL_CORRECTION_PROMPT_BUDGET
  ) {
    corrections.pop();
  }

  return { ...context, corrections };
};

const trimUsefulDetailProfileToBudget = (
  profile: UsefulDetailMemoryProfile,
): UsefulDetailMemoryProfile => {
  const rules = [...profile.rules];

  while (
    rules.length > 0 &&
    serializeProfile({ ...profile, rules }).length > AUTOMATION_MEMORY_PROMPT_BUDGET
  ) {
    rules.pop();
  }

  return { ...profile, rules };
};

const upsertMemoryProfile = async (
  mailboxId: string,
  agent: MailAutomationAgent,
  profile: AutoLabelMemoryProfile | UsefulDetailMemoryProfile,
) => {
  const now = new Date();
  await db
    .insert(mailAutomationMemoryProfile)
    .values({
      agent,
      createdAt: now,
      id: randomUUID(),
      lastMergedAt: now,
      mailboxId,
      profile,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        lastMergedAt: now,
        profile,
        revision: sql`${mailAutomationMemoryProfile.revision} + 1`,
        updatedAt: now,
      },
      target: [mailAutomationMemoryProfile.mailboxId, mailAutomationMemoryProfile.agent],
    });
};

export const loadAutomationMemoryPrompt = async (input: {
  agent: MailAutomationAgent;
  mailboxId: string;
}) => {
  const [record] = await db
    .select({ profile: mailAutomationMemoryProfile.profile })
    .from(mailAutomationMemoryProfile)
    .where(
      and(
        eq(mailAutomationMemoryProfile.mailboxId, input.mailboxId),
        eq(mailAutomationMemoryProfile.agent, input.agent),
      ),
    )
    .limit(1);
  if (!record) return null;

  const serialized = JSON.stringify(record.profile);
  return serialized.length <= AUTOMATION_MEMORY_PROMPT_BUDGET ? serialized : null;
};

export const buildAutoLabelUserCorrectionContext = (
  rows: Array<{
    labelId: string;
    labelName: string | null;
    signal: MailAutoLabelFeedbackSignal;
    source: string | null;
  }>,
): AutoLabelUserCorrectionContext => {
  const correctionsByKey = new Map<string, AutoLabelUserCorrection>();

  for (const row of rows) {
    const key = JSON.stringify([row.labelId, row.signal, row.source]);
    const existing = correctionsByKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    correctionsByKey.set(key, {
      count: 1,
      labelId: row.labelId,
      labelName: row.labelName,
      signal: row.signal,
      source: row.source,
    });
  }

  return trimAutoLabelCorrectionContextToBudget({
    corrections: Array.from(correctionsByKey.values()),
    kind: "auto_label_user_corrections",
  });
};

export const loadAutoLabelUserCorrectionPrompt = async (mailboxId: string) => {
  const rows = await db
    .select({
      labelId: mailAutoLabelFeedback.labelId,
      labelName: mailAutoLabelFeedback.labelName,
      signal: mailAutoLabelFeedback.signal,
      source: mailAutoLabelFeedback.source,
    })
    .from(mailAutoLabelFeedback)
    .where(eq(mailAutoLabelFeedback.mailboxId, mailboxId))
    .orderBy(desc(mailAutoLabelFeedback.updatedAt))
    .limit(40);

  const context = buildAutoLabelUserCorrectionContext(rows);
  if (context.corrections.length === 0) return null;

  const serialized = JSON.stringify(context);
  return serialized.length <= AUTO_LABEL_CORRECTION_PROMPT_BUDGET ? serialized : null;
};

const listLabelNames = async (mailboxId: string, provider: MailboxProvider, labelIds: string[]) => {
  const uniqueLabelIds = Array.from(new Set(labelIds));
  if (uniqueLabelIds.length === 0) return new Map<string, string | null>();

  const labels =
    provider === "gmail"
      ? await db
          .select({ id: gmailLabel.labelId, name: gmailLabel.name })
          .from(gmailLabel)
          .where(
            and(eq(gmailLabel.mailboxId, mailboxId), inArray(gmailLabel.labelId, uniqueLabelIds)),
          )
      : await db
          .select({ id: managedMailLabel.id, name: managedMailLabel.name })
          .from(managedMailLabel)
          .where(
            and(
              eq(managedMailLabel.mailboxId, mailboxId),
              inArray(managedMailLabel.id, uniqueLabelIds),
            ),
          );

  return new Map(labels.map((label) => [label.id, label.name]));
};

const listManagedMessageSources = async (mailboxId: string, messageIds: string[]) => {
  if (messageIds.length === 0) return new Map<string, string | null>();

  const rows = await db
    .select({
      from: managedMailMessage.from,
      id: managedMailMessage.id,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, mailboxId),
        inArray(managedMailMessage.id, Array.from(new Set(messageIds))),
      ),
    );

  return new Map(rows.map((row) => [row.id, getSenderSource(row.from)]));
};

export const recordMailAutoLabelFeedback = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  messageSources?: Record<string, string | null | undefined>;
  providerMessageIds: string[];
  removeLabelIds?: string[];
  userId: string;
}) => {
  const addLabelIds = Array.from(new Set(input.addLabelIds ?? [])).filter(
    (labelId) => !SYSTEM_LABEL_IDS.has(labelId),
  );
  const removeLabelIds = Array.from(new Set(input.removeLabelIds ?? [])).filter(
    (labelId) => !SYSTEM_LABEL_IDS.has(labelId),
  );
  const providerMessageIds = Array.from(new Set(input.providerMessageIds));

  if (
    providerMessageIds.length === 0 ||
    (addLabelIds.length === 0 && removeLabelIds.length === 0)
  ) {
    return;
  }

  const [selectedMailbox] = await db
    .select({ provider: mailbox.provider })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (!selectedMailbox) return;

  const labelNames = await listLabelNames(input.mailboxId, selectedMailbox.provider, [
    ...addLabelIds,
    ...removeLabelIds,
  ]);
  const sources =
    selectedMailbox.provider === "managed"
      ? await listManagedMessageSources(input.mailboxId, providerMessageIds)
      : new Map<string, string | null>();
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

  await db
    .insert(mailAutoLabelFeedback)
    .values(values)
    .onConflictDoUpdate({
      set: {
        createdByUserId: input.userId,
        labelName: sql`excluded."labelName"`,
        signal: sql`excluded."signal"`,
        source: sql`excluded."source"`,
        updatedAt: now,
      },
      target: [
        mailAutoLabelFeedback.mailboxId,
        mailAutoLabelFeedback.providerMessageId,
        mailAutoLabelFeedback.labelId,
      ],
    });
  await refreshAutoLabelMemoryProfile(input.mailboxId);
  void recordAndRefreshUserAiContext({
    kind: "auto_label_feedback",
    mailboxId: input.mailboxId,
    metadata: {
      addedLabels: addLabelIds
        .map((labelId) => labelNames.get(labelId) ?? labelId)
        .join(", ")
        .slice(0, 600),
      messageCount: providerMessageIds.length,
      removedLabels: removeLabelIds
        .map((labelId) => labelNames.get(labelId) ?? labelId)
        .join(", ")
        .slice(0, 600),
      sources: Array.from(
        new Set(providerMessageIds.map((providerMessageId) => resolveSource(providerMessageId))),
      )
        .filter(Boolean)
        .join(", ")
        .slice(0, 600),
    },
    userId: input.userId,
  }).catch((error) => {
    console.error("Could not refresh user AI context from auto-label feedback.", error);
  });
};

export const buildAutoLabelMemoryProfile = (
  rows: Array<{
    added: number;
    labelId: string;
    labelName: string | null;
    removed: number;
    source: string | null;
  }>,
): AutoLabelMemoryProfile => {
  const rules = rows
    .map((row) => {
      const signal: MailAutoLabelFeedbackSignal = row.added >= row.removed ? "added" : "removed";
      const count = signal === "added" ? row.added : row.removed;

      if (count < 2 && row.source === null) return null;
      if (count === 0 || count === (signal === "added" ? row.removed : row.added)) return null;

      return {
        count,
        labelId: row.labelId,
        labelName: row.labelName,
        policy: signal === "added" ? "prefer" : "suppress",
        source: row.source,
      } satisfies AutoLabelMemoryRule;
    })
    .filter((rule): rule is AutoLabelMemoryRule => !!rule)
    .sort((left, right) => {
      const sourceRank = Number(right.source !== null) - Number(left.source !== null);
      return sourceRank || right.count - left.count || left.labelId.localeCompare(right.labelId);
    });

  return trimAutoLabelProfileToBudget({ kind: "auto_label", rules });
};

export const refreshAutoLabelMemoryProfile = async (mailboxId: string) => {
  const rows = await db
    .select({
      added: sql<number>`count(*) filter (where ${mailAutoLabelFeedback.signal} = 'added')`,
      labelId: mailAutoLabelFeedback.labelId,
      labelName: sql<string | null>`max(${mailAutoLabelFeedback.labelName})`,
      removed: sql<number>`count(*) filter (where ${mailAutoLabelFeedback.signal} = 'removed')`,
      source: mailAutoLabelFeedback.source,
    })
    .from(mailAutoLabelFeedback)
    .where(eq(mailAutoLabelFeedback.mailboxId, mailboxId))
    .groupBy(mailAutoLabelFeedback.labelId, mailAutoLabelFeedback.source)
    .orderBy(desc(count()));

  await upsertMemoryProfile(
    mailboxId,
    "auto_label",
    buildAutoLabelMemoryProfile(
      rows.map((row) => ({
        ...row,
        added: Number(row.added),
        removed: Number(row.removed),
      })),
    ),
  );
};

export const buildUsefulDetailMemoryProfile = (
  rows: Array<{
    kind: string;
    notUseful: number;
    source: string | null;
    useful: number;
  }>,
): UsefulDetailMemoryProfile => {
  const rules = rows
    .map((row) => {
      const suppress = row.notUseful > row.useful;
      const count = suppress ? row.notUseful : row.useful;

      if (count < 2 && row.source === null) return null;
      if (count === 0 || row.notUseful === row.useful) return null;

      return {
        count,
        kind: row.kind,
        policy: suppress ? "suppress" : "prefer",
        source: row.source,
      } satisfies UsefulDetailMemoryRule;
    })
    .filter((rule): rule is UsefulDetailMemoryRule => !!rule)
    .sort((left, right) => {
      const sourceRank = Number(right.source !== null) - Number(left.source !== null);
      return sourceRank || right.count - left.count || left.kind.localeCompare(right.kind);
    });

  return trimUsefulDetailProfileToBudget({ kind: "useful_detail", rules });
};

export const refreshUsefulDetailMemoryProfile = async (mailboxId: string) => {
  const rows = await db
    .select({
      kind: gmailUsefulDetailFeedback.kind,
      notUseful: sql<number>`count(*) filter (where ${gmailUsefulDetailFeedback.signal} = 'not_useful')`,
      source: gmailUsefulDetailFeedback.source,
      useful: sql<number>`count(*) filter (where ${gmailUsefulDetailFeedback.signal} = 'useful')`,
    })
    .from(gmailUsefulDetailFeedback)
    .where(eq(gmailUsefulDetailFeedback.mailboxId, mailboxId))
    .groupBy(gmailUsefulDetailFeedback.kind, gmailUsefulDetailFeedback.source)
    .orderBy(desc(count()));

  await upsertMemoryProfile(
    mailboxId,
    "useful_detail",
    buildUsefulDetailMemoryProfile(
      rows.map((row) => ({
        ...row,
        notUseful: Number(row.notUseful),
        useful: Number(row.useful),
      })),
    ),
  );
};

export const getSenderSource = (from?: string | null) => {
  const domain = from?.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1];
  return domain?.toLowerCase().slice(0, 253) ?? null;
};
