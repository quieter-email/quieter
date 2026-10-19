import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import {
  AI_MEMORY_REQUEST_MAX_LENGTH,
  AI_MEMORY_USER_MESSAGE_MAX_LENGTH,
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
import {
  aiMemory,
  aiMemoryChangeSet,
  aiMemoryScopeConfig,
  gmailUsefulDetailFeedback,
  mailAutomationMemoryProfile,
  mailAutoLabelFeedback,
  mailbox,
  managedMailMessage,
  user as memoryUser,
  userAiContextEvent,
} from "@quieter/database/schema";
import type {
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
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { assertCanUseAi } from "./ai-access";
import {
  embedAiMemories,
  embedPendingAiMemories,
  searchAiMemoryBySimilarity,
} from "./ai-memory-embedding";
import { assertAccessibleMailbox } from "./mailbox/service";

const MEMORY_CANDIDATE_LIMIT = 200;
const MEMORY_CONTEXT_LIMIT = 8;
const MEMORY_CONTEXT_CHARACTER_BUDGET = 4000;
const MEMORY_OVERVIEW_PAGE_SIZE = 100;
const MEMORY_EVENT_METADATA_STRING_LIMIT = 600;
export const AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH = 6000;
export const DEFAULT_AI_MEMORY_LEARNING_PROMPT = `Build a concise, useful understanding of the user from their own chat, writing, and mail activity. Learn their language, tone, vocabulary, greetings and sign-offs, relationships they describe, work and routines, reading interests, priorities, organization habits, and how preferences vary by recipient or context. Connect repeated labeling, reading, archiving, reply requests, and brief feedback into durable patterns. Distinguish dismissing from disliking, and deferring from ignoring. Keep uncertain evidence provisional, update contradictions, expire temporary context, and never retain raw correspondence or secrets.`;

export type AiMemoryEventMetadata = Record<
  string,
  string | number | boolean | null
>;
export type AiAgentMemoryContext = {
  instructions: string | null;
  memory: string | null;
};

export type AiMemoryOverviewCursor = {
  afterId: string;
  startedAt: string;
};

export type AiMemoryOverviewPage = {
  hasMore: boolean;
  items: {
    content: string;
    id: string;
    kind: "instruction" | "learned";
    scope: "mailbox" | "user";
    summary: string;
  }[];
  nextCursor: AiMemoryOverviewCursor | null;
  total: number;
};

export const buildMailMemoryQuery = (message: {
  from?: string | null;
  snippet?: string | null;
  subject?: string | null;
  to?: string | null;
}) =>
  [message.from, message.to, message.subject, message.snippet]
    .filter((value): value is string => !!value)
    .join(" ")
    .slice(0, 2000);

export const serializeAiAgentContext = ({
  instructions,
  memory,
}: AiAgentMemoryContext) =>
  [
    ...(instructions ? [`User-authored instructions:\n${instructions}`] : []),
    ...(memory ? [`Relevant learned memory:\n${memory}`] : []),
  ].join("\n\n") || null;

type MemoryRow = typeof aiMemory.$inferSelect;
type RankedAiMemoryCandidate = {
  memory: MemoryRow;
  score: number;
};

const MEMORY_SOURCE_HALF_LIFE_DAYS = {
  explicit: 720,
  feedback: 360,
  inferred: 180,
  migration: 360,
} as const;
const DAY_MS = 86_400_000;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

export const calculateAiMemorySalience = (
  memory: Pick<
    MemoryRow,
    | "confidence"
    | "kind"
    | "lastConfirmedAt"
    | "lastUsedAt"
    | "reinforcementCount"
    | "source"
  >,
  now = new Date()
) => {
  if (memory.kind === "instruction") {
    return 1;
  }
  const ageDays = Math.max(
    0,
    (now.getTime() - memory.lastConfirmedAt.getTime()) / DAY_MS
  );
  const evidenceDecay = Math.exp(
    (-Math.LN2 * ageDays) / MEMORY_SOURCE_HALF_LIFE_DAYS[memory.source]
  );
  const usageAgeDays = memory.lastUsedAt
    ? Math.max(0, (now.getTime() - memory.lastUsedAt.getTime()) / DAY_MS)
    : Number.POSITIVE_INFINITY;
  const usageSignal = Number.isFinite(usageAgeDays)
    ? Math.exp((-Math.LN2 * usageAgeDays) / 180)
    : 0;
  const reinforcementSignal = Math.min(
    1,
    Math.log2(memory.reinforcementCount + 1) / 4
  );
  return clampUnit(
    memory.confidence * (0.3 + evidenceDecay * 0.5) +
      usageSignal * 0.1 +
      reinforcementSignal * 0.1
  );
};

export const getAiMemoryRetirementReason = (
  memory: Pick<
    MemoryRow,
    | "confidence"
    | "expiresAt"
    | "kind"
    | "lastConfirmedAt"
    | "lastUsedAt"
    | "reinforcementCount"
    | "source"
    | "status"
  >,
  now = new Date()
) => {
  if (memory.status !== "active" || memory.kind === "instruction") {
    return null;
  }
  if (memory.expiresAt !== null && memory.expiresAt <= now) {
    return "expired" as const;
  }
  if (memory.source === "explicit") {
    return null;
  }
  const ageDays = (now.getTime() - memory.lastConfirmedAt.getTime()) / DAY_MS;
  const unusedDays = memory.lastUsedAt
    ? (now.getTime() - memory.lastUsedAt.getTime()) / DAY_MS
    : ageDays;
  if (
    ageDays >= 540 &&
    unusedDays >= 365 &&
    memory.reinforcementCount === 1 &&
    memory.confidence < 0.6
  ) {
    return "stale_low_signal" as const;
  }
  return null;
};

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
    if (scope.scope === "user") {
      await tx
        .select({ id: memoryUser.id })
        .from(memoryUser)
        .where(eq(memoryUser.id, userId))
        .for("update");
    } else {
      await tx
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(eq(mailbox.id, scope.mailboxId ?? ""))
        .for("update");
    }
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
  confidence: record.confidence,
  content: record.content,
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
      sanitized[key] =
        trimmed === ""
          ? null
          : trimmed.slice(
              0,
              key === "userMessage"
                ? AI_MEMORY_USER_MESSAGE_MAX_LENGTH
                : MEMORY_EVENT_METADATA_STRING_LIMIT
            );
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

const normalizeSearchTokens = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9._@:-]{1,}/gu)
      ?.filter((token) => token.length > 2)
      .slice(0, 120)
  );

