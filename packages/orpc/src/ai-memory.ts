import { randomUUID } from "node:crypto";

import {
  AI_MEMORY_MODEL,
  AI_MEMORY_REQUEST_MAX_LENGTH,
  planAiMemoryUpdate,
} from "@quieter/ai/ai-memory";
import type {
  AiMemoryEditorMemory,
  AiMemoryUpdatePlan,
} from "@quieter/ai/ai-memory";
import {
  chatModelSchema,
  defaultAutoLabelModel,
  defaultUsefulDetailModel,
} from "@quieter/ai/chat-models";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
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
  userAiContext,
  userAiContextEvent,
} from "@quieter/database/schema";
import type {
  AiMemoryChange,
  AiMemoryMetadata,
  AiMemorySnapshot,
  AiMemorySource,
  UserAiContextEventKind,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import {
  and,
  desc,
  eq,
  getColumns,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import {
  embedAiMemories,
  embedPendingAiMemories,
  searchAiMemoryBySimilarity,
} from "./ai-memory-embedding";
import { hasText } from "./text";

const MEMORY_CANDIDATE_LIMIT = 200;
const MEMORY_CONTEXT_LIMIT = 8;
const MEMORY_CONTEXT_CHARACTER_BUDGET = 4000;
const MEMORY_EVENT_METADATA_STRING_LIMIT = 600;
export const AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH = 6000;
export const DEFAULT_AI_MEMORY_LEARNING_PROMPT = `Focus on durable patterns that help Quieter act like the mailbox's users: communication tone, concise versus detailed replies, greetings and sign-offs, how style changes by recipient or relationship, recurring correspondents, normal response timing, and repeated message-handling choices. Prefer repeated or explicit evidence, preserve uncertainty, expire time-sensitive observations, and do not retain raw message content or secrets.`;

export type AiMemoryEventMetadata = Record<
  string,
  string | number | boolean | null
>;
export type AiAgentMemoryContext = {
  instructions: string | null;
  memory: string | null;
};

export const buildMailMemoryQuery = (message: {
  from?: string | null;
  snippet?: string | null;
  subject?: string | null;
  to?: string | null;
}) =>
  [message.from, message.to, message.subject, message.snippet]
    .filter((value): value is string => hasText(value))
    .join(" ")
    .slice(0, 2000);

export const serializeAiAgentContext = ({
  instructions,
  memory,
}: AiAgentMemoryContext) =>
  [
    ...(hasText(instructions)
      ? [`User-authored instructions:\n${instructions}`]
      : []),
    ...(hasText(memory) ? [`Relevant learned memory:\n${memory}`] : []),
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
  learningPrompt: hasText(record?.learningPrompt?.trim())
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
  if (requestedScope === "mailbox" && !hasText(mailboxId)) {
    throw new Error("A mailbox is required.");
  }
  const normalizedPrompt = learningPrompt
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/\n{4,}/gu, "\n\n\n")
    .trim()
    .slice(0, AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH)
    .trimEnd();
  const now = new Date();
  const [record] =
    revision === 0
      ? await db
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
      : await db
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
  if (record === undefined) {
    throw new Error(
      "Learning guidance changed elsewhere. Review the latest version."
    );
  }
  return await loadAiMemoryScopeConfig(scope);
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
      sanitized[key] =
        trimmed === ""
          ? null
          : trimmed.slice(0, MEMORY_EVENT_METADATA_STRING_LIMIT);
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

export const loadAiConfiguration = async ({ userId }: { userId: string }) => {
  const [record] = await db
    .select({
      autoLabelModel: userAiContext.autoLabelModel,
      usefulDetailModel: userAiContext.usefulDetailModel,
    })
    .from(userAiContext)
    .where(eq(userAiContext.userId, userId))
    .limit(1);
  const autoLabelModel = chatModelSchema.safeParse(record?.autoLabelModel);
  const usefulDetailModel = chatModelSchema.safeParse(
    record?.usefulDetailModel
  );

  return {
    autoLabelModel: autoLabelModel.success
      ? autoLabelModel.data
      : defaultAutoLabelModel,
    usefulDetailModel: usefulDetailModel.success
      ? usefulDetailModel.data
      : defaultUsefulDetailModel,
  };
};

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
    .orderBy(desc(aiMemory.status), desc(aiMemory.updatedAt))
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
  expiresAt: hasText(operation.expiresAt)
    ? new Date(operation.expiresAt)
    : null,
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
  plan,
  request,
  scope,
  source,
  sourceEventId,
}: {
  actorUserId: string;
  changeSetSource: "chat" | "feedback" | "settings" | "system";
  plan: AiMemoryUpdatePlan;
  request: string | null;
  scope: MemoryScopeTarget;
  source: AiMemorySource;
  sourceEventId?: string | null;
}) => {
  const appliedChangeSet = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select "id" from "aiMemory" where "scopeKey" = ${scope.scopeKey} for update`
    );
    const current = await tx
      .select()
      .from(aiMemory)
      .where(eq(aiMemory.scopeKey, scope.scopeKey));
    const recordsById = new Map(current.map((memory) => [memory.id, memory]));
    const recordsByKey = new Map(current.map((memory) => [memory.key, memory]));
    const changes: AiMemoryChange[] = [];
    const now = new Date();

    for (const operation of plan.operations) {
      const target = hasText(operation.targetId)
        ? recordsById.get(operation.targetId)
        : recordsByKey.get(operation.key);
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
          throw new Error(
            "AI memory changed while the update was being applied."
          );
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
          throw new Error(
            "AI memory changed while the update was being applied."
          );
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
      ...(hasText(mailboxId) ? { mailboxId } : {}),
      model: AI_MEMORY_MODEL,
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
    throw new Error("Ask a question or describe what should change.");
  }
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
  kind: UserAiContextEventKind;
  mailboxId: string;
  metadata: AiMemoryEventMetadata;
  userId: string;
}) => {
  const [selectedMailbox] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (selectedMailbox === undefined) {
    return null;
  }
  const now = new Date();
  const [event] = await db
    .insert(userAiContextEvent)
    .values({
      createdAt: now,
      id: randomUUID(),
      kind: input.kind,
      mailboxId: input.mailboxId,
      metadata: sanitizeMetadata(input.metadata),
      organizationId: selectedMailbox.organizationId,
      updatedAt: now,
      userId: input.userId,
    })
    .returning({ id: userAiContextEvent.id });
  return event ?? null;
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
  if (!isExplicit && !config.activeLearningEnabled) {
    await db
      .update(userAiContextEvent)
      .set({
        lastError: null,
        processingAt: null,
        skippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userAiContextEvent.id, event.id));
    return { status: "skipped" as const };
  }
  const request = JSON.stringify({
    kind: event.kind,
    metadata: event.metadata,
  });
  const usage = createUsageCollector();

  try {
    const plan = await planAiMemoryUpdate({
      currentMemories: current.map(toEditorMemory),
      learningGuidance: config.learningPrompt,
      onUsage: usage.collect,
      request,
      source: memorySource,
    });
    const changeSet = await applyAiMemoryPlan({
      actorUserId: event.userId,
      changeSetSource: resolveChangeSetSource(event.kind),
      plan,
      request: null,
      scope,
      source: memorySource,
      sourceEventId: event.id,
    });
    const now = new Date();
    await db
      .update(userAiContextEvent)
      .set({
        lastError: null,
        mergedAt: now,
        processingAt: null,
        updatedAt: now,
      })
      .where(eq(userAiContextEvent.id, event.id));
    await reportMemoryUsage({
      externalId: `ai-memory-event:${event.id}:${changeSet.id}`,
      mailboxId: event.mailboxId,
      usage: usage.usage(),
      userId: event.userId,
    });
    return { status: "refreshed" as const };
  } catch (error) {
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
      .where(eq(userAiContextEvent.id, event.id));
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
    const [pendingEvent] = await db
      .select({ id: userAiContextEvent.id })
      .from(userAiContextEvent)
      .where(
        and(
          eq(userAiContextEvent.mailboxId, mailboxId),
          isNull(userAiContextEvent.mergedAt),
          isNull(userAiContextEvent.skippedAt),
          or(
            isNull(userAiContextEvent.processingAt),
            lt(userAiContextEvent.processingAt, new Date(Date.now() - 120_000))
          )
        )
      )
      .orderBy(userAiContextEvent.createdAt)
      .limit(1);
    if (pendingEvent !== undefined) {
      void (async () => {
        try {
          await refreshAiMemoryFromEvent({ eventId: pendingEvent.id });
        } catch (error: unknown) {
          reportError(error, { operation: "ai-memory:refresh-pending-event" });
        }
      })();
    }
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
    ].filter((section): section is string => hasText(section));
    const memorySections = [
      mailboxMemories.length > 0
        ? `Current mailbox memory (more specific):\n${mailboxMemories.map((memory) => `- ${memory.content}`).join("\n")}`
        : null,
      userMemories.length > 0
        ? `Personal memory (applies across mailboxes):\n${userMemories.map((memory) => `- ${memory.content}`).join("\n")}`
        : null,
    ].filter((section): section is string => hasText(section));

    if (selected.length > 0) {
      const recordMemoryRetrieval = async () => {
        try {
          await db
            .update(aiMemory)
            .set({
              lastUsedAt: new Date(),
              updatedAt: sql`${aiMemory.updatedAt}`,
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

export const loadAiAgentContext = async ({
  agent,
  candidates,
  includeUserScope = true,
  mailboxId,
  query,
  semantic = true,
  userId,
}: {
  agent: string;
  candidates?: AiAgentMemoryCandidates;
  includeUserScope?: boolean;
  mailboxId: string;
  query: string;
  semantic?: boolean;
  userId: string;
}): Promise<AiAgentMemoryContext> =>
  await rankAiAgentMemoryCandidates({
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

export const recordAndRefreshAiMemory = async (input: {
  kind: UserAiContextEventKind;
  mailboxId: string;
  metadata: AiMemoryEventMetadata;
  userId: string;
}) => {
  const event = await recordAiMemoryEvent(input);
  if (event === null) {
    return { status: "skipped" as const };
  }
  return await refreshAiMemoryFromEvent({ eventId: event.id });
};

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
  if (!hasText(firstLine)) {
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
    if (hasText(signOff)) {
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
  const normalized = bodyText
    .replaceAll(/\r\n?/gu, "\n")
    .trim()
    .slice(0, 20_000);
  if (!hasText(normalized)) {
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
  const [mailboxConfig, personalConfig] = await Promise.all([
    getMailboxAiMemoryScopeConfig(mailboxId),
    getPersonalAiMemoryScopeConfig(userId),
  ]);
  const updates: ReturnType<typeof recordAiMemoryEvent>[] = [];
  if (mailboxConfig.activeLearningEnabled) {
    updates.push(
      recordAiMemoryEvent({ kind: "sent_message", mailboxId, metadata, userId })
    );
  }
  if (personalConfig.activeLearningEnabled) {
    updates.push(
      recordAiMemoryEvent({
        kind: "sent_message",
        mailboxId,
        metadata: { ...metadata, memoryScope: "user" },
        userId,
      })
    );
  }
  if (updates.length === 0) {
    return { status: "skipped" as const };
  }
  const events = await Promise.all(updates);
  await Promise.all(
    events.map(async (event) => {
      if (event === null) {
        return;
      }
      try {
        await refreshAiMemoryFromEvent({ eventId: event.id });
      } catch (error: unknown) {
        reportError(error, { operation: "ai-memory:learn-from-sent-message" });
      }
    })
  );
  return { status: "recorded" as const };
};

export const learnAiMemoryFromMailAction = async ({
  action,
  mailboxId,
  targetCount,
  userId,
}: {
  action: string;
  mailboxId: string;
  targetCount: number;
  userId: string;
}) => {
  const [mailboxConfig, personalConfig] = await Promise.all([
    getMailboxAiMemoryScopeConfig(mailboxId),
    getPersonalAiMemoryScopeConfig(userId),
  ]);
  const events = await Promise.all([
    ...(mailboxConfig.activeLearningEnabled
      ? [
          recordAiMemoryEvent({
            kind: "mail_action" as const,
            mailboxId,
            metadata: { action, targetCount },
            userId,
          }),
        ]
      : []),
    ...(personalConfig.activeLearningEnabled
      ? [
          recordAiMemoryEvent({
            kind: "mail_action" as const,
            mailboxId,
            metadata: { action, memoryScope: "user", targetCount },
            userId,
          }),
        ]
      : []),
  ]);
  await Promise.all(
    events.map(async (event) => {
      if (event === null) {
        return;
      }
      try {
        await refreshAiMemoryFromEvent({ eventId: event.id });
      } catch (error: unknown) {
        reportError(error, {
          operation: "ai-memory:learn-from-mailbox-action",
        });
      }
    })
  );
  return events.some((event) => event !== null)
    ? { status: "recorded" as const }
    : { status: "skipped" as const };
};

export const replaceMailboxFeedbackMemories = async ({
  agent,
  memories,
  mailboxId,
  userId,
}: {
  agent: "auto_label" | "useful_detail";
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
  const now = new Date();
  const changes = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select "id" from "aiMemory" where "scopeKey" = ${scope.scopeKey} for update`
    );
    const current = await tx
      .select()
      .from(aiMemory)
      .where(
        and(
          eq(aiMemory.scopeKey, scope.scopeKey),
          sql`${aiMemory.key} like ${`${prefix}%`}`
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
      summary: `Updated ${agent === "auto_label" ? "auto-labeling" : "useful details"} memory from feedback.`,
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

export const loadUsefulDetailFeedbackPolicies = async ({
  mailboxId,
  source,
}: {
  mailboxId: string;
  source: string | null;
}) => {
  const memories = await db
    .select({ metadata: aiMemory.metadata })
    .from(aiMemory)
    .where(
      and(
        eq(aiMemory.scopeKey, `mailbox:${mailboxId}`),
        eq(aiMemory.status, "active"),
        sql`${aiMemory.key} like 'feedback:useful_detail:%'`
      )
    );
  const globalPolicies = new Map<string, "prefer" | "suppress">();
  const sourcePolicies = new Map<string, "prefer" | "suppress">();

  for (const memory of memories) {
    const { detailKind } = memory.metadata;
    const { policy } = memory.metadata;
    if (
      typeof detailKind !== "string" ||
      (policy !== "prefer" && policy !== "suppress")
    ) {
      continue;
    }
    const sourceDomains = memory.metadata.sourceDomains ?? [];
    if (sourceDomains.length === 0) {
      globalPolicies.set(detailKind, policy);
    } else if (hasText(source) && sourceDomains.includes(source)) {
      sourcePolicies.set(detailKind, policy);
    }
  }

  return new Map([...globalPolicies, ...sourcePolicies]);
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
    changes.flatMap((change) =>
      hasText(change.undoOfId) ? [change.undoOfId] : []
    )
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
  if (scope === "mailbox" && !hasText(mailboxId)) {
    throw new Error("A mailbox is required.");
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

type AiMemoryScopeSettings = {
  learning: ReturnType<typeof toAiMemoryScopeConfig>;
  memory: ReturnType<typeof buildAiMemoryScope>;
};

export const listMailboxAiMemorySettings = async (
  mailboxIds: string[]
): Promise<Map<string, AiMemoryScopeSettings>> => {
  if (mailboxIds.length === 0) {
    return new Map<string, AiMemoryScopeSettings>();
  }
  const scopeKeys = mailboxIds.map((mailboxId) => `mailbox:${mailboxId}`);
  const rankedMemories = db
    .select({
      ...getColumns(aiMemory),
      scopeRank:
        sql<number>`row_number() over (partition by ${aiMemory.mailboxId} order by ${aiMemory.status} desc, ${aiMemory.updatedAt} desc)`.as(
          "scopeRank"
        ),
    })
    .from(aiMemory)
    .where(inArray(aiMemory.scopeKey, scopeKeys))
    .as("rankedAiMemorySettings");
  const rankedChanges = db
    .select({
      ...getColumns(aiMemoryChangeSet),
      scopeRank:
        sql<number>`row_number() over (partition by ${aiMemoryChangeSet.mailboxId} order by ${aiMemoryChangeSet.createdAt} desc)`.as(
          "scopeRank"
        ),
    })
    .from(aiMemoryChangeSet)
    .where(inArray(aiMemoryChangeSet.mailboxId, mailboxIds))
    .as("rankedAiMemoryChangeSettings");
  const [rankedMemoryRows, rankedChangeRows, configurations] =
    await Promise.all([
      db
        .select()
        .from(rankedMemories)
        .where(lte(rankedMemories.scopeRank, MEMORY_CANDIDATE_LIMIT)),
      db.select().from(rankedChanges).where(lte(rankedChanges.scopeRank, 12)),
      db
        .select()
        .from(aiMemoryScopeConfig)
        .where(inArray(aiMemoryScopeConfig.scopeKey, scopeKeys)),
    ]);
  const memories = rankedMemoryRows.map(
    ({ scopeRank: _scopeRank, ...memory }) => memory
  );
  const changes = rankedChangeRows.map(
    ({ scopeRank: _scopeRank, ...change }) => change
  );
  const memoriesByMailboxId = new Map(
    mailboxIds.map((mailboxId) => [mailboxId, [] as MemoryRow[]])
  );
  const changesByMailboxId = new Map(
    mailboxIds.map((mailboxId) => [
      mailboxId,
      [] as (typeof aiMemoryChangeSet.$inferSelect)[],
    ])
  );
  const configurationsByMailboxId = new Map(
    configurations.flatMap((configuration) =>
      hasText(configuration.mailboxId)
        ? [[configuration.mailboxId, configuration] as const]
        : []
    )
  );
  for (const memory of memories) {
    if (hasText(memory.mailboxId)) {
      memoriesByMailboxId.get(memory.mailboxId)?.push(memory);
    }
  }
  for (const change of changes) {
    if (hasText(change.mailboxId)) {
      changesByMailboxId.get(change.mailboxId)?.push(change);
    }
  }

  return new Map(
    mailboxIds.map((mailboxId) => [
      mailboxId,
      {
        learning: toAiMemoryScopeConfig(
          configurationsByMailboxId.get(mailboxId)
        ),
        memory: buildAiMemoryScope({
          changes: changesByMailboxId.get(mailboxId)?.slice(0, 12) ?? [],
          memories:
            memoriesByMailboxId
              .get(mailboxId)
              ?.slice(0, MEMORY_CANDIDATE_LIMIT) ?? [],
        }),
      },
    ])
  );
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
  if (requestedScope === "mailbox" && !hasText(mailboxId)) {
    throw new Error("A mailbox is required.");
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
  if (requestedScope === "mailbox" && !hasText(mailboxId)) {
    throw new Error("A mailbox is required.");
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
      throw new Error("That memory change cannot be undone.");
    }
    const [existingUndo] = await tx
      .select({ id: aiMemoryChangeSet.id })
      .from(aiMemoryChangeSet)
      .where(eq(aiMemoryChangeSet.undoOfId, changeSet.id))
      .limit(1);
    if (existingUndo !== undefined) {
      throw new Error("That memory change was already undone.");
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
        throw new Error(
          "Memory changed again after this update and can no longer be safely undone."
        );
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
                expiresAt: hasText(previous.expiresAt)
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
        throw new Error("Memory changed while the undo was being applied.");
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
            sql`${userAiContextEvent.metadata}->>'memoryScope' = 'user'`
          )
        )
      );
    return { deleted: true };
  });

export const purgeMailboxAiMemory = async (mailboxId: string) =>
  await db.transaction(async (tx) => {
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
