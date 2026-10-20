import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { generateDailyBrief } from "@quieter/ai/daily-brief";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import {
  dailyBriefEdition,
  dailyBriefFeedback,
  dailyBriefSettings,
} from "@quieter/database/schema";
import type { DailyBriefItem, DailyBriefView } from "@quieter/mail/daily-brief";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { assertCanUseAi } from "./ai-access";
import {
  learnAiMemoryFromMailAction,
  loadAiAgentContext,
  loadAiAgentMemoryCandidates,
  serializeAiAgentContext,
} from "./ai-memory";
import {
  dailyBriefLocalClock,
  nextDailyBriefRun,
} from "./daily-brief-schedule";
import type { MailRequestContext } from "./gmail-request";
import { queriesMailOperations } from "./mail/queries";
import { assertAccessibleMailbox } from "./mailbox/service";

const mailboxInput = z.strictObject({
  mailboxId: z.string().trim().min(1).max(500),
});
const timeZoneInput = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      return (
        new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
          .timeZone.length > 0
      );
    } catch {
      return false;
    }
  }, "Choose a valid timezone.");
export const dailyBriefInputs = {
  activity: mailboxInput.extend({ timeZone: timeZoneInput.optional() }),
  configure: mailboxInput.extend({
    cadence: z.enum(["daily", "weekly"]).optional(),
    enabled: z.boolean(),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    scheduleEnabled: z.boolean(),
    timeZone: timeZoneInput,
    weekday: z.number().int().min(0).max(6).optional(),
  }),
  feedback: mailboxInput.extend({
    action: z.enum(["not_important", "dismiss", "defer"]),
    deferUntil: z.iso.datetime().optional(),
    itemId: z.string().min(1).max(500),
    preference: z.string().trim().max(1000).optional(),
  }),
  get: mailboxInput,
  observe: mailboxInput.extend({
    action: z.enum(["open", "reply_requested"]),
    itemId: z.string().min(1).max(500),
  }),
  prepare: mailboxInput.extend({
    onlyIfActive: z.boolean().optional(),
    timeZone: timeZoneInput.optional(),
  }),
  refresh: mailboxInput,
};

type Settings = typeof dailyBriefSettings.$inferSelect;
type Scope = { mailboxId: string; userId: string };
const GENERATION_COOLDOWN_MS = 15 * 60_000;
const DAILY_EDITION_ATTEMPT_LIMIT = 12;
const DAILY_URGENT_ATTEMPT_LIMIT = 12;
const LEASE_MS = 120_000;
const ACTIVITY_WINDOW_MS = 7 * 86_400_000;
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 60_000;

export const loadDailyBriefMemoryContext = async ({
  mailboxId,
  userId,
  query,
}: Scope & { query: string }) => {
  const candidates = await loadAiAgentMemoryCandidates({ mailboxId, userId });
  return await loadAiAgentContext({
    agent: "daily_brief",
    candidates: candidates.filter(
      (candidate) =>
        (candidate.scope === "mailbox" &&
          candidate.mailboxId === mailboxId &&
          candidate.scopeKey === `mailbox:${mailboxId}`) ||
        (candidate.scope === "user" &&
          candidate.userId === userId &&
          candidate.scopeKey === `user:${userId}`)
    ),
    mailboxId,
    query,
    semantic: false,
    userId,
  });
};

const loadSettings = async ({ mailboxId, userId }: Scope) => {
  const settings = await db
    .select()
    .from(dailyBriefSettings)
    .where(
      and(
        eq(dailyBriefSettings.mailboxId, mailboxId),
        eq(dailyBriefSettings.userId, userId)
      )
    )
    .limit(1);
  return settings.at(0);
};