export const rankAiMemoryCandidates = ({
  agent,
  candidates,
  now = new Date(),
  query,
  semanticScores = new Map<string, number>(),
}: {
  agent: string;
  candidates: MemoryRow[];
  now?: Date;
  query: string;
  semanticScores?: ReadonlyMap<string, number>;
}): RankedAiMemoryCandidate[] => {
  const queryTokens = normalizeSearchTokens(
    `${agent.replaceAll("_", " ")} ${query}`
  );

  return candidates
    .flatMap((memory) => {
      const agents = memory.metadata.agents ?? ["all"];
      if (!agents.includes("all") && !agents.includes(agent)) {
        return [];
      }
      if (
        memory.status !== "active" ||
        (memory.expiresAt !== null && memory.expiresAt <= now)
      ) {
        return [];
      }

      const contentTokens = normalizeSearchTokens(
        `${memory.content} ${memory.summary} ${(memory.metadata.topics ?? []).join(" ")}`
      );
      const overlap = [...queryTokens].filter((token) =>
        contentTokens.has(token)
      ).length;
      const sourceDomainMatch = (memory.metadata.sourceDomains ?? []).some(
        (domain) => query.toLowerCase().includes(domain.toLowerCase())
      );
      const semanticScore = clampUnit(semanticScores.get(memory.id) ?? 0);
      const alwaysRelevant = memory.importance === 5 && agents.includes("all");
      if (
        overlap === 0 &&
        !sourceDomainMatch &&
        !alwaysRelevant &&
        semanticScore < 0.35
      ) {
        return [];
      }

      const salience = calculateAiMemorySalience(memory, now);
      const lexical = Math.min(0.7, overlap * 0.16);
      const score =
        lexical +
        semanticScore * 0.82 +
        (sourceDomainMatch ? 0.65 : 0) +
        memory.importance * 0.035 +
        salience * 0.16 +
        Math.min(0.05, Math.log2(memory.reinforcementCount + 1) * 0.012);

      return [{ memory, score }];
    })
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        right.memory.updatedAt.getTime() - left.memory.updatedAt.getTime()
    );
};

const memoryAuthority = (memory: MemoryRow) => {
  if (memory.kind === "instruction") {
    return memory.scope === "mailbox" ? 4 : 3;
  }
  return memory.scope === "mailbox" ? 2 : 1;
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>) => {
  const union = new Set([...left, ...right]).size;
  if (union === 0) {
    return 0;
  }
  return [...left].filter((token) => right.has(token)).length / union;
};

/**
 * Packs the highest-authority, most relevant, least redundant memories into
 * the context budget. Authority dominates the ordering; relevance and
 * novelty break ties within an authority tier.
 */
