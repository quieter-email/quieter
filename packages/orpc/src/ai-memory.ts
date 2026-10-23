import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import {
  AI_MEMORY_CONTENT_MAX_LENGTH,
  AI_MEMORY_REQUEST_MAX_LENGTH,
  AI_MEMORY_UPDATE_OPERATION_LIMIT,
  AI_MEMORY_USER_MESSAGE_MAX_LENGTH,
  classifyAiMemoryEditIntent,
  containsProhibitedMemorySecret,
  planAiMemoryDeletion,
  planAiMemoryUpdate,
} from "@quieter/ai/ai-memory";
import type {
  AiMemoryEditorMemory,
  AiMemoryObservation,
  AiMemoryUpdatePlan,
} from "@quieter/ai/ai-memory";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import { AUTO_LABEL_MODEL } from "@quieter/ai/classify-gmail-message";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import { reportAiUsage } from "@quieter/billing";
import { getBillingCreditUsage } from "@quieter/billing/credits";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import { retryIdempotentDatabaseQuery } from "@quieter/database/retry";
import {
  aiMemory,
  aiMemoryChangeSet,
  aiMemoryMailboxState,
  aiMemoryScopeConfig,
  gmailUsefulDetailFeedback,
  mailAutomationMemoryProfile,
  mailAutoLabelFeedback,
  mailbox,
  user as memoryUser,
  userAiContextEvent,
} from "@quieter/database/schema";
import type {
  AiMemoryCategory,
  AiMemoryChange,
  AiMemoryMetadata,
  AiMemorySnapshot,
  AiMemorySource,
  UserAiContextEventKind,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  getTableColumns,
  inArray,
  isNull,
  like,
  lt,
  ne,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { assertCanUseAi } from "./ai-access";
import { getAuthorizedManagedMailbox } from "./mailbox/access";
import { assertAccessibleMailbox } from "./mailbox/service";

const MEMORY_EVENT_METADATA_STRING_LIMIT = 600;
export const AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH = 6000;
export const DEFAULT_AI_MEMORY_LEARNING_PROMPT = `Build a concise, useful understanding of the user from their own chat, writing, and mail activity. Learn their language, tone, vocabulary, greetings and sign-offs, relationships they describe, work and routines, reading interests, priorities, organization habits, and how preferences vary by recipient or context. Connect repeated labeling, reading, archiving, reply requests, and brief feedback into durable patterns. Distinguish dismissing from disliking, and deferring from ignoring. Keep uncertain evidence provisional, update contradictions, expire temporary context, and never retain raw correspondence or secrets.`;

export type AiMemoryEventMetadata = Record<
  string,
  string | number | boolean | null
>;
export {
  buildMailMemoryQuery,
  calculateAiMemorySalience,
  getAiMemoryRetirementReason,
  loadAiAgentContext,
  loadAiAgentMemoryCandidates,
  rankAiAgentMemoryCandidates,
  rankAiMemoryCandidates,
  serializeAiAgentContext,
} from "./ai-memory-context";
export type {
  AiAgentMemoryCandidates,
  AiAgentMemoryContext,
  AiMemoryOverviewCursor,
  AiMemoryOverviewPage,
} from "./ai-memory-context";

type MemoryRow = Omit<typeof aiMemory.$inferSelect, "embedding" | "embeddedAt">;
const {
  embedding: _embedding,
  embeddedAt: _embeddedAt,
  ...memoryColumns
} = getTableColumns(aiMemory);

type MemoryScopeTarget = {
  mailboxId: string | null;
  scope: "mailbox" | "user";
  scopeKey: string;
  userId: string | null;
};

const userScope = (userId: string): MemoryScopeTarget => ({
  mailboxId: null,
  scope: "user",
  scopeKey: `user:${userId}`,
  userId,
});

const mailboxScope = (mailboxId: string): MemoryScopeTarget => ({
  mailboxId,
  scope: "mailbox",
  scopeKey: `mailbox:${mailboxId}`,
  userId: null,
});

const toAiMemoryScopeConfig = (
  record: typeof aiMemoryScopeConfig.$inferSelect | undefined
) => ({
  activeLearningEnabled: record?.activeLearningEnabled ?? true,
  learningPrompt: record?.learningPrompt?.trim()
    ? record.learningPrompt.trim()
    : DEFAULT_AI_MEMORY_LEARNING_PROMPT,
  revision: record?.revision ?? 0,
  updatedAt: record?.updatedAt ?? null,
});

const loadAiMemoryScopeConfig = async (scope: MemoryScopeTarget) => {
  const [record] = await db
    .select()
    .from(aiMemoryScopeConfig)
    .where(eq(aiMemoryScopeConfig.scopeKey, scope.scopeKey))
    .limit(1);
  return toAiMemoryScopeConfig(record);
};

const lockAiMemoryScope = async (
  executor: DatabaseExecutor,
  scope: MemoryScopeTarget,
  actorUserId?: string
) => {
  if (scope.scope === "user") {
    await executor
      .select({ id: memoryUser.id })
      .from(memoryUser)
      .where(eq(memoryUser.id, scope.userId ?? ""))
      .for("update");
  } else {
    const [selectedMailbox] = await executor
      .select({
        id: mailbox.id,
        ownerUserId: mailbox.ownerUserId,
        provider: mailbox.provider,
      })
      .from(mailbox)
      .where(eq(mailbox.id, scope.mailboxId ?? ""))
      .for("update");
    if (actorUserId !== undefined) {
      if (
        selectedMailbox === undefined ||
        (selectedMailbox.provider === "gmail" &&
          selectedMailbox.ownerUserId !== actorUserId)
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
      }
      if (selectedMailbox.provider === "managed") {
        await getAuthorizedManagedMailbox(
          {
            mailboxId: selectedMailbox.id,
            requiredRoles: ["manager"],
            userId: actorUserId,
          },
          executor
        );
      }
    }
  }
  const [config] = await executor
    .select()
    .from(aiMemoryScopeConfig)
    .where(eq(aiMemoryScopeConfig.scopeKey, scope.scopeKey))
    .for("update");
  return toAiMemoryScopeConfig(config);
};

const advanceAiMemoryScopeRevision = async (
  executor: DatabaseExecutor,
  scope: MemoryScopeTarget
) => {
  const now = new Date();
  await executor
    .insert(aiMemoryScopeConfig)
    .values({ ...scope, createdAt: now, id: randomUUID(), updatedAt: now })
    .onConflictDoUpdate({
      set: {
        revision: sql`${aiMemoryScopeConfig.revision} + 1`,
        updatedAt: now,
      },
      target: aiMemoryScopeConfig.scopeKey,
    });
};

const memoryEventScopeCondition = (scope: MemoryScopeTarget) =>
  scope.scope === "user"
    ? and(
        eq(userAiContextEvent.userId, scope.userId ?? ""),
        eq(sql<string>`${userAiContextEvent.metadata}->>'memoryScope'`, "user")
      )
    : and(
        eq(userAiContextEvent.mailboxId, scope.mailboxId ?? ""),
        eq(
          sql<string>`coalesce(${userAiContextEvent.metadata}->>'memoryScope', 'mailbox')`,
          "mailbox"
        )
      );

const discardPendingAiMemoryEvents = async (
  executor: DatabaseExecutor,
  scope: MemoryScopeTarget
) => {
  const now = new Date();
  await executor
    .update(userAiContextEvent)
    .set({
      lastError: null,
      metadata: {},
      processingAt: null,
      skippedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        memoryEventScopeCondition(scope),
        isNull(userAiContextEvent.mergedAt),
        isNull(userAiContextEvent.skippedAt)
      )
    );
};

const completeAiMemoryBootstrap = async (
  executor: DatabaseExecutor,
  scope: MemoryScopeTarget
) => {
  const targets =
    scope.scope === "mailbox"
      ? [{ id: scope.mailboxId ?? "" }]
      : await executor
          .select({ id: mailbox.id })
          .from(mailbox)
          .where(
            or(
              and(
                eq(mailbox.provider, "gmail"),
                eq(mailbox.ownerUserId, scope.userId ?? "")
              ),
              and(
                eq(mailbox.provider, "managed"),
                eq(mailbox.accessMode, "private"),
                eq(mailbox.managedOwnerUserId, scope.userId ?? "")
              )
            )
          );
  if (targets.length === 0) {
    return;
  }
  const now = new Date();
  await executor
    .insert(aiMemoryMailboxState)
    .values(
      targets.map(({ id }) => ({
        createdAt: now,
        mailboxId: id,
        receivedComplete: true,
        sentComplete: true,
        status: "completed" as const,
        updatedAt: now,
        userId: scope.userId,
      }))
    )
    .onConflictDoUpdate({
      set: {
        lastError: null,
        processingAt: null,
        receivedComplete: true,
        sentComplete: true,
        status: "completed",
        updatedAt: now,
      },
      target: aiMemoryMailboxState.mailboxId,
    });
};

export const getPersonalAiMemoryScopeConfig = async (userId: string) =>
  await loadAiMemoryScopeConfig(userScope(userId));

export const getMailboxAiMemoryScopeConfig = async (mailboxId: string) =>
  await loadAiMemoryScopeConfig(mailboxScope(mailboxId));

export const updateAiMemoryScopeConfig = async ({
  activeLearningEnabled,
  learningPrompt,
  mailboxId,
  revision,
  scope: requestedScope,
  userId,
}: {
  activeLearningEnabled: boolean;
  learningPrompt: string;
  mailboxId?: string | null;
  revision: number;
  scope: "mailbox" | "user";
  userId: string;
}) => {
  const scope =
    requestedScope === "user"
      ? userScope(userId)
      : mailboxScope(mailboxId ?? "");
  if (requestedScope === "mailbox" && !mailboxId) {
    throw new ORPCError("BAD_REQUEST", { message: "A mailbox is required." });
  }
  const normalizedPrompt = learningPrompt
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/\n{4,}/gu, "\n\n\n")
    .trim()
    .slice(0, AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH)
    .trimEnd();
  const now = new Date();
  const record = await db.transaction(async (tx) => {
    await lockAiMemoryScope(tx, scope, userId);
    const [updated] =
      revision === 0
        ? await tx
            .insert(aiMemoryScopeConfig)
            .values({
              ...scope,
              activeLearningEnabled,
              createdAt: now,
              id: randomUUID(),
              learningPrompt: normalizedPrompt,
              updatedAt: now,
            })
            .onConflictDoNothing({ target: aiMemoryScopeConfig.scopeKey })
            .returning()
        : await tx
            .update(aiMemoryScopeConfig)
            .set({
              activeLearningEnabled,
              learningPrompt: normalizedPrompt,
              revision: sql`${aiMemoryScopeConfig.revision} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(aiMemoryScopeConfig.scopeKey, scope.scopeKey),
                eq(aiMemoryScopeConfig.revision, revision)
              )
            )
            .returning();
    if (updated === undefined) {
      throw new ORPCError("CONFLICT", {
        message:
          "Learning guidance changed elsewhere. Review the latest version.",
      });
    }
    if (!activeLearningEnabled) {
      await discardPendingAiMemoryEvents(tx, scope);
    }
    return updated;
  });
  return toAiMemoryScopeConfig(record);
};

const toSnapshot = (record: MemoryRow): AiMemorySnapshot => ({
  confidence: record.confidence,
  content: record.content,
  expiresAt: record.expiresAt?.toISOString() ?? null,
  importance: record.importance,
  key: record.key,
  kind: record.kind,
  metadata: record.metadata,
  status: record.status,
  summary: record.summary,
  version: record.version,
});

const toEditorMemory = (record: MemoryRow): AiMemoryEditorMemory => ({
  agents: record.metadata.agents ?? ["all"],
  category: record.metadata.category ?? "preferences",
  confidence: record.confidence,
  content: record.content,
  correspondents: record.metadata.correspondents ?? [],
  expiresAt: record.expiresAt?.toISOString() ?? null,
  id: record.id,
  importance: record.importance,
  key: record.key,
  kind: record.kind,
  status: record.status,
  summary: record.summary,
  topics: record.metadata.topics ?? [],
});

const sanitizeMetadata = (
  metadata: AiMemoryEventMetadata
): AiMemoryEventMetadata => {
  const sanitized: AiMemoryEventMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (containsProhibitedMemorySecret(trimmed)) {
        continue;
      }
      const limits: Record<string, number> = {
        bodyText: 20_000,
        userMessage: AI_MEMORY_USER_MESSAGE_MAX_LENGTH,
      };
      sanitized[key] =
        trimmed === ""
          ? null
          : trimmed.slice(0, limits[key] ?? MEMORY_EVENT_METADATA_STRING_LIMIT);
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) {
        sanitized[key] = value;
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

export const loadAiConfiguration = () => ({
  autoLabelModel: AUTO_LABEL_MODEL,
});

const listScopeMemories = async (scopeKey: string) =>
  await db
    .select(memoryColumns)
    .from(aiMemory)
    .where(eq(aiMemory.scopeKey, scopeKey))
    .orderBy(asc(aiMemory.id));

const listConsolidationMemories = async ({
  events,
  scope,
}: {
  events: Pick<typeof userAiContextEvent.$inferSelect, "kind" | "metadata">[];
  scope: MemoryScopeTarget;
}) => {
  const text = events
    .flatMap(({ metadata }) => Object.values(metadata))
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const tokens = [
    ...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)),
  ].slice(0, 80);
  const contacts = [
    ...new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gu)
    ),
  ].slice(0, 30);
  let categories: AiMemoryCategory[] = [
    "identity",
    "relationships",
    "preferences",
    "work",
    "interests",
    "activity",
  ];
  if (
    events.some(
      ({ kind, metadata }) =>
        kind === "sent_message" ||
        metadata.observationKind === "sent_message" ||
        metadata.observationKind === "draft_message"
    )
  ) {
    categories = [
      "identity",
      "writing_style",
      "relationships",
      "preferences",
      "work",
    ];
  } else if (events.some(({ kind }) => kind === "auto_label_feedback")) {
    categories = ["labeling", "preferences", "activity"];
  }
  const document = sql`to_tsvector('simple', ${aiMemory.content} || ' ' || ${aiMemory.summary})`;
  const textQuery = sql`to_tsquery('simple', ${tokens.join(" | ") || "quieter_empty_observation"})`;
  const contactMatch =
    contacts.length === 0
      ? sql`false`
      : or(
          ...contacts.map(
            (contact) =>
              sql`${aiMemory.metadata} @> ${JSON.stringify({ correspondents: [contact] })}::jsonb`
          )
        );
  const usable = and(
    eq(aiMemory.scopeKey, scope.scopeKey),
    eq(aiMemory.status, "active"),
    or(isNull(aiMemory.expiresAt), gt(aiMemory.expiresAt, new Date()))
  );
  categories = [
    ...new Set([
      ...categories,
      "identity",
      "writing_style",
      "preferences",
    ] satisfies AiMemoryCategory[]),
  ];
  const categoryIds = sql`(select id from (
    select ${aiMemory.id} as id,
      row_number() over (
        partition by coalesce(${aiMemory.metadata}->>'category', 'preferences')
        order by ${aiMemory.importance} desc, ${aiMemory.lastConfirmedAt} desc, ${aiMemory.id}
      ) as position
    from ${aiMemory}
    where ${usable}
      and jsonb_array_length(coalesce(${aiMemory.metadata}->'correspondents', '[]'::jsonb)) = 0
      and coalesce(${aiMemory.metadata}->>'category', 'preferences') in (${sql.join(
        categories.map((category) => sql`${category}`),
        sql`, `
      )})
  ) balanced where position <= 8)`;
  const [general, matchingText, matchingContacts] = await Promise.all([
    db
      .select(memoryColumns)
      .from(aiMemory)
      .where(and(usable, inArray(aiMemory.id, categoryIds)))
      .orderBy(asc(aiMemory.id)),
    db
      .select(memoryColumns)
      .from(aiMemory)
      .where(and(usable, sql`${document} @@ ${textQuery}`))
      .orderBy(
        desc(sql`ts_rank_cd(${document}, ${textQuery})`),
        asc(aiMemory.id)
      )
      .limit(32),
    db
      .select(memoryColumns)
      .from(aiMemory)
      .where(and(usable, contactMatch))
      .orderBy(desc(aiMemory.lastConfirmedAt), asc(aiMemory.id))
      .limit(32),
  ]);
  return [
    ...new Map(
      [...matchingContacts, ...matchingText, ...general].map((memory) => [
        memory.id,
        memory,
      ])
    ).values(),
  ];
};

const buildMemoryValues = ({
  operation,
  source,
}: {
  operation: AiMemoryUpdatePlan["operations"][number];
  source: AiMemorySource;
}) => ({
  confidence: operation.confidence,
  content: operation.content ?? operation.summary,
  expiresAt: operation.expiresAt ? new Date(operation.expiresAt) : null,
  importance: operation.importance,
  key: operation.key,
  kind: operation.kind,
  metadata: {
    agents: operation.agents.length > 0 ? operation.agents : ["all"],
    category: operation.category ?? "preferences",
    correspondents: operation.correspondents ?? [],
    topics: operation.topics,
  } satisfies AiMemoryMetadata,
  source,
  summary: operation.summary,
});

const eraseAiMemoryRecords = async ({
  executor,
  memories,
  scope,
}: {
  executor: DatabaseExecutor;
  memories: MemoryRow[];
  scope: MemoryScopeTarget;
}) => {
  if (memories.length === 0) {
    return;
  }
  const ids = memories.map(({ id }) => id);
  const historyCondition = and(
    scope.scope === "user"
      ? and(
          eq(aiMemoryChangeSet.userId, scope.userId ?? ""),
          isNull(aiMemoryChangeSet.mailboxId)
        )
      : eq(aiMemoryChangeSet.mailboxId, scope.mailboxId ?? ""),
    sql`exists (
      select 1 from jsonb_array_elements(${aiMemoryChangeSet.changes}) as change
      where change->>'memoryId' in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
    )`
  );
  if (scope.scope === "mailbox") {
    const labelIds = memories.flatMap(({ metadata, sourceReference }) =>
      sourceReference === "feedback:auto_label" &&
      typeof metadata.labelId === "string"
        ? [metadata.labelId]
        : []
    );
    if (labelIds.length > 0) {
      await executor
        .delete(mailAutoLabelFeedback)
        .where(
          and(
            eq(mailAutoLabelFeedback.mailboxId, scope.mailboxId ?? ""),
            inArray(mailAutoLabelFeedback.labelId, labelIds)
          )
        );
    }
  }
  const history = await executor
    .select({ sourceEventId: aiMemoryChangeSet.sourceEventId })
    .from(aiMemoryChangeSet)
    .where(historyCondition);
  const sourceIds = [
    ...new Set(
      [
        ...memories.map(({ sourceReference }) => sourceReference),
        ...history.map(({ sourceEventId }) => sourceEventId),
      ].filter((id): id is string => id !== null)
    ),
  ];
  await executor.delete(aiMemoryChangeSet).where(historyCondition);
  if (sourceIds.length > 0) {
    await executor
      .update(userAiContextEvent)
      .set({
        lastError: null,
        metadata: {},
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(userAiContextEvent.id, sourceIds),
          scope.scope === "user"
            ? eq(userAiContextEvent.userId, scope.userId ?? "")
            : eq(userAiContextEvent.mailboxId, scope.mailboxId ?? "")
        )
      );
  }
  await discardPendingAiMemoryEvents(executor, scope);
  await completeAiMemoryBootstrap(executor, scope);
  await executor
    .delete(aiMemory)
    .where(
      and(eq(aiMemory.scopeKey, scope.scopeKey), inArray(aiMemory.id, ids))
    );
};

const applyAiMemoryPlan = async ({
  actorUserId,
  allowDirectUserFactUpdates = false,
  changeSetSource,
  executor,
  existingEditsOnly = false,
  expectedRevision,
  expectedVersions,
  plan,
  scope,
  source,
  sourceClaimedAt,
  sourceEventId,
  sourceEventIds,
  sourceEventMailboxId,
}: {
  actorUserId: string;
  allowDirectUserFactUpdates?: boolean;
  changeSetSource: "chat" | "feedback" | "settings" | "system";
  executor?: DatabaseExecutor;
  existingEditsOnly?: boolean;
  expectedRevision: number;
  expectedVersions?: ReadonlyMap<string, number>;
  plan: AiMemoryUpdatePlan;
  scope: MemoryScopeTarget;
  source: AiMemorySource;
  sourceClaimedAt?: Date;
  sourceEventId?: string | null;
  sourceEventIds?: string[];
  sourceEventMailboxId?: string;
}) => {
  const appliedChangeSet = await (executor ?? db).transaction(async (tx) => {
    const config = await lockAiMemoryScope(tx, scope, actorUserId);
    if (config.revision !== expectedRevision) {
      throw new ORPCError("CONFLICT", {
        message:
          "Memory changed while this update was being prepared. Try again.",
      });
    }
    if (sourceEventIds !== undefined && sourceEventIds.length > 0) {
      const claimedEvents = await tx
        .select({ id: userAiContextEvent.id })
        .from(userAiContextEvent)
        .where(
          and(
            inArray(userAiContextEvent.id, sourceEventIds),
            eq(userAiContextEvent.userId, actorUserId),
            eq(
              userAiContextEvent.mailboxId,
              scope.mailboxId ?? sourceEventMailboxId ?? ""
            ),
            sourceClaimedAt
              ? eq(userAiContextEvent.processingAt, sourceClaimedAt)
              : undefined,
            isNull(userAiContextEvent.mergedAt),
            isNull(userAiContextEvent.skippedAt)
          )
        )
        .for("update");
      if (claimedEvents.length !== sourceEventIds.length) {
        throw new ORPCError("CONFLICT", {
          message: "These observations were already processed or forgotten.",
        });
      }
      if (!config.activeLearningEnabled) {
        throw new ORPCError("CONFLICT", { message: "Learning is paused." });
      }
    }
    const targetIds = plan.operations.flatMap(({ targetId }) =>
      targetId ? [targetId] : []
    );
    const keys = plan.operations.map(({ key }) => key);
    const current =
      keys.length === 0
        ? []
        : await tx
            .select(memoryColumns)
            .from(aiMemory)
            .where(
              and(
                eq(aiMemory.scopeKey, scope.scopeKey),
                or(inArray(aiMemory.id, targetIds), inArray(aiMemory.key, keys))
              )
            );
    const recordsById = new Map(current.map((memory) => [memory.id, memory]));
    const recordsByKey = new Map(current.map((memory) => [memory.key, memory]));
    const changes: AiMemoryChange[] = [];
    const now = new Date();
    if (
      existingEditsOnly &&
      plan.operations.some((operation) => {
        const target = operation.targetId
          ? recordsById.get(operation.targetId)
          : undefined;
        return (
          source !== "explicit" ||
          operation.action === "add" ||
          target?.status !== "active" ||
          target.version !== expectedVersions?.get(target.id) ||
          operation.key !== target.key ||
          operation.kind !== target.kind
        );
      })
    ) {
      throw new ORPCError("CONFLICT", {
        message: "The memory to correct was changed or forgotten.",
      });
    }
    if (
      plan.operations.some(
        ({ targetId }) => targetId !== null && !recordsById.has(targetId)
      ) ||
      (expectedVersions !== undefined &&
        current.some(
          (record) =>
            record.version !== expectedVersions.get(record.id) &&
            plan.operations.some((operation) =>
              operation.targetId
                ? operation.targetId === record.id
                : operation.key === record.key
            )
        ))
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "AI memory changed while these observations were being consolidated.",
      });
    }

    const forgotten: MemoryRow[] = [];
    const seenTargets = new Set<string>();
    for (const operation of plan.operations) {
      const target = operation.targetId
        ? recordsById.get(operation.targetId)
        : recordsByKey.get(operation.key);
      const targetKey = target?.id ?? `new:${operation.key}`;
      if (seenTargets.has(targetKey)) {
        throw new ORPCError("CONFLICT", {
          message: "The memory update included conflicting changes. Try again.",
        });
      }
      seenTargets.add(targetKey);
      if (
        existingEditsOnly &&
        (target === undefined || target.status !== "active")
      ) {
        continue;
      }
      if (
        source !== "explicit" &&
        (operation.kind === "instruction" || target?.kind === "instruction")
      ) {
        continue;
      }

      if (
        target !== undefined &&
        source !== "explicit" &&
        JSON.stringify(target.metadata.correspondents ?? []) !==
          JSON.stringify(operation.correspondents ?? [])
      ) {
        continue;
      }
      if (
        target?.source === "explicit" &&
        source !== "explicit" &&
        !(
          allowDirectUserFactUpdates &&
          target.kind === "learned" &&
          operation.action === "update"
        )
      ) {
        continue;
      }
      if (operation.action === "archive" && source === "explicit") {
        if (target !== undefined) {
          forgotten.push(target);
          recordsById.delete(target.id);
          recordsByKey.delete(target.key);
        }
        continue;
      }
      if (operation.action === "archive") {
        if (target === undefined || target.status === "archived") {
          continue;
        }
        const [updated] = await tx
          .update(aiMemory)
          .set({
            archivedAt: now,
            status: "archived",
            updatedAt: now,
            version: sql`${aiMemory.version} + 1`,
          })
          .where(
            and(
              eq(aiMemory.id, target.id),
              eq(aiMemory.version, target.version)
            )
          )
          .returning();
        if (updated === undefined) {
          throw new ORPCError("CONFLICT", {
            message: "AI memory changed while the update was being applied.",
          });
        }
        changes.push({
          after: toSnapshot(updated),
          before: toSnapshot(target),
          memoryId: updated.id,
          operation: "archive",
        });
        recordsById.set(updated.id, updated);
        recordsByKey.set(updated.key, updated);
        continue;
      }

      const values = buildMemoryValues({
        operation,
        source: target?.source === "explicit" ? "explicit" : source,
      });
      if (target) {
        const [updated] = await tx
          .update(aiMemory)
          .set({
            ...values,
            archivedAt: null,
            lastConfirmedAt: now,
            reinforcementCount: sql`${aiMemory.reinforcementCount} + 1`,
            sourceReference: sourceEventId ?? target.sourceReference,
            status: "active",
            updatedAt: now,
            version: sql`${aiMemory.version} + 1`,
          })
          .where(
            and(
              eq(aiMemory.id, target.id),
              eq(aiMemory.version, target.version)
            )
          )
          .returning();
        if (updated === undefined) {
          throw new ORPCError("CONFLICT", {
            message: "AI memory changed while the update was being applied.",
          });
        }
        changes.push({
          after: toSnapshot(updated),
          before: toSnapshot(target),
          memoryId: updated.id,
          operation: target.status === "archived" ? "restore" : "update",
        });
        recordsById.set(updated.id, updated);
        recordsByKey.set(updated.key, updated);
      } else {
        const [inserted] = await tx
          .insert(aiMemory)
          .values({
            ...values,
            ...scope,
            createdAt: now,
            id: randomUUID(),
            lastConfirmedAt: now,
            sourceReference: sourceEventId ?? null,
            updatedAt: now,
          })
          .returning();
        if (inserted === undefined) {
          throw new Error("Could not create AI memory.");
        }
        changes.push({
          after: toSnapshot(inserted),
          before: null,
          memoryId: inserted.id,
          operation: "add",
        });
        recordsById.set(inserted.id, inserted);
        recordsByKey.set(inserted.key, inserted);
      }
    }

    if (forgotten.length > 0) {
      await eraseAiMemoryRecords({ executor: tx, memories: forgotten, scope });
    }
    if (source === "explicit" && (changes.length > 0 || forgotten.length > 0)) {
      await advanceAiMemoryScopeRevision(tx, scope);
    }
    const [insertedChangeSet] = await tx
      .insert(aiMemoryChangeSet)
      .values({
        changes,
        createdAt: now,
        id: randomUUID(),
        mailboxId: scope.mailboxId,
        request: null,
        source: changeSetSource,
        sourceEventId: sourceEventId ?? null,
        status:
          changes.length > 0 || forgotten.length > 0 ? "applied" : "no_change",
        summary:
          forgotten.length > 0 ? "Forgot the requested memory." : plan.summary,
        updatedAt: now,
        userId: actorUserId,
      })
      .returning();

    if (insertedChangeSet === undefined) {
      throw new Error("Could not record the AI memory change.");
    }

    if (sourceEventIds !== undefined && sourceEventIds.length > 0) {
      await tx
        .update(userAiContextEvent)
        .set({
          lastError: null,
          mergedAt: now,
          metadata: {},
          processingAt: null,
          updatedAt: now,
        })
        .where(
          and(
            inArray(userAiContextEvent.id, sourceEventIds),
            sourceClaimedAt
              ? eq(userAiContextEvent.processingAt, sourceClaimedAt)
              : undefined,
            isNull(userAiContextEvent.mergedAt),
            isNull(userAiContextEvent.skippedAt)
          )
        );
    }

    return { changeSet: insertedChangeSet, changes };
  });
  return appliedChangeSet.changeSet;
};

const createUsageCollector = () => {
  let collected: AiUsageReport | undefined;
  return {
    collect: (usage: AiUsageReport) => {
      collected = usage;
    },
    usage: (): AiUsageReport =>
      collected ?? {
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        costUsd: undefined,
        promptTokens: 0,
      },
  };
};

const reportMemoryUsage = async ({
  externalId,
  mailboxId,
  usage,
  userId,
}: {
  externalId: string;
  mailboxId?: string | null;
  usage: AiUsageReport;
  userId: string;
}) => {
  try {
    await reportAiUsage({
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      externalId,
      ...(mailboxId ? { mailboxId } : {}),
      model: resolveBackgroundModel(),
      promptTokens: usage.promptTokens,
      promptTokensDetails: {
        cacheWriteTokens: usage.cacheWriteTokens,
        cachedTokens: usage.cachedTokens,
      },
      usageKind: "aiMemory",
      userId,
    });
  } catch (error: unknown) {
    reportError(error, { operation: "ai-memory:report-usage" });
  }
};

const planRequestedAiMemoryUpdate = async ({
  allowMutations,
  billingOrganizationId,
  mailboxId,
  mode,
  request,
  scope,
  userId,
  userMessage,
}: {
  allowMutations: boolean;
  billingOrganizationId: string;
  mailboxId: string;
  mode: "request" | "remember";
  request: string;
  scope: MemoryScopeTarget;
  userId: string;
  userMessage?: string | null;
}) => {
  await assertCanUseAi({
    organizationId: billingOrganizationId,
    userId,
  });
  const config = await loadAiMemoryScopeConfig(scope);
  const current =
    mode === "remember"
      ? await listConsolidationMemories({
          events: [
            {
              kind: "explicit_preference",
              metadata: { userMessage: userMessage ?? request },
            },
          ],
          scope,
        })
      : await listScopeMemories(scope.scopeKey);
  const plans: AiMemoryUpdatePlan[] = [];
  const requestId = randomUUID();
  const pageSize =
    mode === "remember"
      ? Math.max(1, current.length)
      : AI_MEMORY_UPDATE_OPERATION_LIMIT;
  for (
    let offset = 0;
    offset < Math.max(1, current.length);
    offset += pageSize
  ) {
    if (offset > 0) {
      await assertCanUseAi({
        organizationId: billingOrganizationId,
        userId,
      });
    }
    const usage = createUsageCollector();
    try {
      plans.push(
        await planAiMemoryUpdate({
          currentMemories: current
            .slice(offset, offset + pageSize)
            .map(toEditorMemory),
          existingEditsOnly: offset > 0,
          learningGuidance: allowMutations
            ? config.learningPrompt
            : `${config.learningPrompt}\n\nThis interaction is read-only. Answer the question and return zero operations.`,
          memoryScope: scope.scope,
          onUsage: usage.collect,
          request,
          source: "explicit",
          userMessage: userMessage ?? request,
        })
      );
    } finally {
      await reportMemoryUsage({
        externalId: `ai-memory-request:${requestId}:${offset}`,
        mailboxId,
        usage: usage.usage(),
        userId,
      });
    }
  }
  const plan: AiMemoryUpdatePlan = {
    answer: plans.map(({ answer }) => answer).join("\n\n"),
    operations: allowMutations
      ? plans.flatMap(({ operations }) => operations)
      : [],
    summary: plans[0]?.summary ?? "Reviewed personal knowledge.",
  };
  return {
    expectedRevision: config.revision,
    expectedVersions: new Map(current.map(({ id, version }) => [id, version])),
    plan,
    scope,
  };
};

export const requestAiMemoryUpdate = async ({
  allowMutations = true,
  changeSetSource = "settings",
  mailboxId,
  mode = "request",
  request,
  scope: requestedScope,
  userId,
  userMessage,
}: {
  allowMutations?: boolean;
  changeSetSource?: "chat" | "settings";
  mailboxId: string;
  mode?: "request" | "remember";
  request: string;
  scope: "mailbox" | "user";
  userId: string;
  /** The acting user's verbatim message, when the caller has one. */
  userMessage?: string | null;
}) => {
  const normalizedRequest = request
    .trim()
    .slice(0, AI_MEMORY_REQUEST_MAX_LENGTH);
  if (!normalizedRequest) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Ask a question or describe what should change.",
    });
  }
  const billingMailbox = await assertAccessibleMailbox({ mailboxId, userId });
  if (
    requestedScope === "mailbox" &&
    allowMutations &&
    !billingMailbox.capabilities.canManageKnowledge
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot change this mailbox's knowledge.",
    });
  }
  const prepared = await planRequestedAiMemoryUpdate({
    allowMutations,
    billingOrganizationId: billingMailbox.organizationId,
    mailboxId,
    mode,
    request: normalizedRequest,
    scope:
      requestedScope === "user" ? userScope(userId) : mailboxScope(mailboxId),
    userId,
    userMessage,
  });
  const changeSet = await applyAiMemoryPlan({
    ...prepared,
    actorUserId: userId,
    changeSetSource,
    source: "explicit",
  });
  return { ...changeSet, answer: prepared.plan.answer };
};

export const recordAiMemoryEvent = async (input: {
  eventKey?: string;
  kind: UserAiContextEventKind;
  mailboxId: string;
  metadata: AiMemoryEventMetadata;
  userId: string;
}) =>
  await db.transaction(async (tx) => {
    const scope =
      input.metadata.memoryScope === "user"
        ? userScope(input.userId)
        : mailboxScope(input.mailboxId);
    if (scope.scope === "user") {
      await tx
        .select({ id: memoryUser.id })
        .from(memoryUser)
        .where(eq(memoryUser.id, input.userId))
        .for("update");
    } else {
      await tx
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(eq(mailbox.id, input.mailboxId))
        .for("update");
    }
    const [config] = await tx
      .select({
        activeLearningEnabled: aiMemoryScopeConfig.activeLearningEnabled,
      })
      .from(aiMemoryScopeConfig)
      .where(eq(aiMemoryScopeConfig.scopeKey, scope.scopeKey))
      .for("share");
    if (config !== undefined && !config.activeLearningEnabled) {
      return null;
    }
    if (input.metadata.source === "bootstrap") {
      const [bootstrap] = await tx
        .select({
          processingAt: aiMemoryMailboxState.processingAt,
          status: aiMemoryMailboxState.status,
        })
        .from(aiMemoryMailboxState)
        .where(eq(aiMemoryMailboxState.mailboxId, input.mailboxId))
        .for("share");
      if (
        bootstrap === undefined ||
        bootstrap.status !== "processing" ||
        bootstrap.processingAt?.toISOString() !== input.metadata.bootstrapLease
      ) {
        return null;
      }
    }
    const [selectedMailbox] = await tx
      .select({ organizationId: mailbox.organizationId })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .limit(1);
    if (selectedMailbox === undefined) {
      return null;
    }
    const now = new Date();
    const [event] = await tx
      .insert(userAiContextEvent)
      .values({
        createdAt: now,
        id: input.eventKey
          ? createHash("sha256")
              .update(
                JSON.stringify([
                  input.userId,
                  input.mailboxId,
                  input.kind,
                  input.metadata.memoryScope,
                  input.eventKey,
                ])
              )
              .digest("hex")
          : randomUUID(),
        kind: input.kind,
        mailboxId: input.mailboxId,
        metadata: sanitizeMetadata(input.metadata),
        organizationId: selectedMailbox.organizationId,
        updatedAt: now,
        userId: input.userId,
      })
      .onConflictDoNothing({ target: userAiContextEvent.id })
      .returning({ id: userAiContextEvent.id });
    return event ?? null;
  });

export const learnAiMemoryFromFeedback = async (input: {
  eventKey?: string;
  kind: UserAiContextEventKind;
  mailboxId: string;
  metadata: AiMemoryEventMetadata;
  userId: string;
}) => {
  const event = await recordAiMemoryEvent({
    ...input,
    metadata: { ...input.metadata, memoryScope: "user" },
  });
  return event === null
    ? { status: "skipped" as const }
    : { eventId: event.id, status: "recorded" as const };
};

const canRunMemoryModel = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!entitlement.hasAccess) {
    return false;
  }
  if (entitlement.hasUnlimitedAccess || !entitlement.account) {
    return true;
  }
  const usage = await getBillingCreditUsage(entitlement.account);
  return usage.costMicroCents < usage.creditAmountMicroCents;
};

const forgetSensitiveAiMemory = async (input: {
  mailboxId: string;
  messageId: string;
  scopes: MemoryScopeTarget[];
  text: string;
  userId: string;
}) => {
  const { scopes } = input;
  const scopePlans: {
    ownedMemoryCondition: ReturnType<typeof and>;
    scope: MemoryScopeTarget;
    targets: MemoryRow[];
  }[] = [];
  const billingMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  for (const scope of scopes) {
    const ownedMemoryCondition = and(
      eq(aiMemory.scopeKey, scope.scopeKey),
      eq(aiMemory.scope, scope.scope),
      scope.scope === "user"
        ? and(eq(aiMemory.userId, input.userId), isNull(aiMemory.mailboxId))
        : and(eq(aiMemory.mailboxId, input.mailboxId), isNull(aiMemory.userId))
    );
    const current = await db
      .select(memoryColumns)
      .from(aiMemory)
      .where(ownedMemoryCondition)
      .orderBy(desc(aiMemory.updatedAt));
    const targetIds: string[] = [];
    for (let offset = 0; offset < current.length; offset += 100) {
      if (
        !(await canRunMemoryModel({
          organizationId: billingMailbox.organizationId,
          userId: input.userId,
        }))
      ) {
        throw new ORPCError("FORBIDDEN", {
          message:
            "Nothing was forgotten because the full memory scan requires available usage balance.",
        });
      }
      const usage = createUsageCollector();
      try {
        targetIds.push(
          ...(await planAiMemoryDeletion({
            currentMemories: current
              .slice(offset, offset + 100)
              .map(toEditorMemory),
            memoryScope: scope.scope,
            onUsage: usage.collect,
            userMessage: input.text,
          }))
        );
      } finally {
        await reportMemoryUsage({
          externalId: `ai-memory-chat-forget:${scope.scope}:${input.messageId}:${offset}`,
          mailboxId: input.mailboxId,
          usage: usage.usage(),
          userId: input.userId,
        });
      }
    }
    const selectedIds = new Set(targetIds);
    const targets = current.filter(({ id }) => selectedIds.has(id));
    if (targets.length > 0) {
      scopePlans.push({ ownedMemoryCondition, scope, targets });
    }
  }
  if (scopePlans.length === 0) {
    return { status: "skipped" as const };
  }
  if (scopes.some((scope) => scope.scope === "mailbox")) {
    const access = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });
    if (!access.capabilities.canManageKnowledge) {
      throw new ORPCError("FORBIDDEN", {
        message: "Nothing was forgotten because your mailbox access changed.",
      });
    }
  }
  await db.transaction(async (tx) => {
    for (const { ownedMemoryCondition, scope, targets } of scopePlans) {
      await lockAiMemoryScope(tx, scope, input.userId);
      const targetCondition = and(
        ownedMemoryCondition,
        inArray(
          aiMemory.id,
          targets.map(({ id }) => id)
        )
      );
      const locked = await tx
        .select(memoryColumns)
        .from(aiMemory)
        .where(targetCondition)
        .for("update");
      if (
        locked.length !== targets.length ||
        locked.some(
          (memory) =>
            memory.version !==
            targets.find(({ id }) => id === memory.id)?.version
        )
      ) {
        throw new ORPCError("CONFLICT", {
          message: "The memory to forget was changed or already forgotten.",
        });
      }
      await eraseAiMemoryRecords({ executor: tx, memories: locked, scope });
      await advanceAiMemoryScopeRevision(tx, scope);
    }
  });
  return { status: "refreshed" as const };
};

const planExistingAiMemoryFromChatMessage = async (input: {
  mailboxId: string;
  messageId: string;
  scope: MemoryScopeTarget;
  text: string;
  userId: string;
}) => {
  const { scope } = input;
  const config = await loadAiMemoryScopeConfig(scope);
  const current = await db
    .select(memoryColumns)
    .from(aiMemory)
    .where(
      and(
        eq(aiMemory.scopeKey, scope.scopeKey),
        eq(aiMemory.status, "active"),
        or(isNull(aiMemory.expiresAt), gt(aiMemory.expiresAt, new Date()))
      )
    )
    .orderBy(desc(aiMemory.updatedAt));
  if (current.length === 0) {
    return null;
  }
  const billingMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const operations: AiMemoryUpdatePlan["operations"] = [];
  for (
    let offset = 0;
    offset < current.length;
    offset += AI_MEMORY_UPDATE_OPERATION_LIMIT
  ) {
    if (
      !(await canRunMemoryModel({
        organizationId: billingMailbox.organizationId,
        userId: input.userId,
      }))
    ) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "Nothing changed because the full memory update requires available usage balance.",
      });
    }
    const batch = current.slice(
      offset,
      offset + AI_MEMORY_UPDATE_OPERATION_LIMIT
    );
    const usage = createUsageCollector();
    try {
      const plan = await planAiMemoryUpdate({
        currentMemories: batch.map(toEditorMemory),
        existingEditsOnly: true,
        memoryScope: scope.scope,
        onUsage: usage.collect,
        request:
          "Apply only an explicit correction or forgetting request for existing knowledge in this scope.",
        source: "explicit",
        userMessage: input.text.slice(0, AI_MEMORY_USER_MESSAGE_MAX_LENGTH),
      });
      operations.push(...plan.operations);
    } finally {
      await reportMemoryUsage({
        externalId: `ai-memory-chat-edit:${scope.scope}:${input.messageId}:${offset}`,
        mailboxId: input.mailboxId,
        usage: usage.usage(),
        userId: input.userId,
      });
    }
  }
  if (operations.length === 0) {
    return null;
  }
  return {
    expectedRevision: config.revision,
    expectedVersions: new Map(current.map(({ id, version }) => [id, version])),
    plan: {
      answer: "Updated the requested knowledge.",
      operations,
      summary: "Updated existing knowledge from an explicit chat request.",
    } satisfies AiMemoryUpdatePlan,
    scope,
  };
};

const learnPersonalAiMemoryFromChatMessage = async (input: {
  bodyText: string;
  mailboxId: string;
  messageId: string;
  scheduleBackgroundTask?: (task: Promise<unknown>) => void;
  userId: string;
}) => {
  const text = input.bodyText.trim();
  if (!text) {
    return { status: "skipped" as const };
  }
  const config = await getPersonalAiMemoryScopeConfig(input.userId);
  if (config.activeLearningEnabled) {
    const result = await learnAiMemoryFromFeedback({
      eventKey: input.messageId,
      kind: "chat_discovery",
      mailboxId: input.mailboxId,
      metadata: {
        ambient: true,
        userMessage: text.slice(0, AI_MEMORY_USER_MESSAGE_MAX_LENGTH),
      },
      userId: input.userId,
    });
    if (
      result.status === "recorded" &&
      input.scheduleBackgroundTask !== undefined
    ) {
      input.scheduleBackgroundTask(
        (async () => {
          try {
            // oxlint-disable-next-line eslint/no-use-before-define
            await refreshAiMemoryFromEvent({ eventId: result.eventId });
          } catch (error) {
            if (!(error instanceof ORPCError) || error.status >= 500) {
              reportError(error, { operation: "chat:learn-personal-context" });
            }
          }
        })()
      );
    }
    return { status: result.status };
  }

  return { status: "skipped" as const };
};

export const learnAiMemoryFromChatMessage = async (
  input: Parameters<typeof learnPersonalAiMemoryFromChatMessage>[0]
) => {
  const text = input.bodyText.trim();
  if (!text) {
    return { explicit: false, status: "skipped" as const };
  }
  const accessibleMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  let editIntent: Awaited<ReturnType<typeof classifyAiMemoryEditIntent>>;
  if (containsProhibitedMemorySecret(text)) {
    editIntent = "forget_sensitive";
  } else {
    await assertCanUseAi({
      organizationId: accessibleMailbox.organizationId,
      userId: input.userId,
    });
    const usage = createUsageCollector();
    try {
      editIntent = await classifyAiMemoryEditIntent({
        onUsage: usage.collect,
        userMessage: text,
      });
    } finally {
      await reportMemoryUsage({
        externalId: `ai-memory-chat-edit-intent:${input.messageId}`,
        mailboxId: input.mailboxId,
        usage: usage.usage(),
        userId: input.userId,
      });
    }
  }
  if (editIntent === "forget_sensitive") {
    const scope = userScope(input.userId);
    const result = await forgetSensitiveAiMemory({
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      scopes: accessibleMailbox.capabilities.canManageKnowledge
        ? [scope, mailboxScope(input.mailboxId)]
        : [scope],
      text,
      userId: input.userId,
    });
    return { ...result, explicit: true };
  }
  if (editIntent === "none") {
    return {
      ...(await learnPersonalAiMemoryFromChatMessage(input)),
      explicit: false,
    };
  }
  const scopes = accessibleMailbox.capabilities.canManageKnowledge
    ? [userScope(input.userId), mailboxScope(input.mailboxId)]
    : [userScope(input.userId)];
  const scopePlans: NonNullable<
    Awaited<ReturnType<typeof planExistingAiMemoryFromChatMessage>>
  >[] = [];
  for (const scope of scopes) {
    const plan =
      editIntent === "add"
        ? await planRequestedAiMemoryUpdate({
            allowMutations: true,
            billingOrganizationId: accessibleMailbox.organizationId,
            mailboxId: input.mailboxId,
            mode: "remember",
            request:
              "Remember only the knowledge the user explicitly asks to save in this scope. An addition with no named scope belongs only in the personal profile. The user's verbatim words determine ownership; do not copy personal facts into mailbox knowledge.",
            scope,
            userId: input.userId,
            userMessage: text,
          })
        : await planExistingAiMemoryFromChatMessage({
            mailboxId: input.mailboxId,
            messageId: input.messageId,
            scope,
            text,
            userId: input.userId,
          });
    if (plan !== null && plan.plan.operations.length > 0) {
      scopePlans.push(plan);
    }
  }
  if (scopePlans.length === 0) {
    return { explicit: true, status: "skipped" as const };
  }
  if (scopePlans.some(({ scope }) => scope.scope === "mailbox")) {
    const access = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });
    if (!access.capabilities.canManageKnowledge) {
      throw new ORPCError("FORBIDDEN", {
        message: "Nothing changed because your mailbox access changed.",
      });
    }
  }
  const appliedChanges = await db.transaction(async (tx) => {
    const applied: Awaited<ReturnType<typeof applyAiMemoryPlan>>[] = [];
    for (const {
      expectedRevision,
      expectedVersions,
      plan,
      scope,
    } of scopePlans) {
      applied.push(
        await applyAiMemoryPlan({
          actorUserId: input.userId,
          changeSetSource: "chat",
          executor: tx,
          existingEditsOnly: editIntent !== "add",
          expectedRevision,
          expectedVersions,
          plan,
          scope,
          source: "explicit",
        })
      );
    }
    return applied;
  });
  return {
    explicit: true,
    status: appliedChanges.some((changeSet) => changeSet.status === "applied")
      ? ("refreshed" as const)
      : ("skipped" as const),
  };
};

const resolveMemorySource = (
  kind: UserAiContextEventKind
): "explicit" | "feedback" | "inferred" => {
  if (kind === "explicit_preference") {
    return "explicit";
  }
  if (kind === "auto_label_feedback" || kind === "useful_detail_feedback") {
    return "feedback";
  }
  return "inferred";
};

const resolveChangeSetSource = (
  kind: UserAiContextEventKind
): "chat" | "feedback" | "system" => {
  const memorySource = resolveMemorySource(kind);
  if (memorySource === "explicit") {
    return "chat";
  }
  if (memorySource === "feedback") {
    return "feedback";
  }
  return "system";
};

export const refreshAiMemoryFromEvent = async ({
  eventId,
}: {
  eventId: string;
}) => {
  const [candidate] = await db
    .select()
    .from(userAiContextEvent)
    .where(eq(userAiContextEvent.id, eventId))
    .limit(1);
  if (
    candidate === undefined ||
    candidate.mergedAt !== null ||
    candidate.skippedAt !== null
  ) {
    return { status: "skipped" as const };
  }
  const claimedAt = new Date();
  const [event] = await db
    .update(userAiContextEvent)
    .set({ processingAt: claimedAt, updatedAt: claimedAt })
    .where(
      and(
        eq(userAiContextEvent.id, candidate.id),
        isNull(userAiContextEvent.mergedAt),
        isNull(userAiContextEvent.skippedAt),
        or(
          isNull(userAiContextEvent.processingAt),
          lt(
            userAiContextEvent.processingAt,
            new Date(claimedAt.getTime() - 120_000)
          )
        )
      )
    )
    .returning();
  if (event === undefined) {
    return { status: "skipped" as const };
  }

  const [existingChangeSet] = await db
    .select({ id: aiMemoryChangeSet.id })
    .from(aiMemoryChangeSet)
    .where(eq(aiMemoryChangeSet.sourceEventId, event.id))
    .limit(1);
  if (existingChangeSet !== undefined) {
    await db
      .update(userAiContextEvent)
      .set({
        lastError: null,
        mergedAt: new Date(),
        metadata: {},
        processingAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userAiContextEvent.id, event.id),
          eq(userAiContextEvent.processingAt, claimedAt),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt)
        )
      );
    return { status: "refreshed" as const };
  }

  if (
    !(await canRunMemoryModel({
      organizationId: event.organizationId,
      userId: event.userId,
    }))
  ) {
    await db
      .update(userAiContextEvent)
      .set({
        lastError: "AI memory update requires available usage balance.",
        processingAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userAiContextEvent.id, event.id),
          eq(userAiContextEvent.processingAt, claimedAt),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt)
        )
      );
    return { status: "ineligible" as const };
  }

  const memorySource = resolveMemorySource(event.kind);
  const isExplicit = memorySource === "explicit";
  const scope =
    event.metadata.memoryScope === "user"
      ? userScope(event.userId)
      : mailboxScope(event.mailboxId);
  const config = await loadAiMemoryScopeConfig(scope);
  if (
    (!isExplicit || event.metadata.ambient === true) &&
    !config.activeLearningEnabled
  ) {
    await db
      .update(userAiContextEvent)
      .set({
        lastError: null,
        metadata: {},
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userAiContextEvent.id, event.id),
          eq(userAiContextEvent.processingAt, claimedAt),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt)
        )
      );
    return { status: "skipped" as const };
  }
  let accessibleMailbox;
  try {
    accessibleMailbox = await assertAccessibleMailbox({
      mailboxId: event.mailboxId,
      userId: event.userId,
    });
  } catch (error) {
    if (
      !(error instanceof ORPCError) ||
      (error.code !== "NOT_FOUND" && error.code !== "FORBIDDEN")
    ) {
      throw error;
    }
    await db
      .update(userAiContextEvent)
      .set({
        metadata: {},
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userAiContextEvent.id, event.id),
          eq(userAiContextEvent.processingAt, claimedAt),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt)
        )
      );
    return { status: "skipped" as const };
  }
  if (
    scope.scope === "mailbox" &&
    !accessibleMailbox.capabilities.canManageKnowledge
  ) {
    await db
      .update(userAiContextEvent)
      .set({
        metadata: {},
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userAiContextEvent.id, event.id),
          eq(userAiContextEvent.processingAt, claimedAt),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt)
        )
      );
    return { status: "skipped" as const };
  }
  const siblingLimit = isExplicit ? 0 : 3;
  const pending = await db
    .select({ id: userAiContextEvent.id })
    .from(userAiContextEvent)
    .where(
      and(
        ne(userAiContextEvent.id, event.id),
        eq(userAiContextEvent.userId, event.userId),
        eq(userAiContextEvent.mailboxId, event.mailboxId),
        eq(userAiContextEvent.kind, event.kind),
        eq(
          sql<string>`coalesce(${userAiContextEvent.metadata}->>'memoryScope', 'mailbox')`,
          scope.scope
        ),
        isNull(userAiContextEvent.mergedAt),
        isNull(userAiContextEvent.skippedAt),
        or(
          isNull(userAiContextEvent.processingAt),
          lt(
            userAiContextEvent.processingAt,
            new Date(claimedAt.getTime() - 120_000)
          )
        )
      )
    )
    .orderBy(asc(userAiContextEvent.createdAt))
    .limit(siblingLimit);
  const siblings =
    pending.length === 0
      ? []
      : await db
          .update(userAiContextEvent)
          .set({ processingAt: claimedAt, updatedAt: claimedAt })
          .where(
            and(
              inArray(
                userAiContextEvent.id,
                pending.map(({ id }) => id)
              ),
              isNull(userAiContextEvent.mergedAt),
              isNull(userAiContextEvent.skippedAt),
              or(
                isNull(userAiContextEvent.processingAt),
                lt(
                  userAiContextEvent.processingAt,
                  new Date(claimedAt.getTime() - 120_000)
                )
              )
            )
          )
          .returning();
  const claimedEvents = [event, ...siblings].toSorted(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
  );
  const events: typeof claimedEvents = [];
  try {
    for (const claimed of claimedEvents) {
      if (
        claimed.metadata.hydrateMessage !== true ||
        typeof claimed.metadata.messageId !== "string"
      ) {
        events.push(claimed);
        continue;
      }
      const { hydrateMailMemoryEvent } = await import("./ai-memory-capture");
      const hydrated = await hydrateMailMemoryEvent({
        mailboxId: claimed.mailboxId,
        messageId: claimed.metadata.messageId,
        userId: claimed.userId,
      });
      if (hydrated === null) {
        if (
          claimed.metadata.messageContextOnly === true &&
          typeof claimed.metadata.action === "string"
        ) {
          events.push({
            ...claimed,
            metadata: {
              ...claimed.metadata,
              hydrateMessage: false,
              messageUnavailable: true,
            },
          });
          continue;
        }
        await db
          .update(userAiContextEvent)
          .set({
            lastError: null,
            metadata: {},
            processingAt: null,
            skippedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(userAiContextEvent.id, claimed.id),
              eq(userAiContextEvent.processingAt, claimedAt),
              isNull(userAiContextEvent.mergedAt),
              isNull(userAiContextEvent.skippedAt)
            )
          );
        continue;
      }
      events.push({
        ...claimed,
        metadata: {
          ...claimed.metadata,
          ...sanitizeMetadata(hydrated),
          hydrateMessage: false,
          memoryScope: claimed.metadata.memoryScope ?? "mailbox",
          observationKind:
            claimed.metadata.observationKind ?? hydrated.observationKind,
          source: claimed.metadata.source ?? null,
        },
      });
    }
  } catch {
    await db
      .update(userAiContextEvent)
      .set({
        lastError: "Message details could not be loaded for learning.",
        processingAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(
            userAiContextEvent.id,
            claimedEvents.map(({ id }) => id)
          ),
          eq(userAiContextEvent.processingAt, claimedAt),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt)
        )
      );
    reportError(new Error("Message memory hydration failed."), {
      operation: "ai-memory:hydrate-observations",
    });
    return { status: "failed" as const };
  }
  if (events.length === 0) {
    return { status: "skipped" as const };
  }
  const sourceEventIds = events.map(({ id }) => id);
  const observations: AiMemoryObservation[] = events.map(
    ({ createdAt, kind, metadata }) => ({
      kind:
        typeof metadata.observationKind === "string"
          ? metadata.observationKind
          : kind,
      metadata: {
        ...Object.fromEntries(
          Object.entries(metadata).filter(([key]) => key !== "userMessage")
        ),
        observedAt: createdAt.toISOString(),
        previouslyProcessed: false,
      },
    })
  );
  const userMessages = events
    .map(({ metadata }) => metadata.userMessage)
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim() !== ""
    );
  const request =
    "Consolidate these observations into the user's current profile. Learn durable context automatically and update existing concepts instead of duplicating them.";
  const usage = createUsageCollector();

  try {
    const current = await listConsolidationMemories({ events, scope });
    const plan = await planAiMemoryUpdate({
      currentMemories: current.map(toEditorMemory),
      learningGuidance: config.learningPrompt,
      memoryScope: scope.scope,
      observations,
      onUsage: usage.collect,
      request,
      source: memorySource,
      userMessages,
    });
    const changeSet = await applyAiMemoryPlan({
      actorUserId: event.userId,
      allowDirectUserFactUpdates: events.every(
        (observation) =>
          observation.kind === "chat_discovery" &&
          observation.metadata.memoryScope === "user" &&
          typeof observation.metadata.userMessage === "string" &&
          observation.metadata.userMessage.trim() !== ""
      ),
      changeSetSource: resolveChangeSetSource(event.kind),
      expectedRevision: config.revision,
      expectedVersions: new Map(
        current.map(({ id, version }) => [id, version])
      ),
      plan,
      scope,
      source: memorySource,
      sourceClaimedAt: claimedAt,
      sourceEventId: events[0]?.id ?? event.id,
      sourceEventIds,
      sourceEventMailboxId: event.mailboxId,
    });
    await reportMemoryUsage({
      externalId: `ai-memory-event:${event.id}:${changeSet.id}`,
      mailboxId: event.mailboxId,
      usage: usage.usage(),
      userId: event.userId,
    });
    return { status: "refreshed" as const };
  } catch (error) {
    if (!(error instanceof ORPCError) || error.code !== "CONFLICT") {
      reportError(new Error("Memory observation consolidation failed."), {
        operation: "ai-memory:consolidate-observations",
      });
    }
    await reportMemoryUsage({
      externalId: `ai-memory-event:${event.id}:failed:${claimedAt.getTime()}`,
      mailboxId: event.mailboxId,
      usage: usage.usage(),
      userId: event.userId,
    });
    await db
      .update(userAiContextEvent)
      .set({
        lastError: "The memory update could not be applied.",
        processingAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(userAiContextEvent.id, sourceEventIds),
          eq(userAiContextEvent.processingAt, claimedAt),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt)
        )
      );
    return { status: "failed" as const };
  }
};

export const processPendingAiMemoryEvents = async ({
  allowLocal = false,
  userId,
}: { allowLocal?: boolean; userId?: string } = {}) => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local" && !allowLocal) {
    return { failed: 0, processed: 0 };
  }
  const cutoff = new Date(Date.now() - 120_000);
  const pending = await retryIdempotentDatabaseQuery(
    async () =>
      await db
        .select({ id: userAiContextEvent.id })
        .from(userAiContextEvent)
        .where(
          and(
            isNull(userAiContextEvent.mergedAt),
            isNull(userAiContextEvent.skippedAt),
            userId === undefined
              ? undefined
              : eq(userAiContextEvent.userId, userId),
            or(
              isNull(userAiContextEvent.processingAt),
              lt(userAiContextEvent.processingAt, cutoff)
            ),
            allowLocal ? undefined : lt(userAiContextEvent.updatedAt, cutoff)
          )
        )
        .orderBy(userAiContextEvent.updatedAt)
        .limit(4)
  );
  let processed = 0;
  let failed = 0;
  for (const event of pending) {
    try {
      const result = await refreshAiMemoryFromEvent({ eventId: event.id });
      if (result.status === "refreshed") {
        processed += 1;
      } else if (result.status === "failed") {
        failed += 1;
      }
    } catch {
      failed += 1;
      reportError(
        new Error("Pending memory observation could not be processed."),
        {
          operation: "ai-memory:process-pending-event",
        }
      );
    }
  }
  return { failed, processed };
};

export const learnAiMemoryFromMailAction = async ({
  action,
  eventKey,
  mailboxId,
  messageIds,
  metadata = {},
  targetCount,
  userId,
}: {
  action: string;
  eventKey?: string;
  mailboxId: string;
  messageIds?: string[];
  metadata?: AiMemoryEventMetadata;
  targetCount: number;
  userId: string;
}) => {
  if (targetCount < 1) {
    return { status: "skipped" as const };
  }
  const access = await assertAccessibleMailbox({ mailboxId, userId });
  const [owner] = await db
    .select({
      accessMode: mailbox.accessMode,
      managedOwnerUserId: mailbox.managedOwnerUserId,
      ownerUserId: mailbox.ownerUserId,
      provider: mailbox.provider,
    })
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .limit(1);
  const personal =
    owner?.provider === "gmail"
      ? owner.ownerUserId === userId
      : owner?.accessMode === "private" && owner.managedOwnerUserId === userId;
  if (!personal && !access.capabilities.canManageKnowledge) {
    return { status: "skipped" as const };
  }
  const config = personal
    ? await getPersonalAiMemoryScopeConfig(userId)
    : await getMailboxAiMemoryScopeConfig(mailboxId);
  if (!config.activeLearningEnabled) {
    return { status: "skipped" as const };
  }
  const actionKey = eventKey ?? randomUUID();
  let event: { id: string } | null = null;
  const targets =
    messageIds !== undefined && messageIds.length > 0
      ? [...new Set(messageIds)]
      : [null];
  for (const messageId of targets) {
    const recorded = await recordAiMemoryEvent({
      eventKey: `action:${actionKey}:${action}:${messageId ?? "all"}`,
      kind: "mail_action",
      mailboxId,
      metadata: {
        ...metadata,
        action,
        hydrateMessage: messageId !== null,
        memoryScope: personal ? "user" : "mailbox",
        messageContextOnly: true,
        messageId,
        observationKind: "mail_action",
        targetCount,
      },
      userId,
    });
    event ??= recorded;
  }
  return event === null
    ? { status: "skipped" as const }
    : { eventId: event.id, status: "recorded" as const };
};

export const replaceMailboxFeedbackMemories = async ({
  agent,
  expectedRevision,
  memories,
  mailboxId,
  userId,
}: {
  agent: "auto_label";
  expectedRevision: number;
  memories: {
    confidence: number;
    content: string;
    importance: number;
    key: string;
    metadata?: AiMemoryMetadata;
    reinforcementCount: number;
    sourceDomains?: string[];
    summary: string;
    topics: string[];
  }[];
  mailboxId: string;
  userId: string;
}) => {
  const prefix = `feedback:${agent}:`;
  const scope = mailboxScope(mailboxId);
  const [accessibleMailbox, config] = await Promise.all([
    assertAccessibleMailbox({ mailboxId, userId }),
    getMailboxAiMemoryScopeConfig(mailboxId),
  ]);
  if (
    !accessibleMailbox.capabilities.canManageKnowledge ||
    !config.activeLearningEnabled
  ) {
    return { changed: 0 };
  }
  const now = new Date();
  const changes = await db.transaction(async (tx) => {
    const latestConfig = await lockAiMemoryScope(tx, scope, userId);
    if (
      !latestConfig.activeLearningEnabled ||
      latestConfig.revision !== expectedRevision
    ) {
      return [];
    }
    const current = await tx
      .select(memoryColumns)
      .from(aiMemory)
      .where(
        and(
          eq(aiMemory.scopeKey, scope.scopeKey),
          like(aiMemory.key, `${prefix}%`)
        )
      );
    const byKey = new Map(current.map((memory) => [memory.key, memory]));
    const nextKeys = new Set(
      memories.map((memory) => `${prefix}${memory.key}`)
    );
    const applied: AiMemoryChange[] = [];

    for (const memory of memories) {
      const key = `${prefix}${memory.key}`;
      const existing = byKey.get(key);
      const values = {
        confidence: memory.confidence,
        content: memory.content.slice(0, 2000),
        importance: memory.importance,
        key,
        kind: "learned" as const,
        lastConfirmedAt: now,
        metadata: {
          ...memory.metadata,
          agents: [agent],
          category: "labeling",
          sourceDomains: memory.sourceDomains ?? [],
          topics: memory.topics,
        } satisfies AiMemoryMetadata,
        reinforcementCount: Math.max(1, memory.reinforcementCount),
        source: "feedback" as const,
        sourceReference: `feedback:${agent}`,
        status: "active" as const,
        summary: memory.summary.slice(0, 300),
        updatedAt: now,
      };
      if (existing?.source === "explicit") {
        continue;
      }
      if (existing) {
        const unchanged =
          existing.content === values.content &&
          existing.summary === values.summary &&
          existing.confidence === values.confidence &&
          existing.importance === values.importance &&
          existing.reinforcementCount === values.reinforcementCount &&
          JSON.stringify(existing.metadata) ===
            JSON.stringify(values.metadata) &&
          existing.status === "active";
        if (unchanged) {
          continue;
        }
        const [updated] = await tx
          .update(aiMemory)
          .set({
            ...values,
            archivedAt: null,
            version: sql`${aiMemory.version} + 1`,
          })
          .where(
            and(
              eq(aiMemory.id, existing.id),
              eq(aiMemory.version, existing.version)
            )
          )
          .returning();
        if (updated === undefined) {
          throw new Error(
            "Mailbox memory changed while feedback was being applied."
          );
        }
        applied.push({
          after: toSnapshot(updated),
          before: toSnapshot(existing),
          memoryId: updated.id,
          operation: existing.status === "archived" ? "restore" : "update",
        });
      } else {
        const [inserted] = await tx
          .insert(aiMemory)
          .values({ ...scope, ...values, createdAt: now, id: randomUUID() })
          .returning();
        if (inserted === undefined) {
          throw new Error("Could not create mailbox feedback memory.");
        }
        applied.push({
          after: toSnapshot(inserted),
          before: null,
          memoryId: inserted.id,
          operation: "add",
        });
      }
    }

    for (const existing of current) {
      if (
        nextKeys.has(existing.key) ||
        existing.status === "archived" ||
        existing.source === "explicit"
      ) {
        continue;
      }
      const [archived] = await tx
        .update(aiMemory)
        .set({
          archivedAt: now,
          status: "archived",
          updatedAt: now,
          version: sql`${aiMemory.version} + 1`,
        })
        .where(
          and(
            eq(aiMemory.id, existing.id),
            eq(aiMemory.version, existing.version)
          )
        )
        .returning();
      if (archived === undefined) {
        throw new Error(
          "Mailbox memory changed while feedback was being applied."
        );
      }
      applied.push({
        after: toSnapshot(archived),
        before: toSnapshot(existing),
        memoryId: archived.id,
        operation: "archive",
      });
    }
    if (applied.length === 0) {
      return [];
    }

    await tx.insert(aiMemoryChangeSet).values({
      changes: applied,
      createdAt: now,
      id: randomUUID(),
      mailboxId,
      source: "feedback",
      status: "applied",
      summary: "Updated auto-labeling memory from feedback.",
      updatedAt: now,
      userId,
    });
    return applied;
  });
  return { changed: changes.length };
};

const buildAiMemoryScope = ({
  changes,
  memories,
}: {
  changes: (typeof aiMemoryChangeSet.$inferSelect)[];
  memories: MemoryRow[];
}) => {
  const now = new Date();
  const activeMemories = memories.filter(
    (memory) =>
      memory.status === "active" &&
      (memory.expiresAt === null || memory.expiresAt > now)
  );

  return {
    activeCount: activeMemories.length,
    archivedCount: memories.filter((memory) => memory.status === "archived")
      .length,
    items: activeMemories.map((memory) => ({
      content: memory.content,
      id: memory.id,
      kind: memory.kind,
      summary: memory.summary,
      updatedAt: memory.updatedAt,
    })),
    recentChanges: changes
      .filter((change) => change.status === "applied")
      .map((change) => ({
        createdAt: change.createdAt,
        id: change.id,
        source: change.source,
        status: change.status,
        summary: change.summary,
      })),
  };
};

const listAiMemoryScope = async ({
  mailboxId,
  scope,
  userId,
}: {
  mailboxId?: string | null;
  scope: "mailbox" | "user";
  userId: string;
}) => {
  const target =
    scope === "user" ? userScope(userId) : mailboxScope(mailboxId ?? "");
  if (scope === "mailbox" && !mailboxId) {
    throw new ORPCError("BAD_REQUEST", { message: "A mailbox is required." });
  }
  const [memories, changes] = await Promise.all([
    listScopeMemories(target.scopeKey),
    db
      .select()
      .from(aiMemoryChangeSet)
      .where(
        scope === "user"
          ? and(
              eq(aiMemoryChangeSet.userId, userId),
              isNull(aiMemoryChangeSet.mailboxId)
            )
          : eq(aiMemoryChangeSet.mailboxId, mailboxId ?? "")
      )
      .orderBy(desc(aiMemoryChangeSet.createdAt))
      .limit(12),
  ]);
  return buildAiMemoryScope({ changes, memories });
};

export const listPersonalAiMemory = async (userId: string) =>
  await listAiMemoryScope({ scope: "user", userId });

export const listMailboxAiMemory = async (mailboxId: string, userId: string) =>
  await listAiMemoryScope({ mailboxId, scope: "mailbox", userId });

const resolveAiMemoryScope = async ({
  mailboxId,
  scope,
  userId,
  write = false,
}: {
  mailboxId?: string | null;
  scope: "mailbox" | "user";
  userId: string;
  write?: boolean;
}) => {
  if (scope === "user") {
    return userScope(userId);
  }
  if (!mailboxId) {
    throw new ORPCError("BAD_REQUEST", { message: "A mailbox is required." });
  }
  const access = await assertAccessibleMailbox({ mailboxId, userId });
  if (write && !access.capabilities.canManageKnowledge) {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot change this mailbox's knowledge.",
    });
  }
  return mailboxScope(mailboxId);
};

const toSearchMemory = (memory: MemoryRow) => ({
  category: memory.metadata.category ?? "preferences",
  content: memory.content,
  correspondents: memory.metadata.correspondents ?? [],
  id: memory.id,
  kind: memory.kind,
  source: memory.source,
  summary: memory.summary,
  updatedAt: memory.updatedAt.toISOString(),
  version: memory.version,
});

export const searchAiMemory = async ({
  category,
  cursor,
  limit = 50,
  mailboxId,
  query,
  scope,
  userId,
}: {
  category?: AiMemoryCategory;
  cursor?: string | null;
  limit?: number;
  mailboxId?: string | null;
  query?: string;
  scope: "mailbox" | "user";
  userId: string;
}) => {
  const target = await resolveAiMemoryScope({ mailboxId, scope, userId });
  const pageSize = Math.max(1, Math.min(100, Math.floor(limit)));
  const search = query?.trim().slice(0, 2000);
  const where = and(
    eq(aiMemory.scopeKey, target.scopeKey),
    eq(aiMemory.scope, target.scope),
    target.scope === "user"
      ? eq(aiMemory.userId, userId)
      : eq(aiMemory.mailboxId, mailboxId ?? ""),
    eq(aiMemory.status, "active"),
    or(isNull(aiMemory.expiresAt), gt(aiMemory.expiresAt, new Date())),
    category
      ? eq(
          sql<string>`coalesce(${aiMemory.metadata}->>'category', 'preferences')`,
          category
        )
      : undefined,
    search
      ? or(
          ilike(aiMemory.content, `%${search.replaceAll(/[\\%_]/gu, "\\$&")}%`),
          ilike(aiMemory.summary, `%${search.replaceAll(/[\\%_]/gu, "\\$&")}%`),
          ilike(
            sql<string>`${aiMemory.metadata}->>'correspondents'`,
            `%${search.replaceAll(/[\\%_]/gu, "\\$&")}%`
          )
        )
      : undefined
  );
  const [rows, totals] = await Promise.all([
    db
      .select(memoryColumns)
      .from(aiMemory)
      .where(and(where, cursor ? gt(aiMemory.id, cursor) : undefined))
      .orderBy(asc(aiMemory.id))
      .limit(pageSize + 1),
    db.select({ total: count() }).from(aiMemory).where(where),
  ]);
  const items = rows.slice(0, pageSize).map(toSearchMemory);
  return {
    items,
    nextCursor: rows.length > pageSize ? (items.at(-1)?.id ?? null) : null,
    total: totals[0]?.total ?? 0,
  };
};

export const saveAiMemory = async ({
  category,
  content,
  correspondents = [],
  mailboxId,
  memoryId,
  scope,
  userId,
  version,
}: {
  category: AiMemoryCategory;
  content: string;
  correspondents?: string[];
  mailboxId?: string | null;
  memoryId?: string;
  scope: "mailbox" | "user";
  userId: string;
  version?: number;
}) => {
  const target = await resolveAiMemoryScope({
    mailboxId,
    scope,
    userId,
    write: true,
  });
  const normalizedContent = content.replaceAll(/\r\n?/gu, "\n").trim();
  if (
    !normalizedContent ||
    normalizedContent.length > AI_MEMORY_CONTENT_MAX_LENGTH
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Memory must contain text within the allowed length.",
    });
  }
  if (containsProhibitedMemorySecret(normalizedContent)) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Passwords, payment details, and access codes cannot be saved as memory.",
    });
  }
  const contacts = z
    .array(z.email().max(320))
    .max(20)
    .safeParse([
      ...new Set(correspondents.map((address) => address.trim().toLowerCase())),
    ]);
  if (!contacts.success) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Use valid email addresses for the people this memory applies to.",
    });
  }
  return await db.transaction(async (tx) => {
    await lockAiMemoryScope(tx, target, userId);
    const [existing] = memoryId
      ? await tx
          .select(memoryColumns)
          .from(aiMemory)
          .where(
            and(
              eq(aiMemory.id, memoryId),
              eq(aiMemory.scopeKey, target.scopeKey)
            )
          )
          .for("update")
      : [];
    if (
      memoryId &&
      (existing === undefined ||
        version === undefined ||
        existing.version !== version)
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "That memory changed or was forgotten. Review the latest version.",
      });
    }
    const now = new Date();
    const values = {
      archivedAt: null,
      confidence: 1,
      content: normalizedContent,
      expiresAt: null,
      importance: 5,
      kind: existing?.kind ?? "learned",
      lastConfirmedAt: now,
      metadata: {
        agents: existing?.metadata.agents ?? ["all"],
        category,
        correspondents: contacts.data.toSorted(),
        topics: existing?.metadata.topics ?? [],
      },
      source: "explicit" as const,
      status: "active" as const,
      summary: normalizedContent.replaceAll(/\s+/gu, " ").slice(0, 300),
      updatedAt: now,
    };
    const [saved] =
      existing === undefined
        ? await tx
            .insert(aiMemory)
            .values({
              ...target,
              ...values,
              createdAt: now,
              id: randomUUID(),
              key: `manual:${randomUUID()}`,
            })
            .returning()
        : await tx
            .update(aiMemory)
            .set({ ...values, version: sql`${aiMemory.version} + 1` })
            .where(
              and(
                eq(aiMemory.id, existing.id),
                eq(aiMemory.version, version ?? 0)
              )
            )
            .returning();
    if (saved === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "That memory changed while it was being saved. Try again.",
      });
    }
    await advanceAiMemoryScopeRevision(tx, target);
    return toSearchMemory(saved);
  });
};

export const forgetAiMemory = async ({
  mailboxId,
  memoryId,
  scope,
  userId,
}: {
  mailboxId?: string | null;
  memoryId: string;
  scope: "mailbox" | "user";
  userId: string;
}) => {
  const target = await resolveAiMemoryScope({
    mailboxId,
    scope,
    userId,
    write: true,
  });
  return await db.transaction(async (tx) => {
    await lockAiMemoryScope(tx, target, userId);
    const memories = await tx
      .select(memoryColumns)
      .from(aiMemory)
      .where(
        and(eq(aiMemory.id, memoryId), eq(aiMemory.scopeKey, target.scopeKey))
      )
      .for("update");
    await eraseAiMemoryRecords({ executor: tx, memories, scope: target });
    await advanceAiMemoryScopeRevision(tx, target);
    return { deleted: true };
  });
};

export const purgePersonalAiMemory = async (userId: string) =>
  await db.transaction(async (tx) => {
    const scope = userScope(userId);
    await lockAiMemoryScope(tx, scope);
    await advanceAiMemoryScopeRevision(tx, scope);
    await tx.delete(aiMemory).where(eq(aiMemory.scopeKey, scope.scopeKey));
    await tx
      .delete(aiMemoryChangeSet)
      .where(
        and(
          eq(aiMemoryChangeSet.userId, userId),
          isNull(aiMemoryChangeSet.mailboxId)
        )
      );
    const now = new Date();
    await tx
      .update(userAiContextEvent)
      .set({
        lastError: null,
        metadata: {},
        processingAt: null,
        skippedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(userAiContextEvent.userId, userId),
          or(
            eq(userAiContextEvent.kind, "chat_discovery"),
            eq(userAiContextEvent.kind, "explicit_preference"),
            eq(
              sql<string>`${userAiContextEvent.metadata}->>'memoryScope'`,
              "user"
            )
          )
        )
      );
    await completeAiMemoryBootstrap(tx, scope);
    return { deleted: true };
  });

export const purgeMailboxAiMemory = async (mailboxId: string) =>
  await db.transaction(async (tx) => {
    const scope = mailboxScope(mailboxId);
    await lockAiMemoryScope(tx, scope);
    await advanceAiMemoryScopeRevision(tx, scope);
    await tx.delete(aiMemory).where(eq(aiMemory.scopeKey, scope.scopeKey));
    await tx
      .delete(aiMemoryChangeSet)
      .where(eq(aiMemoryChangeSet.mailboxId, mailboxId));
    const now = new Date();
    await tx
      .update(userAiContextEvent)
      .set({
        lastError: null,
        metadata: {},
        processingAt: null,
        skippedAt: now,
        updatedAt: now,
      })
      .where(memoryEventScopeCondition(scope));
    await completeAiMemoryBootstrap(tx, scope);
    await tx
      .delete(mailAutoLabelFeedback)
      .where(eq(mailAutoLabelFeedback.mailboxId, mailboxId));
    await tx
      .delete(gmailUsefulDetailFeedback)
      .where(eq(gmailUsefulDetailFeedback.mailboxId, mailboxId));
    await tx
      .delete(mailAutomationMemoryProfile)
      .where(eq(mailAutomationMemoryProfile.mailboxId, mailboxId));
    return { deleted: true };
  });

export const exportPersonalAiMemory = async (userId: string) => {
  const [memories, learning] = await Promise.all([
    listScopeMemories(`user:${userId}`),
    getPersonalAiMemoryScopeConfig(userId),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    learning,
    memories: memories.map((memory) => ({
      agents: memory.metadata.agents ?? ["all"],
      category: memory.metadata.category ?? "preferences",
      content: memory.content,
      correspondents: memory.metadata.correspondents ?? [],
      expiresAt: memory.expiresAt?.toISOString() ?? null,
      kind: memory.kind,
      status: memory.status,
      summary: memory.summary,
      topics: memory.metadata.topics ?? [],
      updatedAt: memory.updatedAt.toISOString(),
    })),
    version: 1,
  };
};

export const exportMailboxAiMemory = async (mailboxId: string) => {
  const [memories, learning] = await Promise.all([
    listScopeMemories(`mailbox:${mailboxId}`),
    getMailboxAiMemoryScopeConfig(mailboxId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    learning,
    mailboxId,
    memories: memories.map((memory) => ({
      agents: memory.metadata.agents ?? ["all"],
      category: memory.metadata.category ?? "preferences",
      content: memory.content,
      correspondents: memory.metadata.correspondents ?? [],
      expiresAt: memory.expiresAt?.toISOString() ?? null,
      kind: memory.kind,
      status: memory.status,
      summary: memory.summary,
      topics: memory.metadata.topics ?? [],
      updatedAt: memory.updatedAt.toISOString(),
    })),
    version: 1,
  };
};