export const recordDailyBriefActivity = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof dailyBriefInputs.activity>;
}) => {
  await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const now = new Date();
  await db
    .insert(dailyBriefSettings)
    .values({
      createdAt: now,
      enabled: true,
      id: randomUUID(),
      lastUsedAt: now,
      mailboxId: input.mailboxId,
      nextRunAt: nextDailyBriefRun({
        localTime: "06:00",
        now,
        timeZone: input.timeZone ?? "UTC",
      }),
      scheduleEnabled: true,
      timeZone: input.timeZone ?? "UTC",
      updatedAt: now,
      urgentPending: true,
      userId: context.userId,
    })
    .onConflictDoUpdate({
      set: { lastUsedAt: now },
      setWhere: or(
        isNull(dailyBriefSettings.lastUsedAt),
        lte(
          dailyBriefSettings.lastUsedAt,
          new Date(now.getTime() - ACTIVITY_WRITE_INTERVAL_MS)
        )
      ),
      target: [dailyBriefSettings.mailboxId, dailyBriefSettings.userId],
    });
  return { recorded: true };
};

const loadEdition = async (settings: Settings) => {
  if (!settings.editionId) {
    return null;
  }
  const [edition] = await db
    .select()
    .from(dailyBriefEdition)
    .where(
      and(
        eq(dailyBriefEdition.id, settings.editionId),
        eq(dailyBriefEdition.settingsId, settings.id)
      )
    )
    .limit(1);
  return edition;
};

const loadFeedback = async (
  settingsId: string,
  itemIds: string[],
  sourceMessageIds: string[] = []
) => {
  if (itemIds.length === 0 && sourceMessageIds.length === 0) {
    return [];
  }
  return await db
    .select()
    .from(dailyBriefFeedback)
    .where(
      and(
        eq(dailyBriefFeedback.settingsId, settingsId),
        or(
          itemIds.length > 0
            ? inArray(dailyBriefFeedback.itemId, itemIds)
            : undefined,
          sourceMessageIds.length > 0
            ? sql`${dailyBriefFeedback.sourceMessageIds} ?| array[${sql.join(
                sourceMessageIds.map((id) => sql`${id}`),
                sql`, `
              )}]::text[]`
            : undefined
        )
      )
    );
};

export const getDailyBrief = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof mailboxInput>;
}): Promise<DailyBriefView> => {
  await assertAccessibleMailbox({ ...input, userId: context.userId });
  const settings = await loadSettings({ ...input, userId: context.userId });
  const now = new Date();
  if (!settings) {
    return {
      edition: null,
      generationInProgress: false,
      items: [],
      lastError: null,
      settings: {
        cadence: "daily",
        enabled: true,
        lastUsedAt: null,
        localTime: "06:00",
        scheduleEnabled: true,
        timeZone: "UTC",
        weekday: 1,
      },
      stale: false,
    };
  }
  const edition = settings.enabled ? await loadEdition(settings) : undefined;
  const feedback = edition
    ? await loadFeedback(
        settings.id,
        edition.items.map((item) => item.id)
      )
    : [];
  const byItem = new Map(feedback.map((entry) => [entry.itemId, entry]));
  const items = (edition?.items ?? []).flatMap((item) => {
    const entry = byItem.get(item.id);
    if (
      entry &&
      (entry.action !== "defer" || (entry.deferUntil && entry.deferUntil > now))
    ) {
      return [];
    }
    return [
      {
        ...item,
        deferredUntil: entry?.deferUntil?.toISOString() ?? item.deferredUntil,
      },
    ];
  });
  return {
    edition: edition
      ? {
          generatedAt: edition.generatedAt.toISOString(),
          id: edition.id,
          localDate: edition.localDate,
          updatedAt: edition.updatedAt.toISOString(),
        }
      : null,
    generationInProgress:
      settings.leaseExpiresAt !== null && settings.leaseExpiresAt > now,
    items,
    lastError: settings.lastError,
    settings: {
      cadence: settings.cadence ?? "daily",
      enabled: settings.enabled,
      lastUsedAt: settings.lastUsedAt?.toISOString() ?? null,
      localTime: settings.localTime,
      scheduleEnabled: settings.scheduleEnabled,
      timeZone: settings.timeZone,
      weekday: settings.weekday ?? 1,
    },
    stale:
      !!edition &&
      ((settings.cadence === "weekly"
        ? now.getTime() - edition.generatedAt.getTime() >= ACTIVITY_WINDOW_MS
        : edition.localDate <
          dailyBriefLocalClock(now, settings.timeZone).date) ||
        settings.lastError !== null),
  };
};