const formatMemoryContext = (
  ranked: ReturnType<typeof rankAiMemoryCandidates>
) => {
  const remaining = ranked.map((candidate) => ({
    ...candidate,
    tokens: normalizeSearchTokens(
      `${candidate.memory.summary} ${candidate.memory.content}`
    ),
  }));
  const selectedTokens: Set<string>[] = [];
  const selected: MemoryRow[] = [];
  let usedCharacters = 0;

  while (selected.length < MEMORY_CONTEXT_LIMIT && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [index, candidate] of remaining.entries()) {
      let redundancy = 0;
      for (const tokens of selectedTokens) {
        redundancy = Math.max(
          redundancy,
          jaccardSimilarity(candidate.tokens, tokens)
        );
      }
      const marginalScore =
        memoryAuthority(candidate.memory) * 10 +
        candidate.score -
        redundancy * 0.3;
      if (marginalScore > bestScore) {
        bestIndex = index;
        bestScore = marginalScore;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (next === undefined) {
      break;
    }
    const nextLength = next.memory.content.length + 4;
    if (usedCharacters + nextLength > MEMORY_CONTEXT_CHARACTER_BUDGET) {
      continue;
    }
    selected.push(next.memory);
    selectedTokens.push(next.tokens);
    usedCharacters += nextLength;
  }

  return selected;
};

export const loadAiConfiguration = () => ({
  autoLabelModel: AUTO_LABEL_MODEL,
});

export type AiAgentMemoryCandidates = MemoryRow[];

/**
 * Archives records that have expired or decayed below usefulness. Archiving
 * removes them from retrieval on its own, because every read filters on
 * `status = 'active'`.
 */
const retireAiMemories = async (stale: MemoryRow[]) => {
  if (stale.length === 0) {
    return;
  }
  const now = new Date();
  await Promise.all(
    stale.map(
      async (memory) =>
        await db
          .update(aiMemory)
          .set({
            archivedAt: now,
            status: "archived",
            updatedAt: now,
            version: sql`${aiMemory.version} + 1`,
          })
          .where(
            and(
              eq(aiMemory.id, memory.id),
              eq(aiMemory.status, "active"),
              eq(aiMemory.version, memory.version)
            )
          )
    )
  );
};

/**
 * Background upkeep for the scopes a request just touched: retire decayed
 * records and embed anything still missing a vector.
 */
const maintainAiMemoryScopes = async ({
  scopeKeys,
  stale,
}: {
  scopeKeys: string[];
  stale: MemoryRow[];
}) => {
  try {
    await retireAiMemories(stale);
    await embedPendingAiMemories(scopeKeys);
  } catch (error: unknown) {
    reportError(error, { operation: "ai-memory:maintain-scopes" });
  }
};

const listScopeMemories = async (scopeKey: string) =>
  await db
    .select()
    .from(aiMemory)
    .where(eq(aiMemory.scopeKey, scopeKey))
    .orderBy(asc(aiMemory.status), desc(aiMemory.updatedAt))
    .limit(MEMORY_CANDIDATE_LIMIT);

const buildMemoryValues = ({
  operation,
  source,
}: {
  operation: AiMemoryUpdatePlan["operations"][number];
  source: AiMemorySource;
}) => ({
  confidence: operation.confidence,
  content: operation.content ?? operation.summary,
  // Content changed, so any stored embedding no longer describes this record.
  // A null embedding is the re-embedding queue.
  embeddedAt: null,
  embedding: null,
  expiresAt: operation.expiresAt ? new Date(operation.expiresAt) : null,
  importance: operation.importance,
  key: operation.key,
  kind: operation.kind,
  metadata: {
    agents: operation.agents.length > 0 ? operation.agents : ["all"],
    topics: operation.topics,
  } satisfies AiMemoryMetadata,
  source,
  summary: operation.summary,
});

const applyAiMemoryPlan = async ({
  actorUserId,
  changeSetSource,
  existingEditsOnly = false,
  expectedVersions,
  plan,
  request,
  scope,
  source,
  sourceEventId,
  sourceEventIds,
}: {
  actorUserId: string;
  changeSetSource: "chat" | "feedback" | "settings" | "system";
  existingEditsOnly?: boolean;
  expectedVersions?: ReadonlyMap<string, number>;
  plan: AiMemoryUpdatePlan;
  request: string | null;
  scope: MemoryScopeTarget;
  source: AiMemorySource;
  sourceEventId?: string | null;
  sourceEventIds?: string[];
}) => {
  const appliedChangeSet = await db.transaction(async (tx) => {
    if (scope.scope === "user") {
      await tx
        .select({ id: memoryUser.id })
        .from(memoryUser)
        .where(eq(memoryUser.id, actorUserId))
        .for("update");
    } else {
      await tx
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(eq(mailbox.id, scope.mailboxId ?? ""))
        .for("update");
    }
    await tx
      .select({ id: aiMemory.id })
      .from(aiMemory)
      .where(eq(aiMemory.scopeKey, scope.scopeKey))
      .for("update");
    if (sourceEventIds !== undefined && sourceEventIds.length > 0) {
      const claimedEvents = await tx
        .select({ id: userAiContextEvent.id })
        .from(userAiContextEvent)
        .where(
          and(
            inArray(userAiContextEvent.id, sourceEventIds),
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
      const [latestConfig] = await tx
        .select({
          activeLearningEnabled: aiMemoryScopeConfig.activeLearningEnabled,
        })
        .from(aiMemoryScopeConfig)
        .where(eq(aiMemoryScopeConfig.scopeKey, scope.scopeKey))
        .for("share");
      if (latestConfig !== undefined && !latestConfig.activeLearningEnabled) {
        throw new ORPCError("CONFLICT", { message: "Learning is paused." });
      }
    }
    const current = await tx
      .select()
      .from(aiMemory)
      .where(eq(aiMemory.scopeKey, scope.scopeKey));
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
      expectedVersions !== undefined &&
      current.some(
        (record) =>
          record.version !== expectedVersions.get(record.id) &&
          plan.operations.some((operation) =>
            operation.targetId
              ? operation.targetId === record.id
              : operation.key === record.key
          )
      )
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "AI memory changed while these observations were being consolidated.",
      });
    }

    for (const operation of plan.operations) {
      const target = operation.targetId
        ? recordsById.get(operation.targetId)
        : recordsByKey.get(operation.key);
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

      const values = buildMemoryValues({ operation, source });
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

    const [insertedChangeSet] = await tx
      .insert(aiMemoryChangeSet)
      .values({
        changes,
        createdAt: now,
        id: randomUUID(),
        mailboxId: scope.mailboxId,
        request,
        source: changeSetSource,
        sourceEventId: sourceEventId ?? null,
        status: changes.length > 0 ? "applied" : "no_change",
        summary: plan.summary,
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
          metadata: sql`${userAiContextEvent.metadata} - 'userMessage'`,
          processingAt: null,
          updatedAt: now,
        })
        .where(inArray(userAiContextEvent.id, sourceEventIds));
    }

    return { changeSet: insertedChangeSet, changes };
  });
  void embedAiMemories(
    appliedChangeSet.changes.flatMap((change) =>
      change.after?.status === "active" ? [change.memoryId] : []
    )
  );
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

export const requestAiMemoryUpdate = async ({
  allowMutations = true,
  changeSetSource = "settings",
  mailboxId,
  request,
  scope: requestedScope,
  userId,
  userMessage,
}: {
  allowMutations?: boolean;
  changeSetSource?: "chat" | "settings";
  mailboxId: string;
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
  await assertCanUseAi({
    organizationId: billingMailbox.organizationId,
    userId,
  });
  const scope =
    requestedScope === "user" ? userScope(userId) : mailboxScope(mailboxId);
  const [current, config] = await Promise.all([
    listScopeMemories(scope.scopeKey),
    loadAiMemoryScopeConfig(scope),
  ]);
  const usage = createUsageCollector();

  try {
    const plan = await planAiMemoryUpdate({
      currentMemories: current.map(toEditorMemory),
      learningGuidance: allowMutations
        ? config.learningPrompt
        : `${config.learningPrompt}\n\nThis interaction is read-only. Answer the question and return zero operations.`,
      memoryScope: scope.scope,
      onUsage: usage.collect,
      request: normalizedRequest,
      source: "explicit",
      userMessage,
    });
    const appliedPlan = allowMutations
      ? plan
      : {
          ...plan,
          operations: [],
          summary: "Answered from mailbox knowledge without changing it.",
        };
    const changeSet = await applyAiMemoryPlan({
      actorUserId: userId,
      changeSetSource,
      plan: appliedPlan,
      request: normalizedRequest,
      scope,
      source: "explicit",
    });
    await reportMemoryUsage({
      externalId: `ai-memory-request:${changeSet.id}`,
      mailboxId,
      usage: usage.usage(),
      userId,
    });
    return { ...changeSet, answer: plan.answer };
  } catch (error) {
    const now = new Date();
    await db.insert(aiMemoryChangeSet).values({
      changes: [],
      createdAt: now,
      error:
        error instanceof Error
          ? error.message.slice(0, 2000)
          : "Unknown error.",
      id: randomUUID(),
      mailboxId: scope.mailboxId,
      request: normalizedRequest,
      source: changeSetSource,
      status: "failed",
      summary:
        "Nothing changed because Quieter could not safely apply that memory update.",
      updatedAt: now,
      userId,
    });
    throw error;
  }
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
  scope: MemoryScopeTarget;
  text: string;
  userId: string;
}) => {
  const { scope } = input;
  const ownedMemoryCondition = and(
    eq(aiMemory.scopeKey, scope.scopeKey),
    eq(aiMemory.scope, scope.scope),
    scope.scope === "user"
      ? and(eq(aiMemory.userId, input.userId), isNull(aiMemory.mailboxId))
      : and(eq(aiMemory.mailboxId, input.mailboxId), isNull(aiMemory.userId))
  );
  const current = await db
    .select()
    .from(aiMemory)
    .where(ownedMemoryCondition)
    .orderBy(desc(aiMemory.updatedAt));
  if (current.length === 0) {
    return { status: "skipped" as const };
  }
  const billingMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const targetIds: string[] = [];
  for (let offset = 0; offset < current.length; offset += 100) {
    if (
      !(await canRunMemoryModel({
        organizationId: billingMailbox.organizationId,
        userId: input.userId,
      }))
    ) {
      break;
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
  if (targets.length === 0) {
    return { status: "skipped" as const };
  }
  if (scope.scope === "mailbox") {
    const access = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });
    if (!access.capabilities.canManageKnowledge) {
      return { status: "skipped" as const };
    }
  }
  await db.transaction(async (tx) => {
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
    const targetCondition = and(
      ownedMemoryCondition,
      inArray(
        aiMemory.id,
        targets.map(({ id }) => id)
      )
    );
    const locked = await tx
      .select()
      .from(aiMemory)
      .where(targetCondition)
      .for("update");
    if (
      locked.length !== targets.length ||
      locked.some(
        (memory) =>
          memory.version !== targets.find(({ id }) => id === memory.id)?.version
      )
    ) {
      throw new ORPCError("CONFLICT", {
        message: "The memory to forget was changed or already forgotten.",
      });
    }
    const scopeChangesCondition =
      scope.scope === "user"
        ? and(
            eq(aiMemoryChangeSet.userId, input.userId),
            isNull(aiMemoryChangeSet.mailboxId)
          )
        : eq(aiMemoryChangeSet.mailboxId, input.mailboxId);
    const history = await tx
      .select()
      .from(aiMemoryChangeSet)
      .where(scopeChangesCondition);
    const affectedHistory = history.filter(({ changes }) =>
      changes.some(({ memoryId }) => selectedIds.has(memoryId))
    );
    const sourceEventIds = [
      ...new Set(
        [
          ...locked.map(({ sourceReference }) => sourceReference),
          ...affectedHistory.map(({ sourceEventId }) => sourceEventId),
        ].filter((id): id is string => id !== null)
      ),
    ];
    // Erasure must also remove undo snapshots and source observations. Archiving
    // would retain the secret and let a later undo or refresh recreate it.
    if (affectedHistory.length > 0) {
      await tx.delete(aiMemoryChangeSet).where(
        and(
          scopeChangesCondition,
          inArray(
            aiMemoryChangeSet.id,
            affectedHistory.map(({ id }) => id)
          )
        )
      );
    }
    if (sourceEventIds.length > 0) {
      await tx
        .delete(userAiContextEvent)
        .where(
          and(
            inArray(userAiContextEvent.id, sourceEventIds),
            scope.scope === "user"
              ? and(
                  eq(userAiContextEvent.userId, input.userId),
                  or(
                    eq(userAiContextEvent.kind, "chat_discovery"),
                    eq(userAiContextEvent.kind, "explicit_preference"),
                    eq(
                      sql<string>`${userAiContextEvent.metadata}->>'memoryScope'`,
                      "user"
                    )
                  )
                )
              : and(
                  eq(userAiContextEvent.mailboxId, input.mailboxId),
                  eq(
                    sql<string>`coalesce(${userAiContextEvent.metadata}->>'memoryScope', 'mailbox')`,
                    "mailbox"
                  )
                )
          )
        );
    }
    await tx.delete(aiMemory).where(targetCondition);
  });
  return { status: "refreshed" as const };
};

const updateExistingAiMemoryFromChatMessage = async (input: {
  mailboxId: string;
  messageId: string;
  scope: MemoryScopeTarget;
  text: string;
  userId: string;
}) => {
  const { scope } = input;
  const current = await db
    .select()
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
    return { status: "skipped" as const };
  }
  const billingMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  let refreshed = false;
  for (let offset = 0; offset < current.length; offset += 100) {
    if (
      !(await canRunMemoryModel({
        organizationId: billingMailbox.organizationId,
        userId: input.userId,
      }))
    ) {
      break;
    }
    const batch = current.slice(offset, offset + 100);
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
      if (plan.operations.length === 0) {
        continue;
      }
      if (scope.scope === "mailbox") {
        const access = await assertAccessibleMailbox({
          mailboxId: input.mailboxId,
          userId: input.userId,
        });
        if (!access.capabilities.canManageKnowledge) {
          break;
        }
      }
      await applyAiMemoryPlan({
        actorUserId: input.userId,
        changeSetSource: "chat",
        existingEditsOnly: true,
        expectedVersions: new Map(
          batch.map(({ id, version }) => [id, version])
        ),
        plan,
        request: null,
        scope,
        source: "explicit",
      });
      refreshed = true;
    } finally {
      await reportMemoryUsage({
        externalId: `ai-memory-chat-edit:${scope.scope}:${input.messageId}:${offset}`,
        mailboxId: input.mailboxId,
        usage: usage.usage(),
        userId: input.userId,
      });
    }
  }
  return { status: refreshed ? ("refreshed" as const) : ("skipped" as const) };
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
  if (containsProhibitedMemorySecret(text)) {
    const deletion = forgetSensitiveAiMemory({
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      scope: userScope(input.userId),
      text,
      userId: input.userId,
    });
    if (input.scheduleBackgroundTask !== undefined) {
      input.scheduleBackgroundTask(
        (async () => {
          try {
            await deletion;
          } catch (error) {
            if (!(error instanceof ORPCError) || error.status >= 500) {
              reportError(error, { operation: "chat:forget-personal-context" });
            }
          }
        })()
      );
      return { status: "scheduled" as const };
    }
    return await deletion;
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

  if (input.scheduleBackgroundTask !== undefined) {
    input.scheduleBackgroundTask(
      (async () => {
        try {
          await updateExistingAiMemoryFromChatMessage({
            mailboxId: input.mailboxId,
            messageId: input.messageId,
            scope: userScope(input.userId),
            text,
            userId: input.userId,
          });
        } catch (error) {
          if (!(error instanceof ORPCError) || error.status >= 500) {
            reportError(error, { operation: "chat:learn-personal-context" });
          }
        }
      })()
    );
    return { status: "scheduled" as const };
  }
  return await updateExistingAiMemoryFromChatMessage({
    mailboxId: input.mailboxId,
    messageId: input.messageId,
    scope: userScope(input.userId),
    text,
    userId: input.userId,
  });
};