export const configureDailyBrief = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof dailyBriefInputs.configure>;
}) => {
  const selected = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  if (input.enabled) {
    await assertCanUseAi({
      organizationId: selected.organizationId,
      userId: context.userId,
    });
  }
  const now = new Date();
  const values = {
    cadence: input.cadence ?? "daily",
    enabled: input.enabled,
    lastUsedAt: now,
    localTime: input.localTime,
    nextRunAt:
      input.enabled && input.scheduleEnabled
        ? nextDailyBriefRun({ ...input, now })
        : null,
    scheduleEnabled: input.scheduleEnabled,
    timeZone: input.timeZone,
    updatedAt: now,
    weekday: input.weekday ?? 1,
  };
  await db
    .insert(dailyBriefSettings)
    .values({
      ...values,
      createdAt: now,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      urgentGenerationsToday: 0,
      urgentRevision: 0,
      userId: context.userId,
    })
    .onConflictDoUpdate({
      set: { ...values, revision: sql`${dailyBriefSettings.revision} + 1` },
      target: [dailyBriefSettings.mailboxId, dailyBriefSettings.userId],
    });
  return await getDailyBrief({ context, input });
};

const learnFromDailyBriefAction = async ({
  action,
  deferredUntil,
  item,
  mailboxId,
  preference,
  userId,
}: Scope & {
  action: string;
  deferredUntil?: string;
  item: DailyBriefItem;
  preference?: string;
}) => {
  try {
    await learnAiMemoryFromMailAction({
      action: `daily_brief:${action}`,
      mailboxId,
      messageIds: item.sources.map((source) => source.messageId),
      metadata: {
        deferredUntil: deferredUntil ?? null,
        group: item.group,
        preference: preference || null,
        source: "daily_brief",
        sourceSenders: item.sources
          .map((source) => source.fromName ?? "")
          .join("\n"),
        sourceSubjects: item.sources.map((source) => source.subject).join("\n"),
        title: item.title,
        ...(preference ? { userMessage: preference } : {}),
      },
      targetCount: item.sources.length,
      userId,
    });
  } catch (error) {
    reportError(error, { operation: "daily-brief:learn-from-action" });
  }
};