export const learnAiMemoryFromChatMessage = async (
  input: Parameters<typeof learnPersonalAiMemoryFromChatMessage>[0]
) => {
  const personalResult = await learnPersonalAiMemoryFromChatMessage(input);
  const text = input.bodyText.trim();
  if (!text) {
    return personalResult;
  }
  const updateMailboxMemory = async () => {
    const accessibleMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });
    if (!accessibleMailbox.capabilities.canManageKnowledge) {
      return { status: "skipped" as const };
    }
    const scopedInput = {
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      scope: mailboxScope(input.mailboxId),
      text,
      userId: input.userId,
    };
    return containsProhibitedMemorySecret(text)
      ? await forgetSensitiveAiMemory(scopedInput)
      : await updateExistingAiMemoryFromChatMessage(scopedInput);
  };
  if (input.scheduleBackgroundTask !== undefined) {
    input.scheduleBackgroundTask(
      (async () => {
        try {
          await updateMailboxMemory();
        } catch (error) {
          if (!(error instanceof ORPCError) || error.status >= 500) {
            reportError(error, { operation: "chat:edit-mailbox-context" });
          }
        }
      })()
    );
    return { status: "scheduled" as const };
  }
  const mailboxResult = await updateMailboxMemory();
  return mailboxResult.status === "refreshed" ? mailboxResult : personalResult;
};