export const giveDailyBriefFeedback = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof dailyBriefInputs.feedback>;
}) => {
  await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const settings = await loadSettings({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const edition =
    settings?.enabled === true ? await loadEdition(settings) : null;
  const item = edition?.items.find((entry) => entry.id === input.itemId);
  if (settings === undefined || edition === null || item === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Daily Brief item not found.",
    });
  }
  const now = new Date();
  const deferUntil =
    input.action === "defer" && input.deferUntil
      ? new Date(input.deferUntil)
      : null;
  if (
    input.action === "defer" &&
    (!deferUntil ||
      deferUntil <= now ||
      deferUntil.getTime() > now.getTime() + 30 * 86_400_000)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose a defer time within the next 30 days.",
    });
  }
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .update(dailyBriefSettings)
      .set({
        revision: sql`${dailyBriefSettings.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(dailyBriefSettings.id, settings.id),
          eq(dailyBriefSettings.editionId, edition.id),
          eq(dailyBriefSettings.enabled, true)
        )
      )
      .returning({ id: dailyBriefSettings.id });
    if (locked === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "Daily Brief changed. Please try again.",
      });
    }
    const values = {
      action: input.action,
      deferUntil,
      preference: input.preference || null,
      sourceMessageIds: item.sources.map((source) => source.messageId),
      updatedAt: now,
    };
    await tx
      .insert(dailyBriefFeedback)
      .values({
        ...values,
        createdAt: now,
        id: randomUUID(),
        itemId: item.id,
        settingsId: settings.id,
      })
      .onConflictDoUpdate({
        set: values,
        target: [dailyBriefFeedback.settingsId, dailyBriefFeedback.itemId],
      });
  });
  await learnFromDailyBriefAction({
    action: input.action,
    deferredUntil: deferUntil?.toISOString(),
    item,
    mailboxId: input.mailboxId,
    preference: input.preference,
    userId: context.userId,
  });
  return await getDailyBrief({ context, input });
};

export const observeDailyBriefItem = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof dailyBriefInputs.observe>;
}) => {
  await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const settings = await loadSettings({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const edition =
    settings?.enabled === true ? await loadEdition(settings) : null;
  const item = edition?.items.find((entry) => entry.id === input.itemId);
  if (item === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Daily Brief item not found.",
    });
  }
  await learnFromDailyBriefAction({
    action: input.action,
    item,
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  return { recorded: true };
};

const generateEdition = async ({
  context,
  settings,
  urgentOnly,
}: {
  context: MailRequestContext;
  settings: Settings;
  urgentOnly: boolean;
}) => {
  const now = new Date();
  const generationDay = now.toISOString().slice(0, 10);
  const leaseToken = randomUUID();
  const [claimed] = await db
    .update(dailyBriefSettings)
    .set({
      generationDay,
      generationsToday: sql`case when ${dailyBriefSettings.generationDay} = ${generationDay} then ${dailyBriefSettings.generationsToday} + ${urgentOnly ? 0 : 1} else ${urgentOnly ? 0 : 1} end`,
      lastAttemptAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      leaseToken,
      urgentGenerationsToday: sql`case when ${dailyBriefSettings.generationDay} = ${generationDay} then coalesce(${dailyBriefSettings.urgentGenerationsToday}, 0) + ${urgentOnly ? 1 : 0} else ${urgentOnly ? 1 : 0} end`,
    })
    .where(
      and(
        eq(dailyBriefSettings.id, settings.id),
        eq(dailyBriefSettings.enabled, true),
        eq(dailyBriefSettings.revision, settings.revision),
        gt(
          dailyBriefSettings.lastUsedAt,
          new Date(now.getTime() - ACTIVITY_WINDOW_MS)
        ),
        or(
          isNull(dailyBriefSettings.generationDay),
          lt(dailyBriefSettings.generationDay, generationDay),
          urgentOnly
            ? sql`coalesce(${dailyBriefSettings.urgentGenerationsToday}, 0) < ${DAILY_URGENT_ATTEMPT_LIMIT}`
            : lt(
                dailyBriefSettings.generationsToday,
                DAILY_EDITION_ATTEMPT_LIMIT
              )
        ),
        or(
          isNull(dailyBriefSettings.leaseExpiresAt),
          lte(dailyBriefSettings.leaseExpiresAt, now)
        ),
        or(
          isNull(dailyBriefSettings.lastAttemptAt),
          lte(
            dailyBriefSettings.lastAttemptAt,
            new Date(now.getTime() - GENERATION_COOLDOWN_MS)
          )
        )
      )
    )
    .returning();
  if (claimed === undefined) {
    return;
  }
  let usageReport: Promise<void> | undefined;
  try {
    const generationSignal = context.signal
      ? AbortSignal.any([context.signal, AbortSignal.timeout(45_000)])
      : AbortSignal.timeout(45_000);
    const selected = await assertAccessibleMailbox({
      mailboxId: claimed.mailboxId,
      userId: claimed.userId,
    });
    await assertCanUseAi({
      organizationId: selected.organizationId,
      userId: claimed.userId,
    });
    const previous = await loadEdition(claimed);
    if (urgentOnly && !previous) {
      return;
    }
    const existingSources = new Set(
      urgentOnly
        ? [
            ...(previous?.seenUrgentMessageIds ?? []),
            ...(previous?.items.flatMap((item) =>
              item.sources.map((source) => source.messageId)
            ) ?? []),
          ]
        : []
    );
    const page = await queriesMailOperations.listThreads({
      context: { ...context, signal: generationSignal },
      input: {
        category: "inbox",
        mailboxId: claimed.mailboxId,
        maxResults: 24,
      },
    });
    const feedback = await loadFeedback(
      claimed.id,
      previous?.items.map((item) => item.id) ?? [],
      page.messages.map((message) => message.id)
    );
    const suppressed = new Set(
      feedback
        .filter(
          (entry) =>
            entry.action !== "defer" ||
            (entry.deferUntil !== null && entry.deferUntil > now)
        )
        .flatMap((entry) => entry.sourceMessageIds)
    );
    const candidates = page.messages
      .filter(
        (message) =>
          !message.draftId &&
          (!urgentOnly ||
            (message.receivedAt
              ? Date.parse(message.receivedAt)
              : Number(message.internalDate)) >
              (previous?.generatedAt.getTime() ?? now.getTime())) &&
          !suppressed.has(message.id) &&
          !existingSources.has(message.id) &&
          ![
            MAILBOX_LABELS.sent,
            MAILBOX_LABELS.drafts,
            MAILBOX_LABELS.spam,
            MAILBOX_LABELS.trash,
          ].some((label) => message.labelIds?.includes(label) === true)
      )
      .slice(0, 24)
      .map((message) => ({
        bodyText: (message.bodyText || message.snippet || "").slice(0, 1000),
        fromName: (message.from ?? "").slice(0, 250),
        messageId: message.id,
        receivedAt:
          message.receivedAt ??
          (message.internalDate
            ? new Date(Number(message.internalDate)).toISOString()
            : ""),
        subject: (message.subject ?? "").slice(0, 300),
        threadId: message.threadId,
        unread:
          message.isUnread ??
          message.labelIds?.includes(MAILBOX_LABELS.unread) ??
          false,
      }));
    const memory = candidates.length
      ? await loadDailyBriefMemoryContext({
          mailboxId: claimed.mailboxId,
          query: candidates
            .map((candidate) => `${candidate.subject} ${candidate.fromName}`)
            .join(" ")
            .slice(0, 2000),
          userId: claimed.userId,
        })
      : null;
    const model = resolveBackgroundModel();
    const preferences = candidates.length
      ? await db
          .select({ preference: dailyBriefFeedback.preference })
          .from(dailyBriefFeedback)
          .where(
            and(
              eq(dailyBriefFeedback.settingsId, claimed.id),
              isNotNull(dailyBriefFeedback.preference),
              ne(dailyBriefFeedback.preference, "")
            )
          )
          .orderBy(desc(dailyBriefFeedback.updatedAt))
          .limit(8)
      : [];
    const generated = candidates.length
      ? await generateDailyBrief({
          abortSignal: generationSignal,
          candidates,
          memoryContext: memory ? serializeAiAgentContext(memory) : null,
          model,
          now: now.toISOString(),
          onUsage: (usage) => {
            usageReport = reportAiUsage({
              chatId: null,
              completionTokens: usage.completionTokens,
              costUsd: usage.costUsd,
              externalId: `daily-brief:${leaseToken}`,
              mailboxId: claimed.mailboxId,
              model,
              promptTokens: usage.promptTokens,
              promptTokensDetails: {
                cacheWriteTokens: usage.cacheWriteTokens,
                cachedTokens: usage.cachedTokens,
              },
              usageKind: "aiChat",
              userId: claimed.userId,
            }).catch((error: unknown) => {
              reportError(error, { operation: "daily-brief:report-usage" });
            });
          },
          preferences:
            preferences
              .flatMap((entry) => (entry.preference ? [entry.preference] : []))
              .join("\n") || null,
          urgentOnly,
        })
      : [];
    await assertAccessibleMailbox({
      mailboxId: claimed.mailboxId,
      userId: claimed.userId,
    });
    const completedAt = new Date();
    const additions: DailyBriefItem[] = generated
      .filter((item) => !urgentOnly || item.urgent)
      .toSorted((left, right) => right.priority - left.priority)
      .map((item) => ({
        ...item,
        deferredUntil: null,
        id: randomUUID(),
        ...(urgentOnly ? { urgentAddition: true } : {}),
      }));
    let deferred = urgentOnly
      ? []
      : (previous?.items ?? []).filter((item) =>
          feedback.some(
            (entry) =>
              entry.itemId === item.id &&
              entry.action === "defer" &&
              entry.deferUntil !== null &&
              entry.deferUntil > now
          )
        );
    if (!urgentOnly && deferred.length > 0) {
      const visibleSources = new Set<string>();
      for (const threadId of new Set(
        deferred.flatMap((item) =>
          item.sources.map((source) => source.threadId)
        )
      )) {
        try {
          const thread = await queriesMailOperations.getThread({
            context: { ...context, signal: generationSignal },
            input: { mailboxId: claimed.mailboxId, threadId },
          });
          for (const message of thread.messages) {
            if (message.threadId === threadId && thread.threadId === threadId) {
              visibleSources.add(message.id);
            }
          }
        } catch (error) {
          if (!(error instanceof ORPCError && error.code === "NOT_FOUND")) {
            throw error;
          }
        }
      }
      deferred = deferred.filter((item) =>
        item.sources.every((source) => visibleSources.has(source.messageId))
      );
    }
    const items = urgentOnly
      ? [
          ...(previous?.items.filter((item) => item.urgentAddition !== true) ??
            []),
          ...[
            ...(previous?.items.filter(
              (item) => item.urgentAddition === true
            ) ?? []),
            ...additions,
          ].slice(-8),
        ]
      : [...additions, ...deferred].slice(0, 16);
    const editionId = urgentOnly && previous ? previous.id : randomUUID();
    let { nextRunAt } = claimed;
    if (!urgentOnly) {
      nextRunAt = claimed.scheduleEnabled
        ? nextDailyBriefRun({
            ...(claimed.nextRunAt !== null && claimed.nextRunAt <= now
              ? {
                  afterLocalDate: dailyBriefLocalClock(
                    completedAt,
                    claimed.timeZone
                  ).date,
                }
              : {}),
            cadence: claimed.cadence ?? "daily",
            localTime: claimed.localTime,
            now: completedAt,
            timeZone: claimed.timeZone,
            weekday: claimed.weekday ?? 1,
          })
        : null;
    }
    await db.transaction(async (tx) => {
      const [committed] = await tx
        .update(dailyBriefSettings)
        .set({
          editionId,
          lastError: null,
          nextRunAt,
          updatedAt: completedAt,
          urgentPending: sql`coalesce(${dailyBriefSettings.urgentRevision}, 0) <> ${claimed.urgentRevision ?? 0}`,
        })
        .where(
          and(
            eq(dailyBriefSettings.id, claimed.id),
            eq(dailyBriefSettings.enabled, true),
            eq(dailyBriefSettings.revision, claimed.revision),
            eq(dailyBriefSettings.leaseToken, leaseToken),
            gt(dailyBriefSettings.leaseExpiresAt, completedAt)
          )
        )
        .returning({ id: dailyBriefSettings.id });
      if (committed === undefined) {
        throw new ORPCError("CONFLICT", {
          message: "Daily Brief settings changed. Please try again.",
        });
      }
      if (urgentOnly && previous) {
        await tx
          .update(dailyBriefEdition)
          .set({
            items,
            seenUrgentMessageIds: [
              ...new Set([
                ...(previous.seenUrgentMessageIds ?? []),
                ...candidates.map((candidate) => candidate.messageId),
              ]),
            ].slice(-512),
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(dailyBriefEdition.id, editionId),
              eq(dailyBriefEdition.settingsId, claimed.id)
            )
          );
      } else {
        await tx.insert(dailyBriefEdition).values({
          generatedAt: now,
          id: editionId,
          items,
          localDate: dailyBriefLocalClock(completedAt, claimed.timeZone).date,
          seenUrgentMessageIds: [],
          settingsId: claimed.id,
          updatedAt: completedAt,
        });
        await tx
          .delete(dailyBriefEdition)
          .where(
            and(
              eq(dailyBriefEdition.settingsId, claimed.id),
              ne(dailyBriefEdition.id, editionId)
            )
          );
      }
    });
  } catch (error) {
    await db
      .update(dailyBriefSettings)
      .set({
        lastError:
          "Daily Brief could not update. Your previous edition is still available.",
        ...(urgentOnly ? { urgentPending: true } : {}),
      })
      .where(
        and(
          eq(dailyBriefSettings.id, claimed.id),
          eq(dailyBriefSettings.revision, claimed.revision),
          eq(dailyBriefSettings.leaseToken, leaseToken)
        )
      );
    if (error instanceof ORPCError && error.status < 500) {
      throw error;
    }
    reportError(new Error("Daily Brief generation failed."), {
      operation: "daily-brief:generate",
    });
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Daily Brief could not update. Please try again.",
    });
  } finally {
    await usageReport;
    await db
      .update(dailyBriefSettings)
      .set({ leaseExpiresAt: null, leaseToken: null })
      .where(
        and(
          eq(dailyBriefSettings.id, claimed.id),
          eq(dailyBriefSettings.leaseToken, leaseToken)
        )
      );
  }
};

export const refreshDailyBrief = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof mailboxInput>;
}) => {
  await assertAccessibleMailbox({ ...input, userId: context.userId });
  await recordDailyBriefActivity({ context, input });
  const settings = await loadSettings({ ...input, userId: context.userId });
  if (settings?.enabled !== true) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Enable Daily Brief first.",
    });
  }
  if (
    settings.generationDay === new Date().toISOString().slice(0, 10) &&
    settings.generationsToday >= DAILY_EDITION_ATTEMPT_LIMIT
  ) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message:
        "Daily Brief has reached today's refresh limit. Please try again tomorrow.",
    });
  }
  if (
    settings.lastAttemptAt &&
    Date.now() - settings.lastAttemptAt.getTime() < GENERATION_COOLDOWN_MS
  ) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message:
        "Daily Brief can refresh once every 15 minutes. Please try again shortly.",
    });
  }
  await generateEdition({ context, settings, urgentOnly: false });
  return await getDailyBrief({ context, input });
};

export const prepareDailyBrief = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof dailyBriefInputs.prepare>;
}) => {
  if (input.onlyIfActive === true) {
    await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
  } else {
    await recordDailyBriefActivity({ context, input });
  }
  const settings = await loadSettings({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const view = await getDailyBrief({ context, input });
  const needsShorterBrief = view.items.some(
    (item) => item.summary.length > 180 || item.title.length > 80
  );
  if (
    settings?.enabled !== true ||
    settings.lastUsedAt === null ||
    settings.lastUsedAt.getTime() <= Date.now() - ACTIVITY_WINDOW_MS ||
    (view.edition !== null &&
      !view.stale &&
      !needsShorterBrief &&
      !settings.urgentPending &&
      !(
        settings.scheduleEnabled &&
        settings.nextRunAt &&
        settings.nextRunAt <= new Date()
      ))
  ) {
    return view;
  }
  await generateEdition({
    context,
    settings,
    urgentOnly:
      view.edition !== null &&
      !view.stale &&
      !needsShorterBrief &&
      !(
        settings.scheduleEnabled &&
        settings.nextRunAt &&
        settings.nextRunAt <= new Date()
      ),
  });
  return await getDailyBrief({ context, input });
};

export const markDailyBriefUrgentPending = async ({
  mailboxId,
}: {
  mailboxId: string;
}) => {
  await db
    .update(dailyBriefSettings)
    .set({
      urgentPending: true,
      urgentRevision: sql`coalesce(${dailyBriefSettings.urgentRevision}, 0) + 1`,
    })
    .where(
      and(
        eq(dailyBriefSettings.mailboxId, mailboxId),
        eq(dailyBriefSettings.enabled, true),
        gt(
          dailyBriefSettings.lastUsedAt,
          new Date(Date.now() - ACTIVITY_WINDOW_MS)
        ),
        or(
          isNotNull(dailyBriefSettings.editionId),
          isNotNull(dailyBriefSettings.leaseToken)
        )
      )
    );
};

export const runDueDailyBriefs = async ({
  limit = 5,
}: { limit?: number } = {}) => {
  const now = new Date();
  const batchSize = Math.min(10, Math.max(1, limit));
  const fullDue = and(
    eq(dailyBriefSettings.scheduleEnabled, true),
    isNotNull(dailyBriefSettings.nextRunAt),
    lte(dailyBriefSettings.nextRunAt, now)
  );
  const fullEditionNeeded = or(isNull(dailyBriefSettings.editionId), fullDue);
  const newGenerationDay = or(
    isNull(dailyBriefSettings.generationDay),
    lt(dailyBriefSettings.generationDay, now.toISOString().slice(0, 10))
  );
  const settings = await db
    .select()
    .from(dailyBriefSettings)
    .where(
      and(
        eq(dailyBriefSettings.enabled, true),
        gt(
          dailyBriefSettings.lastUsedAt,
          new Date(now.getTime() - ACTIVITY_WINDOW_MS)
        ),
        or(
          and(
            fullEditionNeeded,
            or(fullDue, eq(dailyBriefSettings.urgentPending, true)),
            or(
              newGenerationDay,
              lt(
                dailyBriefSettings.generationsToday,
                DAILY_EDITION_ATTEMPT_LIMIT
              )
            )
          ),
          and(
            not(fullEditionNeeded),
            eq(dailyBriefSettings.urgentPending, true),
            or(
              newGenerationDay,
              sql`coalesce(${dailyBriefSettings.urgentGenerationsToday}, 0) < ${DAILY_URGENT_ATTEMPT_LIMIT}`
            )
          )
        ),
        or(
          isNull(dailyBriefSettings.lastAttemptAt),
          lte(
            dailyBriefSettings.lastAttemptAt,
            new Date(now.getTime() - GENERATION_COOLDOWN_MS)
          )
        ),
        or(
          isNull(dailyBriefSettings.leaseExpiresAt),
          lte(dailyBriefSettings.leaseExpiresAt, now)
        )
      )
    )
    .orderBy(
      sql`${dailyBriefSettings.lastAttemptAt} asc nulls first`,
      asc(dailyBriefSettings.id)
    )
    .limit(batchSize);
  let processed = 0;
  for (const entry of settings) {
    if (Date.now() - now.getTime() > 80_000) {
      break;
    }
    processed += 1;
    try {
      await generateEdition({
        context: { userId: entry.userId },
        settings: entry,
        urgentOnly:
          entry.editionId !== null &&
          !(entry.scheduleEnabled && entry.nextRunAt && entry.nextRunAt <= now),
      });
    } catch (error) {
      if (!(error instanceof ORPCError && error.status < 500)) {
        reportError(new Error("Daily Brief background update failed."), {
          operation: "daily-brief:scheduled",
        });
      }
    }
  }
  return { processed };
};