const resolveMemorySource = (
  kind: UserAiContextEventKind
): "explicit" | "feedback" | "inferred" => {
  if (kind === "chat_discovery" || kind === "explicit_preference") {
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
        metadata: sql`${userAiContextEvent.metadata} - 'userMessage'`,
        processingAt: null,
        updatedAt: new Date(),
      })
      .where(eq(userAiContextEvent.id, event.id));
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
      .where(eq(userAiContextEvent.id, event.id));
    return { status: "ineligible" as const };
  }

  const memorySource = resolveMemorySource(event.kind);
  const isExplicit = memorySource === "explicit";
  const scope =
    event.metadata.memoryScope === "user"
      ? userScope(event.userId)
      : mailboxScope(event.mailboxId);
  const [current, config] = await Promise.all([
    listScopeMemories(scope.scopeKey),
    loadAiMemoryScopeConfig(scope),
  ]);
  if (
    (!isExplicit || event.metadata.ambient === true) &&
    !config.activeLearningEnabled
  ) {
    await db
      .update(userAiContextEvent)
      .set({
        lastError: null,
        metadata: sql`${userAiContextEvent.metadata} - 'userMessage'`,
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userAiContextEvent.id, event.id));
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
        metadata: sql`${userAiContextEvent.metadata} - 'userMessage'`,
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userAiContextEvent.id, event.id));
    return { status: "skipped" as const };
  }
  if (
    scope.scope === "mailbox" &&
    !accessibleMailbox.capabilities.canManageKnowledge
  ) {
    await db
      .update(userAiContextEvent)
      .set({
        metadata: sql`${userAiContextEvent.metadata} - 'userMessage'`,
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userAiContextEvent.id, event.id));
    return { status: "skipped" as const };
  }
  const siblingLimit = isExplicit ? 0 : 19;
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
    .limit(event.metadata.ambient === true ? 3 : siblingLimit);
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
  const events = [event, ...siblings].toSorted(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
  );
  const sourceEventIds = events.map(({ id }) => id);
  const earlierEvents = await db
    .select({
      createdAt: userAiContextEvent.createdAt,
      kind: userAiContextEvent.kind,
      metadata: userAiContextEvent.metadata,
    })
    .from(userAiContextEvent)
    .where(
      and(
        eq(userAiContextEvent.userId, event.userId),
        eq(userAiContextEvent.mailboxId, event.mailboxId),
        eq(
          sql<string>`coalesce(${userAiContextEvent.metadata}->>'memoryScope', 'mailbox')`,
          scope.scope
        ),
        isNotNull(userAiContextEvent.mergedAt),
        ne(userAiContextEvent.kind, "chat_discovery"),
        gt(
          userAiContextEvent.createdAt,
          new Date(claimedAt.getTime() - 30 * DAY_MS)
        )
      )
    )
    .orderBy(desc(userAiContextEvent.createdAt))
    .limit(20 - events.length);
  const observations: AiMemoryObservation[] = [
    ...earlierEvents.toReversed().map(({ createdAt, kind, metadata }) => ({
      kind,
      metadata: {
        ...Object.fromEntries(
          Object.entries(metadata).filter(([key]) => key !== "userMessage")
        ),
        observedAt: createdAt.toISOString(),
        previouslyProcessed: true,
      },
    })),
    ...events.map(({ createdAt, kind, metadata }) => ({
      kind,
      metadata: {
        ...Object.fromEntries(
          Object.entries(metadata).filter(([key]) => key !== "userMessage")
        ),
        observedAt: createdAt.toISOString(),
        previouslyProcessed: false,
      },
    })),
  ];
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
      changeSetSource: resolveChangeSetSource(event.kind),
      expectedVersions: new Map(
        current.map(({ id, version }) => [id, version])
      ),
      plan,
      request: null,
      scope,
      source: memorySource,
      sourceEventId: event.id,
      sourceEventIds,
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
      reportError(error, { operation: "ai-memory:consolidate-observations" });
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
        lastError:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "Unknown error.",
        processingAt: null,
        updatedAt: new Date(),
      })
      .where(inArray(userAiContextEvent.id, sourceEventIds));
    return { status: "failed" as const };
  }
};

export const loadAiAgentMemoryCandidates = async ({
  includeUserScope = true,
  mailboxId,
  userId,
}: {
  includeUserScope?: boolean;
  mailboxId: string;
  userId: string;
}): Promise<AiAgentMemoryCandidates> => {
  try {
    const scopeKeys = [
      `mailbox:${mailboxId}`,
      ...(includeUserScope ? [`user:${userId}`] : []),
    ];
    const candidatesByScope = await Promise.all(
      scopeKeys.map(
        async (scopeKey) =>
          await db
            .select()
            .from(aiMemory)
            .where(
              and(
                eq(aiMemory.scopeKey, scopeKey),
                eq(aiMemory.status, "active")
              )
            )
            .orderBy(desc(aiMemory.importance), desc(aiMemory.lastConfirmedAt))
            .limit(MEMORY_CANDIDATE_LIMIT)
      )
    );
    const stale: MemoryRow[] = [];
    const usable: MemoryRow[] = [];
    for (const memory of candidatesByScope.flat()) {
      if (getAiMemoryRetirementReason(memory) === null) {
        usable.push(memory);
      } else {
        stale.push(memory);
      }
    }
    // Retiring and embedding are housekeeping, so they never block the caller.
    void maintainAiMemoryScopes({ scopeKeys, stale });
    return usable;
  } catch (error) {
    reportError(error, { operation: "ai-memory:load-candidates" });
    return [];
  }
};

export const rankAiAgentMemoryCandidates = async ({
  agent,
  candidates,
  query,
  semantic = true,
}: {
  agent: string;
  candidates: AiAgentMemoryCandidates;
  query: string;
  /**
   * Semantic recall costs one embedding request per call. Agents that run
   * once per user request keep it on; per-message agents whose queries are
   * inherently lexical (sender, subject, label names) turn it off.
   */
  semantic?: boolean;
}): Promise<AiAgentMemoryContext> => {
  try {
    const scopeKeys = [...new Set(candidates.map((memory) => memory.scopeKey))];
    const { rows: semanticRows, similarity } = semantic
      ? await searchAiMemoryBySimilarity({
          query: `${agent.replaceAll("_", " ")} ${query}`,
          scopeKeys,
        })
      : { rows: [], similarity: new Map<string, number>() };
    const loadedIds = new Set(candidates.map((memory) => memory.id));
    const extraCandidates = semanticRows.filter(
      (memory) =>
        !loadedIds.has(memory.id) &&
        getAiMemoryRetirementReason(memory) === null
    );
    const ranked = rankAiMemoryCandidates({
      agent,
      candidates: [...candidates, ...extraCandidates],
      query,
      semanticScores: similarity,
    });
    const selected = formatMemoryContext([
      ...ranked.filter(
        ({ memory }) =>
          memory.scope === "mailbox" && memory.kind === "instruction"
      ),
      ...ranked.filter(
        ({ memory }) => memory.scope === "user" && memory.kind === "instruction"
      ),
      ...ranked.filter(
        ({ memory }) => memory.scope === "mailbox" && memory.kind === "learned"
      ),
      ...ranked.filter(
        ({ memory }) => memory.scope === "user" && memory.kind === "learned"
      ),
    ]);
    const mailboxInstructions = selected.filter(
      (memory) => memory.scope === "mailbox" && memory.kind === "instruction"
    );
    const userInstructions = selected.filter(
      (memory) => memory.scope === "user" && memory.kind === "instruction"
    );
    const mailboxMemories = selected.filter(
      (memory) => memory.scope === "mailbox" && memory.kind === "learned"
    );
    const userMemories = selected.filter(
      (memory) => memory.scope === "user" && memory.kind === "learned"
    );
    const instructionSections = [
      mailboxInstructions.length > 0
        ? `Current mailbox instructions (more specific):\n${mailboxInstructions.map((memory) => `- ${memory.content}`).join("\n")}`
        : null,
      userInstructions.length > 0
        ? `Personal instructions (apply across mailboxes):\n${userInstructions.map((memory) => `- ${memory.content}`).join("\n")}`
        : null,
    ].filter((section): section is string => !!section);
    const memorySections = [
      mailboxMemories.length > 0
        ? `Current mailbox memory (more specific):\n${mailboxMemories.map((memory) => `- ${memory.content}`).join("\n")}`
        : null,
      userMemories.length > 0
        ? `Personal memory (applies across mailboxes):\n${userMemories.map((memory) => `- ${memory.content}`).join("\n")}`
        : null,
    ].filter((section): section is string => !!section);

    if (selected.length > 0) {
      const recordMemoryRetrieval = async () => {
        try {
          await db
            .update(aiMemory)
            .set({
              lastUsedAt: new Date(),
              updatedAt: aiMemory.updatedAt,
            })
            .where(
              inArray(
                aiMemory.id,
                selected.map((memory) => memory.id)
              )
            );
        } catch (error: unknown) {
          reportError(error, { operation: "ai-memory:record-retrieval" });
        }
      };
      void recordMemoryRetrieval();
    }

    return {
      instructions: instructionSections.join("\n\n") || null,
      memory: memorySections.join("\n\n") || null,
    };
  } catch (error) {
    reportError(error, { operation: "ai-memory:rank-memory" });
    return { instructions: null, memory: null };
  }
};

type AiAgentContextInput = {
  agent: string;
  candidates?: AiAgentMemoryCandidates;
  includeUserScope?: boolean;
  mailboxId: string;
  query: string;
  semantic?: boolean;
  userId: string;
};

type AiMemoryOverviewInput = {
  mailboxId: string;
  overview: { cursor?: AiMemoryOverviewCursor };
  userId: string;
};

export function loadAiAgentContext(
  input: AiMemoryOverviewInput
): Promise<AiMemoryOverviewPage>;
export function loadAiAgentContext(
  input: AiAgentContextInput
): Promise<AiAgentMemoryContext>;
export async function loadAiAgentContext(
  input: AiAgentContextInput | AiMemoryOverviewInput
): Promise<AiAgentMemoryContext | AiMemoryOverviewPage> {
  if ("overview" in input) {
    const { mailboxId, overview, userId } = input;
    await assertAccessibleMailbox({ mailboxId, userId });
    const now = new Date();
    const startedAt = overview.cursor
      ? new Date(overview.cursor.startedAt)
      : now;
    if (Number.isNaN(startedAt.getTime()) || startedAt > now) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "That personal context page is no longer available. Start again.",
      });
    }
    const where = and(
      or(
        and(
          eq(aiMemory.scope, "user"),
          eq(aiMemory.scopeKey, `user:${userId}`),
          eq(aiMemory.userId, userId)
        ),
        and(
          eq(aiMemory.scope, "mailbox"),
          eq(aiMemory.scopeKey, `mailbox:${mailboxId}`),
          eq(aiMemory.mailboxId, mailboxId)
        )
      ),
      eq(aiMemory.status, "active"),
      or(isNull(aiMemory.expiresAt), gt(aiMemory.expiresAt, now)),
      lte(aiMemory.createdAt, startedAt)
    );
    const [rows, totals] = await Promise.all([
      db
        .select({
          content: aiMemory.content,
          id: aiMemory.id,
          kind: aiMemory.kind,
          scope: aiMemory.scope,
          summary: aiMemory.summary,
        })
        .from(aiMemory)
        .where(
          and(
            where,
            overview.cursor
              ? gt(aiMemory.id, overview.cursor.afterId)
              : undefined
          )
        )
        .orderBy(asc(aiMemory.id))
        .limit(MEMORY_OVERVIEW_PAGE_SIZE + 1),
      db.select({ total: count() }).from(aiMemory).where(where),
    ]);
    const items = rows.slice(0, MEMORY_OVERVIEW_PAGE_SIZE).map((row) =>
      containsProhibitedMemorySecret(`${row.summary} ${row.content}`)
        ? {
            ...row,
            content: "A sensitive detail was omitted from this overview.",
            summary: "Sensitive detail omitted",
          }
        : row
    );
    const hasMore = rows.length > items.length;
    const lastItem = items.at(-1);
    return {
      hasMore,
      items,
      nextCursor:
        hasMore && lastItem
          ? { afterId: lastItem.id, startedAt: startedAt.toISOString() }
          : null,
      total: totals[0]?.total ?? 0,
    };
  }
  const {
    agent,
    candidates,
    includeUserScope = true,
    mailboxId,
    query,
    semantic = true,
    userId,
  } = input;
  return await rankAiAgentMemoryCandidates({
    agent,
    candidates:
      candidates?.filter(
        (memory) =>
          memory.scopeKey === `mailbox:${mailboxId}` ||
          (includeUserScope && memory.scopeKey === `user:${userId}`)
      ) ??
      (await loadAiAgentMemoryCandidates({
        includeUserScope,
        mailboxId,
        userId,
      })),
    query,
    semantic,
  });
}

const listAddressDomains = (value: string) =>
  [
    ...new Set(
      [...value.matchAll(/@(?<domain>[a-z0-9.-]+\.[a-z]{2,})/giu)].map(
        (match) => (match.groups?.domain ?? "").toLowerCase()
      )
    ),
  ]
    .filter((domain) => domain !== "")
    .slice(0, 12)
    .join(", ");

const classifyGreeting = (text: string) => {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (!firstLine) {
    return "none";
  }
  const greeting =
    /^(?<greeting>hi|hello|hey|dear|good (?:morning|afternoon|evening))\b/iu.exec(
      firstLine
    )?.groups?.greeting;
  return greeting?.toLowerCase() ?? "none";
};

const classifySignOff = (text: string) => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-4);
  for (const line of lines) {
    const signOff =
      /^(?<signOff>best|best regards|kind regards|regards|thanks|thank you|cheers|sincerely|warmly)\b/iu.exec(
        line
      )?.groups?.signOff;
    if (signOff) {
      return signOff.toLowerCase();
    }
  }
  return "none";
};

export const learnAiMemoryFromSentMessage = async ({
  bodyText,
  isReply,
  mailboxId,
  recipients,
  userId,
}: {
  bodyText: string;
  isReply: boolean;
  mailboxId: string;
  recipients: string;
  userId: string;
}) => {
  const normalized =
    bodyText
      .replaceAll(/\r\n?/gu, "\n")
      .split(
        /\n(?:On .+wrote:|Am .+schrieb .+:|[-_]{3,}\s*(?:Forwarded|Original) message)/iu
      )[0]
      ?.split("\n")
      .filter((line) => !line.trimStart().startsWith(">"))
      .join("\n")
      .trim()
      .slice(0, 20_000) ?? "";
  if (!normalized) {
    return { status: "skipped" as const };
  }
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const sentences = normalized
    .split(/[.!?]+(?:\s|$)/u)
    .filter((sentence) => sentence.trim() !== "");
  const sentAt = new Date();

  const metadata: AiMemoryEventMetadata = {
    averageSentenceWords: Math.round(
      words.length / Math.max(1, sentences.length)
    ),
    bulletCount: (normalized.match(/^\s*(?:[-*]|\d+[.)])\s/gmu) ?? []).length,
    contractionCount: (normalized.match(/\b\p{L}+[’']\p{L}+\b/gu) ?? []).length,
    emojiCount: (normalized.match(/\p{Extended_Pictographic}/gu) ?? []).length,
    exclamationCount: (normalized.match(/!/gu) ?? []).length,
    greeting: classifyGreeting(normalized),
    isReply,
    paragraphCount: normalized
      .split(/\n\s*\n/u)
      .filter((paragraph) => paragraph.trim() !== "").length,
    questionCount: (normalized.match(/\?/gu) ?? []).length,
    recipientCount: recipients
      .split(",")
      .filter((recipient) => recipient.trim() !== "").length,
    recipientDomains: listAddressDomains(recipients),
    sentHourUtc: sentAt.getUTCHours(),
    sentWeekdayUtc: sentAt.toLocaleDateString("en", {
      timeZone: "UTC",
      weekday: "long",
    }),
    signOff: classifySignOff(normalized),
    wordCount: words.length,
  };
  return await learnAiMemoryFromFeedback({
    kind: "sent_message",
    mailboxId,
    metadata,
    userId,
  });
};

export const processPendingAiMemoryEvents = async ({
  allowLocal = false,
  userId,
}: { allowLocal?: boolean; userId?: string } = {}) => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local" && !allowLocal) {
    return { failed: 0, processed: 0 };
  }
  const cutoff = new Date(Date.now() - 120_000);
  const pending = await db
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
    .limit(4);
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
    } catch (error) {
      failed += 1;
      reportError(error, {
        operation: "ai-memory:process-pending-event",
      });
    }
  }
  return { failed, processed };
};

export const learnAiMemoryFromMailAction = async ({
  action,
  mailboxId,
  messageIds,
  metadata = {},
  targetCount,
  userId,
}: {
  action: string;
  mailboxId: string;
  messageIds?: string[];
  metadata?: AiMemoryEventMetadata;
  targetCount: number;
  userId: string;
}) => {
  if (targetCount < 1) {
    return { status: "skipped" as const };
  }
  const config = await getPersonalAiMemoryScopeConfig(userId);
  if (!config.activeLearningEnabled) {
    return { status: "skipped" as const };
  }
  const messages =
    messageIds !== undefined && messageIds.length > 0
      ? await db
          .select({
            from: managedMailMessage.from,
            subject: managedMailMessage.subject,
          })
          .from(managedMailMessage)
          .where(
            and(
              eq(managedMailMessage.mailboxId, mailboxId),
              inArray(
                managedMailMessage.id,
                [...new Set(messageIds)].slice(0, 12)
              )
            )
          )
          .limit(12)
      : [];
  const event = await recordAiMemoryEvent({
    kind: "mail_action",
    mailboxId,
    metadata: {
      ...metadata,
      action,
      memoryScope: "user",
      senderDomains:
        listAddressDomains(
          messages
            .map((message) => message.from)
            .filter(Boolean)
            .join(", ")
        ) ||
        (typeof metadata.senderDomains === "string"
          ? metadata.senderDomains
          : null) ||
        (typeof metadata.senderDomain === "string"
          ? metadata.senderDomain
          : null) ||
        null,
      subjects:
        messages
          .map((message) => message.subject)
          .filter(Boolean)
          .join("; ") ||
        (typeof metadata.subjects === "string" ? metadata.subjects : null) ||
        (typeof metadata.subject === "string" ? metadata.subject : null) ||
        null,
      targetCount,
    },
    userId,
  });
  return event === null
    ? { status: "skipped" as const }
    : { eventId: event.id, status: "recorded" as const };
};

export const enrichAiMemoryMailAction = async ({
  eventId,
  mailboxId,
  metadata,
  userId,
}: {
  eventId: string;
  mailboxId: string;
  metadata: AiMemoryEventMetadata;
  userId: string;
}) => {
  const context = sanitizeMetadata({
    senderDomains: metadata.senderDomains ?? null,
    subjects: metadata.subjects ?? null,
  });
  await db
    .update(userAiContextEvent)
    .set({
      metadata: sql`${userAiContextEvent.metadata} || ${JSON.stringify(context)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userAiContextEvent.id, eventId),
        eq(userAiContextEvent.mailboxId, mailboxId),
        eq(userAiContextEvent.userId, userId),
        eq(userAiContextEvent.kind, "mail_action"),
        eq(sql<string>`${userAiContextEvent.metadata}->>'memoryScope'`, "user"),
        isNull(userAiContextEvent.mergedAt),
        isNull(userAiContextEvent.skippedAt),
        isNull(userAiContextEvent.processingAt)
      )
    );
};

export const replaceMailboxFeedbackMemories = async ({
  agent,
  memories,
  mailboxId,
  userId,
}: {
  agent: "auto_label";
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
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, mailboxId))
      .for("update");
    await tx
      .select({ id: aiMemory.id })
      .from(aiMemory)
      .where(eq(aiMemory.scopeKey, scope.scopeKey))
      .for("update");
    const current = await tx
      .select()
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
        embeddedAt: null,
        embedding: null,
        importance: memory.importance,
        key,
        kind: "learned" as const,
        lastConfirmedAt: now,
        metadata: {
          ...memory.metadata,
          agents: [agent],
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
      if (nextKeys.has(existing.key) || existing.status === "archived") {
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
  void embedAiMemories(
    changes.flatMap((change) =>
      change.after?.status === "active" ? [change.memoryId] : []
    )
  );
  return { changed: changes.length };
};

const buildAiMemoryScope = ({
  changes,
  memories,
}: {
  changes: (typeof aiMemoryChangeSet.$inferSelect)[];
  memories: MemoryRow[];
}) => {
  const versions = new Map(
    memories.map((memory) => [memory.id, memory.version])
  );
  const undoneIds = new Set(
    changes.flatMap((change) => (change.undoOfId ? [change.undoOfId] : []))
  );
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
        canUndo:
          change.status === "applied" &&
          change.changes.length > 0 &&
          !undoneIds.has(change.id) &&
          change.changes.every(
            (item) =>
              item.after !== null &&
              versions.get(item.memoryId) === item.after.version
          ),
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

export const forgetAiMemory = async ({
  mailboxId,
  memoryId,
  scope: requestedScope,
  userId,
}: {
  mailboxId?: string | null;
  memoryId: string;
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
  const [memory] = await db
    .select()
    .from(aiMemory)
    .where(
      and(eq(aiMemory.id, memoryId), eq(aiMemory.scopeKey, scope.scopeKey))
    )
    .limit(1);
  if (memory === undefined || memory.status === "archived") {
    return null;
  }
  const plan: AiMemoryUpdatePlan = {
    answer: `Forgot: ${memory.summary}`,
    operations: [
      {
        action: "archive",
        agents: memory.metadata.agents ?? ["all"],
        confidence: memory.confidence,
        content: null,
        expiresAt: memory.expiresAt?.toISOString() ?? null,
        importance: memory.importance,
        key: memory.key,
        kind: memory.kind,
        summary: memory.summary,
        targetId: memory.id,
        topics: memory.metadata.topics ?? [],
      },
    ],
    summary: `Forgot: ${memory.summary}`,
  };
  return await applyAiMemoryPlan({
    actorUserId: userId,
    changeSetSource: "settings",
    plan,
    request: null,
    scope,
    source: memory.source,
  });
};

export const undoAiMemoryChange = async ({
  changeSetId,
  mailboxId,
  scope: requestedScope,
  userId,
}: {
  changeSetId: string;
  mailboxId?: string | null;
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
  const undoChangeSet = await db.transaction(async (tx) => {
    const scopeCondition =
      requestedScope === "user"
        ? and(
            eq(aiMemoryChangeSet.userId, userId),
            isNull(aiMemoryChangeSet.mailboxId)
          )
        : eq(aiMemoryChangeSet.mailboxId, mailboxId ?? "");
    const [changeSet] = await tx
      .select()
      .from(aiMemoryChangeSet)
      .where(and(eq(aiMemoryChangeSet.id, changeSetId), scopeCondition))
      .limit(1);
    if (
      changeSet === undefined ||
      changeSet.status !== "applied" ||
      changeSet.changes.length === 0
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "That memory change cannot be undone.",
      });
    }
    const [existingUndo] = await tx
      .select({ id: aiMemoryChangeSet.id })
      .from(aiMemoryChangeSet)
      .where(eq(aiMemoryChangeSet.undoOfId, changeSet.id))
      .limit(1);
    if (existingUndo !== undefined) {
      throw new ORPCError("CONFLICT", {
        message: "That memory change was already undone.",
      });
    }

    const now = new Date();
    const inverse: AiMemoryChange[] = [];
    for (const change of changeSet.changes.toReversed()) {
      const [current] = await tx
        .select()
        .from(aiMemory)
        .where(
          and(
            eq(aiMemory.id, change.memoryId),
            eq(aiMemory.scopeKey, scope.scopeKey)
          )
        )
        .limit(1);
      if (
        current === undefined ||
        change.after === null ||
        current.version !== change.after.version
      ) {
        throw new ORPCError("CONFLICT", {
          message:
            "Memory changed again after this update and can no longer be safely undone.",
        });
      }

      const previous = change.before;
      const [updated] = await tx
        .update(aiMemory)
        .set(
          previous
            ? {
                archivedAt: previous.status === "archived" ? now : null,
                confidence: previous.confidence,
                content: previous.content,
                embeddedAt: null,
                embedding: null,
                expiresAt: previous.expiresAt
                  ? new Date(previous.expiresAt)
                  : null,
                importance: previous.importance,
                key: previous.key,
                kind: previous.kind,
                metadata: previous.metadata,
                status: previous.status,
                summary: previous.summary,
                updatedAt: now,
                version: sql`${aiMemory.version} + 1`,
              }
            : {
                archivedAt: now,
                status: "archived",
                updatedAt: now,
                version: sql`${aiMemory.version} + 1`,
              }
        )
        .where(
          and(
            eq(aiMemory.id, current.id),
            eq(aiMemory.version, current.version)
          )
        )
        .returning();
      if (updated === undefined) {
        throw new ORPCError("CONFLICT", {
          message: "Memory changed while the undo was being applied.",
        });
      }
      inverse.push({
        after: toSnapshot(updated),
        before: toSnapshot(current),
        memoryId: updated.id,
        operation: (() => {
          if (updated.status === "archived") {
            return "archive" as const;
          }
          if (current.status === "archived") {
            return "restore" as const;
          }
          return "update" as const;
        })(),
      });
    }

    const [insertedUndo] = await tx
      .insert(aiMemoryChangeSet)
      .values({
        changes: inverse,
        createdAt: now,
        id: randomUUID(),
        mailboxId: scope.mailboxId,
        source: "settings",
        status: "applied",
        summary: `Undid: ${changeSet.summary}`,
        undoOfId: changeSet.id,
        updatedAt: now,
        userId,
      })
      .returning();
    return { changeSet: insertedUndo, changes: inverse };
  });
  void embedAiMemories(
    undoChangeSet.changes.flatMap((change) =>
      change.after?.status === "active" ? [change.memoryId] : []
    )
  );
  return undoChangeSet.changeSet;
};

export const purgePersonalAiMemory = async (userId: string) =>
  await db.transaction(async (tx) => {
    await tx
      .select({ id: memoryUser.id })
      .from(memoryUser)
      .where(eq(memoryUser.id, userId))
      .for("update");
    await tx.delete(aiMemory).where(eq(aiMemory.scopeKey, `user:${userId}`));
    await tx
      .delete(aiMemoryChangeSet)
      .where(
        and(
          eq(aiMemoryChangeSet.userId, userId),
          isNull(aiMemoryChangeSet.mailboxId)
        )
      );
    await tx
      .delete(userAiContextEvent)
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
    return { deleted: true };
  });

export const purgeMailboxAiMemory = async (mailboxId: string) =>
  await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, mailboxId))
      .for("update");
    await tx
      .delete(aiMemory)
      .where(eq(aiMemory.scopeKey, `mailbox:${mailboxId}`));
    await tx
      .delete(aiMemoryChangeSet)
      .where(eq(aiMemoryChangeSet.mailboxId, mailboxId));
    await tx
      .delete(userAiContextEvent)
      .where(eq(userAiContextEvent.mailboxId, mailboxId));
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
      content: memory.content,
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
      content: memory.content,
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
