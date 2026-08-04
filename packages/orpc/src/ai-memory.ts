import type { ChatMiddleware } from "@tanstack/ai";
import {
  AI_MEMORY_MODEL,
  AI_MEMORY_REQUEST_MAX_LENGTH,
  planAiMemoryUpdate,
  type AiMemoryEditorMemory,
  type AiMemoryUpdatePlan,
} from "@quieter/ai/ai-memory";
import {
  chatModelSchema,
  defaultAutoLabelModel,
  defaultUsefulDetailModel,
} from "@quieter/ai/chat-models";
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
  type AiMemoryChange,
  type AiMemoryMetadata,
  type AiMemorySnapshot,
  type AiMemorySource,
  type UserAiContextEventKind,
} from "@quieter/database/schema";
import { and, desc, eq, getTableColumns, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const MEMORY_CANDIDATE_LIMIT = 200;
const MEMORY_CONTEXT_LIMIT = 8;
const MEMORY_CONTEXT_CHARACTER_BUDGET = 4_000;
const MEMORY_EVENT_METADATA_STRING_LIMIT = 600;
export const AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH = 6_000;
export const DEFAULT_AI_MEMORY_LEARNING_PROMPT = `Focus on durable patterns that help Quieter act like the mailbox's users: communication tone, concise versus detailed replies, greetings and sign-offs, how style changes by recipient or relationship, recurring correspondents, normal response timing, and repeated message-handling choices. Prefer repeated or explicit evidence, preserve uncertainty, expire time-sensitive observations, and do not retain raw message content or secrets.`;

export type AiMemoryEventMetadata = Record<string, string | number | boolean | null>;
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
    .filter((value): value is string => !!value)
    .join(" ")
    .slice(0, 2_000);

export const serializeAiAgentContext = ({ instructions, memory }: AiAgentMemoryContext) =>
  [
    ...(instructions ? [`User-authored instructions:\n${instructions}`] : []),
    ...(memory ? [`Relevant learned memory:\n${memory}`] : []),
  ].join("\n\n") || null;

type MemoryRow = typeof aiMemory.$inferSelect;

type MemoryScopeTarget =
  | { mailboxId: string; scope: "mailbox"; scopeKey: string; userId: null }
  | { mailboxId: null; scope: "user"; scopeKey: string; userId: string };

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

const toAiMemoryScopeConfig = (record: typeof aiMemoryScopeConfig.$inferSelect | undefined) => ({
  activeLearningEnabled: record?.activeLearningEnabled ?? true,
  learningPrompt: record?.learningPrompt.trim() || DEFAULT_AI_MEMORY_LEARNING_PROMPT,
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
  const scope = requestedScope === "user" ? userScope(userId) : mailboxScope(mailboxId ?? "");
  if (requestedScope === "mailbox" && !mailboxId) throw new Error("A mailbox is required.");
  const normalizedPrompt = learningPrompt
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
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
              eq(aiMemoryScopeConfig.revision, revision),
            ),
          )
          .returning();
  if (!record) throw new Error("Learning guidance changed elsewhere. Review the latest version.");
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
  kind: record.kind,
  key: record.key,
  status: record.status,
  summary: record.summary,
  topics: record.metadata.topics ?? [],
});

const sanitizeMetadata = (metadata: AiMemoryEventMetadata): AiMemoryEventMetadata => {
  const sanitized: AiMemoryEventMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      sanitized[key] = trimmed ? trimmed.slice(0, MEMORY_EVENT_METADATA_STRING_LIMIT) : null;
    } else if (typeof value !== "number" || Number.isFinite(value)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

const normalizeSearchTokens = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9._@:-]{1,}/g)
      ?.filter((token) => token.length > 2)
      .slice(0, 120) ?? [],
  );

export const rankAiMemoryCandidates = ({
  agent,
  candidates,
  now = new Date(),
  query,
}: {
  agent: string;
  candidates: MemoryRow[];
  now?: Date;
  query: string;
}) => {
  const queryTokens = normalizeSearchTokens(`${agent.replaceAll("_", " ")} ${query}`);

  return candidates
    .flatMap((memory) => {
      const agents = memory.metadata.agents ?? ["all"];
      if (!agents.includes("all") && !agents.includes(agent)) return [];
      if (memory.status !== "active" || (memory.expiresAt && memory.expiresAt <= now)) return [];

      const contentTokens = normalizeSearchTokens(
        `${memory.content} ${memory.summary} ${(memory.metadata.topics ?? []).join(" ")}`,
      );
      const overlap = [...queryTokens].filter((token) => contentTokens.has(token)).length;
      const sourceDomainMatch = (memory.metadata.sourceDomains ?? []).some((domain) =>
        query.toLowerCase().includes(domain.toLowerCase()),
      );
      const alwaysRelevant = memory.importance === 5 && agents.includes("all");
      if (overlap === 0 && !sourceDomainMatch && !alwaysRelevant) return [];

      const ageDays = Math.max(0, (now.getTime() - memory.lastConfirmedAt.getTime()) / 86_400_000);
      const recency = Math.exp(-ageDays / 180);
      const lexical = Math.min(0.7, overlap * 0.16);
      const score =
        lexical +
        (sourceDomainMatch ? 0.65 : 0) +
        memory.importance * 0.035 +
        memory.confidence * 0.06 +
        recency * 0.08 +
        Math.min(0.05, Math.log2(memory.reinforcementCount + 1) * 0.012);

      return [{ memory, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.memory.updatedAt.getTime() - left.memory.updatedAt.getTime(),
    );
};

const formatMemoryContext = (ranked: ReturnType<typeof rankAiMemoryCandidates>) => {
  const selected: MemoryRow[] = [];
  let usedCharacters = 0;

  for (const { memory } of ranked) {
    if (selected.length >= MEMORY_CONTEXT_LIMIT) break;
    const nextLength = memory.content.length + 4;
    if (usedCharacters + nextLength > MEMORY_CONTEXT_CHARACTER_BUDGET) continue;
    selected.push(memory);
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
  const usefulDetailModel = chatModelSchema.safeParse(record?.usefulDetailModel);

  return {
    autoLabelModel: autoLabelModel.success ? autoLabelModel.data : defaultAutoLabelModel,
    usefulDetailModel: usefulDetailModel.success
      ? usefulDetailModel.data
      : defaultUsefulDetailModel,
  };
};

export type AiAgentMemoryCandidates = MemoryRow[];

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
            lt(userAiContextEvent.processingAt, new Date(Date.now() - 120_000)),
          ),
        ),
      )
      .orderBy(userAiContextEvent.createdAt)
      .limit(1);
    if (pendingEvent) {
      void refreshAiMemoryFromEvent({ eventId: pendingEvent.id }).catch((error) =>
        console.error("Could not refresh AI memory from a pending event.", error),
      );
    }
    const scopeKeys = [`mailbox:${mailboxId}`, ...(includeUserScope ? [`user:${userId}`] : [])];
    return await db
      .select()
      .from(aiMemory)
      .where(and(inArray(aiMemory.scopeKey, scopeKeys), eq(aiMemory.status, "active")))
      .orderBy(desc(aiMemory.importance), desc(aiMemory.lastConfirmedAt))
      .limit(MEMORY_CANDIDATE_LIMIT);
  } catch (error) {
    console.error("Could not load dynamic AI memory candidates.", error);
    return [];
  }
};

export const rankAiAgentMemoryCandidates = ({
  agent,
  candidates,
  query,
}: {
  agent: string;
  candidates: AiAgentMemoryCandidates;
  query: string;
}): AiAgentMemoryContext => {
  try {
    const ranked = rankAiMemoryCandidates({ agent, candidates, query });
    const selected = formatMemoryContext([
      ...ranked.filter(({ memory }) => memory.scope === "mailbox" && memory.kind === "instruction"),
      ...ranked.filter(({ memory }) => memory.scope === "user" && memory.kind === "instruction"),
      ...ranked.filter(({ memory }) => memory.scope === "mailbox" && memory.kind === "learned"),
      ...ranked.filter(({ memory }) => memory.scope === "user" && memory.kind === "learned"),
    ]);
    const mailboxInstructions = selected.filter(
      (memory) => memory.scope === "mailbox" && memory.kind === "instruction",
    );
    const userInstructions = selected.filter(
      (memory) => memory.scope === "user" && memory.kind === "instruction",
    );
    const mailboxMemories = selected.filter(
      (memory) => memory.scope === "mailbox" && memory.kind === "learned",
    );
    const userMemories = selected.filter(
      (memory) => memory.scope === "user" && memory.kind === "learned",
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
      void db
        .update(aiMemory)
        .set({
          lastUsedAt: new Date(),
          updatedAt: sql`${aiMemory.updatedAt}`,
        })
        .where(
          inArray(
            aiMemory.id,
            selected.map((memory) => memory.id),
          ),
        )
        .catch((error) => console.error("Could not record AI memory retrieval.", error));
    }

    return {
      instructions: instructionSections.join("\n\n") || null,
      memory: memorySections.join("\n\n") || null,
    };
  } catch (error) {
    console.error("Could not rank dynamic AI memory.", error);
    return { instructions: null, memory: null };
  }
};

export const loadAiAgentContext = async ({
  agent,
  includeUserScope = true,
  mailboxId,
  query,
  userId,
}: {
  agent: string;
  includeUserScope?: boolean;
  mailboxId: string;
  query: string;
  userId: string;
}): Promise<AiAgentMemoryContext> =>
  rankAiAgentMemoryCandidates({
    agent,
    candidates: await loadAiAgentMemoryCandidates({ includeUserScope, mailboxId, userId }),
    query,
  });

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
  expiresAt: operation.expiresAt ? new Date(operation.expiresAt) : null,
  importance: operation.importance,
  kind: operation.kind,
  key: operation.key,
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
}) =>
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select "id" from "aiMemory" where "scopeKey" = ${scope.scopeKey} for update`,
    );
    const current = await tx.select().from(aiMemory).where(eq(aiMemory.scopeKey, scope.scopeKey));
    const recordsById = new Map(current.map((memory) => [memory.id, memory]));
    const recordsByKey = new Map(current.map((memory) => [memory.key, memory]));
    const changes: AiMemoryChange[] = [];
    const now = new Date();

    for (const operation of plan.operations) {
      const target = operation.targetId
        ? recordsById.get(operation.targetId)
        : recordsByKey.get(operation.key);
      if (
        source !== "explicit" &&
        (operation.kind === "instruction" || target?.kind === "instruction")
      ) {
        continue;
      }

      if (operation.action === "archive") {
        if (!target || target.status === "archived") continue;
        const [updated] = await tx
          .update(aiMemory)
          .set({
            archivedAt: now,
            status: "archived",
            updatedAt: now,
            version: sql`${aiMemory.version} + 1`,
          })
          .where(and(eq(aiMemory.id, target.id), eq(aiMemory.version, target.version)))
          .returning();
        if (!updated) throw new Error("AI memory changed while the update was being applied.");
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
          .where(and(eq(aiMemory.id, target.id), eq(aiMemory.version, target.version)))
          .returning();
        if (!updated) throw new Error("AI memory changed while the update was being applied.");
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
        if (!inserted) throw new Error("Could not create AI memory.");
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

    const [changeSet] = await tx
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

    if (!changeSet) throw new Error("Could not record the AI memory change.");
    return changeSet;
  });

const createUsageMiddleware = () => {
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd: number | undefined = 0;
  let cachedTokens = 0;
  let cacheWriteTokens = 0;
  const middleware: ChatMiddleware = {
    name: "dynamic-ai-memory-usage",
    onUsage: (_context, usage) => {
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      costUsd =
        costUsd === undefined || usage.cost === undefined ? undefined : costUsd + usage.cost;
      cachedTokens += usage.promptTokensDetails?.cachedTokens ?? 0;
      cacheWriteTokens += usage.promptTokensDetails?.cacheWriteTokens ?? 0;
    },
  };

  return {
    middleware,
    usage: () => ({
      cachedTokens,
      cacheWriteTokens,
      completionTokens,
      costUsd,
      promptTokens,
    }),
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
  usage: ReturnType<ReturnType<typeof createUsageMiddleware>["usage"]>;
  userId: string;
}) =>
  await reportAiUsage({
    costUsd: usage.costUsd,
    completionTokens: usage.completionTokens,
    externalId,
    ...(mailboxId ? { mailboxId } : {}),
    model: AI_MEMORY_MODEL,
    promptTokens: usage.promptTokens,
    promptTokensDetails: {
      cachedTokens: usage.cachedTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    },
    usageKind: "aiMemory",
    userId,
  }).catch((error) => console.error("Could not report dynamic AI memory usage.", error));

export const requestAiMemoryUpdate = async ({
  allowMutations = true,
  mailboxId,
  request,
  scope: requestedScope,
  userId,
}: {
  allowMutations?: boolean;
  mailboxId: string;
  request: string;
  scope: "mailbox" | "user";
  userId: string;
}) => {
  const normalizedRequest = request.trim().slice(0, AI_MEMORY_REQUEST_MAX_LENGTH);
  if (!normalizedRequest) throw new Error("Ask a question or describe what should change.");
  const scope = requestedScope === "user" ? userScope(userId) : mailboxScope(mailboxId);
  const [current, config] = await Promise.all([
    listScopeMemories(scope.scopeKey),
    loadAiMemoryScopeConfig(scope),
  ]);
  const usage = createUsageMiddleware();

  try {
    const plan = await planAiMemoryUpdate({
      currentMemories: current.map(toEditorMemory),
      learningGuidance: allowMutations
        ? config.learningPrompt
        : `${config.learningPrompt}\n\nThis interaction is read-only. Answer the question and return zero operations.`,
      middleware: [usage.middleware],
      request: normalizedRequest,
      source: "explicit",
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
      changeSetSource: "settings",
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
      error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error.",
      id: randomUUID(),
      mailboxId: scope.mailboxId,
      request: normalizedRequest,
      source: "settings",
      status: "failed",
      summary: "Nothing changed because Quieter could not safely apply that memory update.",
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
  if (!selectedMailbox) return null;
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

const canRunMemoryModel = async (input: { organizationId: string; userId: string }) => {
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!entitlement.hasAccess) return false;
  if (entitlement.hasUnlimitedAccess || !entitlement.account) return true;
  const usage = await getBillingCreditUsage(entitlement.account);
  return usage.costMicroCents < usage.creditAmountMicroCents;
};

export const refreshAiMemoryFromEvent = async ({ eventId }: { eventId: string }) => {
  const [candidate] = await db
    .select()
    .from(userAiContextEvent)
    .where(eq(userAiContextEvent.id, eventId))
    .limit(1);
  if (!candidate || candidate.mergedAt || candidate.skippedAt)
    return { status: "skipped" as const };
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
          lt(userAiContextEvent.processingAt, new Date(claimedAt.getTime() - 120_000)),
        ),
      ),
    )
    .returning();
  if (!event) return { status: "skipped" as const };

  const [existingChangeSet] = await db
    .select({ id: aiMemoryChangeSet.id })
    .from(aiMemoryChangeSet)
    .where(eq(aiMemoryChangeSet.sourceEventId, event.id))
    .limit(1);
  if (existingChangeSet) {
    await db
      .update(userAiContextEvent)
      .set({ lastError: null, mergedAt: new Date(), processingAt: null, updatedAt: new Date() })
      .where(eq(userAiContextEvent.id, event.id));
    return { status: "refreshed" as const };
  }

  if (!(await canRunMemoryModel({ organizationId: event.organizationId, userId: event.userId }))) {
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

  const isExplicit = event.kind === "chat_discovery" || event.kind === "explicit_preference";
  const isFeedback =
    event.kind === "auto_label_feedback" || event.kind === "useful_detail_feedback";
  const memorySource: AiMemorySource = isExplicit
    ? "explicit"
    : isFeedback
      ? "feedback"
      : "inferred";
  const scope =
    event.metadata.memoryScope === "user" ? userScope(event.userId) : mailboxScope(event.mailboxId);
  const [current, config] = await Promise.all([
    listScopeMemories(scope.scopeKey),
    loadAiMemoryScopeConfig(scope),
  ]);
  if (!isExplicit && !config.activeLearningEnabled) {
    await db
      .update(userAiContextEvent)
      .set({ lastError: null, processingAt: null, skippedAt: new Date(), updatedAt: new Date() })
      .where(eq(userAiContextEvent.id, event.id));
    return { status: "skipped" as const };
  }
  const request = JSON.stringify({ kind: event.kind, metadata: event.metadata });
  const usage = createUsageMiddleware();

  try {
    const plan = await planAiMemoryUpdate({
      currentMemories: current.map(toEditorMemory),
      learningGuidance: config.learningPrompt,
      middleware: [usage.middleware],
      request,
      source: memorySource,
    });
    const changeSet = await applyAiMemoryPlan({
      actorUserId: event.userId,
      changeSetSource: isExplicit ? "chat" : isFeedback ? "feedback" : "system",
      plan,
      request: null,
      scope,
      source: memorySource,
      sourceEventId: event.id,
    });
    const now = new Date();
    await db
      .update(userAiContextEvent)
      .set({ lastError: null, mergedAt: now, processingAt: null, updatedAt: now })
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
        lastError: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error.",
        processingAt: null,
        updatedAt: new Date(),
      })
      .where(eq(userAiContextEvent.id, event.id));
    return { status: "failed" as const };
  }
};

export const recordAndRefreshAiMemory = async (input: {
  kind: UserAiContextEventKind;
  mailboxId: string;
  metadata: AiMemoryEventMetadata;
  userId: string;
}) => {
  const event = await recordAiMemoryEvent(input);
  return event
    ? await refreshAiMemoryFromEvent({ eventId: event.id })
    : { status: "skipped" as const };
};

const listAddressDomains = (value: string) =>
  Array.from(
    new Set(
      [...value.matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/gi)].map((match) =>
        (match[1] ?? "").toLowerCase(),
      ),
    ),
  )
    .filter(Boolean)
    .slice(0, 12)
    .join(", ");

const classifyGreeting = (text: string) => {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "none";
  const greeting = firstLine.match(
    /^(hi|hello|hey|dear|good (?:morning|afternoon|evening))\b/i,
  )?.[1];
  return greeting?.toLowerCase() ?? "none";
};

const classifySignOff = (text: string) => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4);
  for (const line of lines) {
    const signOff = line.match(
      /^(best|best regards|kind regards|regards|thanks|thank you|cheers|sincerely|warmly)\b/i,
    )?.[1];
    if (signOff) return signOff.toLowerCase();
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
  const normalized = bodyText.replace(/\r\n?/g, "\n").trim().slice(0, 20_000);
  if (!normalized) return { status: "skipped" as const };
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const sentences = normalized.split(/[.!?]+(?:\s|$)/).filter((sentence) => sentence.trim());
  const sentAt = new Date();

  const metadata: AiMemoryEventMetadata = {
    averageSentenceWords: Math.round(words.length / Math.max(1, sentences.length)),
    exclamationCount: (normalized.match(/!/g) ?? []).length,
    greeting: classifyGreeting(normalized),
    isReply,
    paragraphCount: normalized.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length,
    questionCount: (normalized.match(/\?/g) ?? []).length,
    recipientDomains: listAddressDomains(recipients),
    recipientCount: recipients.split(",").filter((recipient) => recipient.trim()).length,
    sentHourUtc: sentAt.getUTCHours(),
    sentWeekdayUtc: sentAt.toLocaleDateString("en", { timeZone: "UTC", weekday: "long" }),
    signOff: classifySignOff(normalized),
    wordCount: words.length,
  };
  const [mailboxConfig, personalConfig] = await Promise.all([
    getMailboxAiMemoryScopeConfig(mailboxId),
    getPersonalAiMemoryScopeConfig(userId),
  ]);
  const updates: Array<ReturnType<typeof recordAiMemoryEvent>> = [];
  if (mailboxConfig.activeLearningEnabled) {
    updates.push(recordAiMemoryEvent({ kind: "sent_message", mailboxId, metadata, userId }));
  }
  if (personalConfig.activeLearningEnabled) {
    updates.push(
      recordAiMemoryEvent({
        kind: "sent_message",
        mailboxId,
        metadata: { ...metadata, memoryScope: "user" },
        userId,
      }),
    );
  }
  if (updates.length === 0) return { status: "skipped" as const };
  const events = await Promise.all(updates);
  for (const event of events) {
    if (event) {
      void refreshAiMemoryFromEvent({ eventId: event.id }).catch((error) =>
        console.error("Could not learn from sent message.", error),
      );
    }
  }
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
  for (const event of events) {
    if (event) {
      void refreshAiMemoryFromEvent({ eventId: event.id }).catch((error) =>
        console.error("Could not learn from mailbox action.", error),
      );
    }
  }
  return events.some(Boolean) ? { status: "recorded" as const } : { status: "skipped" as const };
};

export const replaceMailboxFeedbackMemories = async ({
  agent,
  memories,
  mailboxId,
  userId,
}: {
  agent: "auto_label" | "useful_detail";
  memories: Array<{
    confidence: number;
    content: string;
    importance: number;
    key: string;
    metadata?: AiMemoryMetadata;
    reinforcementCount: number;
    sourceDomains?: string[];
    summary: string;
    topics: string[];
  }>;
  mailboxId: string;
  userId: string;
}) => {
  const prefix = `feedback:${agent}:`;
  const scope = mailboxScope(mailboxId);
  const now = new Date();
  const changes = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select "id" from "aiMemory" where "scopeKey" = ${scope.scopeKey} for update`,
    );
    const current = await tx
      .select()
      .from(aiMemory)
      .where(and(eq(aiMemory.scopeKey, scope.scopeKey), sql`${aiMemory.key} like ${`${prefix}%`}`));
    const byKey = new Map(current.map((memory) => [memory.key, memory]));
    const nextKeys = new Set(memories.map((memory) => `${prefix}${memory.key}`));
    const applied: AiMemoryChange[] = [];

    for (const memory of memories) {
      const key = `${prefix}${memory.key}`;
      const existing = byKey.get(key);
      const values = {
        confidence: memory.confidence,
        content: memory.content.slice(0, 2_000),
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
          JSON.stringify(existing.metadata) === JSON.stringify(values.metadata) &&
          existing.status === "active";
        if (unchanged) continue;
        const [updated] = await tx
          .update(aiMemory)
          .set({
            ...values,
            archivedAt: null,
            version: sql`${aiMemory.version} + 1`,
          })
          .where(and(eq(aiMemory.id, existing.id), eq(aiMemory.version, existing.version)))
          .returning();
        if (!updated) throw new Error("Mailbox memory changed while feedback was being applied.");
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
        if (!inserted) throw new Error("Could not create mailbox feedback memory.");
        applied.push({
          after: toSnapshot(inserted),
          before: null,
          memoryId: inserted.id,
          operation: "add",
        });
      }
    }

    for (const existing of current) {
      if (nextKeys.has(existing.key) || existing.status === "archived") continue;
      const [archived] = await tx
        .update(aiMemory)
        .set({
          archivedAt: now,
          status: "archived",
          updatedAt: now,
          version: sql`${aiMemory.version} + 1`,
        })
        .where(and(eq(aiMemory.id, existing.id), eq(aiMemory.version, existing.version)))
        .returning();
      if (!archived) throw new Error("Mailbox memory changed while feedback was being applied.");
      applied.push({
        after: toSnapshot(archived),
        before: toSnapshot(existing),
        memoryId: archived.id,
        operation: "archive",
      });
    }
    if (applied.length === 0) return [];

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
        sql`${aiMemory.key} like 'feedback:useful_detail:%'`,
      ),
    );
  const globalPolicies = new Map<string, "prefer" | "suppress">();
  const sourcePolicies = new Map<string, "prefer" | "suppress">();

  for (const memory of memories) {
    const detailKind = memory.metadata.detailKind;
    const policy = memory.metadata.policy;
    if (typeof detailKind !== "string" || (policy !== "prefer" && policy !== "suppress")) {
      continue;
    }
    const sourceDomains = memory.metadata.sourceDomains ?? [];
    if (sourceDomains.length === 0) {
      globalPolicies.set(detailKind, policy);
    } else if (source && sourceDomains.includes(source)) {
      sourcePolicies.set(detailKind, policy);
    }
  }

  return new Map([...globalPolicies, ...sourcePolicies]);
};

const buildAiMemoryScope = ({
  changes,
  memories,
}: {
  changes: Array<typeof aiMemoryChangeSet.$inferSelect>;
  memories: MemoryRow[];
}) => {
  const versions = new Map(memories.map((memory) => [memory.id, memory.version]));
  const undoneIds = new Set(
    changes.flatMap((change) => (change.undoOfId ? [change.undoOfId] : [])),
  );
  const now = new Date();
  const activeMemories = memories.filter(
    (memory) => memory.status === "active" && (!memory.expiresAt || memory.expiresAt > now),
  );

  return {
    activeCount: activeMemories.length,
    archivedCount: memories.filter((memory) => memory.status === "archived").length,
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
            (item) => item.after && versions.get(item.memoryId) === item.after.version,
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
  const target = scope === "user" ? userScope(userId) : mailboxScope(mailboxId ?? "");
  if (scope === "mailbox" && !mailboxId) throw new Error("A mailbox is required.");
  const [memories, changes] = await Promise.all([
    listScopeMemories(target.scopeKey),
    db
      .select()
      .from(aiMemoryChangeSet)
      .where(
        scope === "user"
          ? and(eq(aiMemoryChangeSet.userId, userId), isNull(aiMemoryChangeSet.mailboxId))
          : eq(aiMemoryChangeSet.mailboxId, mailboxId ?? ""),
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
  mailboxIds: string[],
): Promise<Map<string, AiMemoryScopeSettings>> => {
  if (mailboxIds.length === 0) return new Map<string, AiMemoryScopeSettings>();
  const scopeKeys = mailboxIds.map((mailboxId) => `mailbox:${mailboxId}`);
  const rankedMemories = db
    .select({
      ...getTableColumns(aiMemory),
      scopeRank:
        sql<number>`row_number() over (partition by ${aiMemory.mailboxId} order by ${aiMemory.status} desc, ${aiMemory.updatedAt} desc)`.as(
          "scopeRank",
        ),
    })
    .from(aiMemory)
    .where(inArray(aiMemory.scopeKey, scopeKeys))
    .as("rankedAiMemorySettings");
  const rankedChanges = db
    .select({
      ...getTableColumns(aiMemoryChangeSet),
      scopeRank:
        sql<number>`row_number() over (partition by ${aiMemoryChangeSet.mailboxId} order by ${aiMemoryChangeSet.createdAt} desc)`.as(
          "scopeRank",
        ),
    })
    .from(aiMemoryChangeSet)
    .where(inArray(aiMemoryChangeSet.mailboxId, mailboxIds))
    .as("rankedAiMemoryChangeSettings");
  const [rankedMemoryRows, rankedChangeRows, configurations] = await Promise.all([
    db.select().from(rankedMemories).where(lte(rankedMemories.scopeRank, MEMORY_CANDIDATE_LIMIT)),
    db.select().from(rankedChanges).where(lte(rankedChanges.scopeRank, 12)),
    db.select().from(aiMemoryScopeConfig).where(inArray(aiMemoryScopeConfig.scopeKey, scopeKeys)),
  ]);
  const memories = rankedMemoryRows.map(({ scopeRank: _scopeRank, ...memory }) => memory);
  const changes = rankedChangeRows.map(({ scopeRank: _scopeRank, ...change }) => change);
  const memoriesByMailboxId = new Map(
    mailboxIds.map((mailboxId) => [mailboxId, [] as MemoryRow[]]),
  );
  const changesByMailboxId = new Map(
    mailboxIds.map((mailboxId) => [mailboxId, [] as Array<typeof aiMemoryChangeSet.$inferSelect>]),
  );
  const configurationsByMailboxId = new Map(
    configurations.flatMap((configuration) =>
      configuration.mailboxId ? [[configuration.mailboxId, configuration] as const] : [],
    ),
  );
  for (const memory of memories) {
    if (memory.mailboxId) memoriesByMailboxId.get(memory.mailboxId)?.push(memory);
  }
  for (const change of changes) {
    if (change.mailboxId) changesByMailboxId.get(change.mailboxId)?.push(change);
  }

  return new Map(
    mailboxIds.map((mailboxId) => [
      mailboxId,
      {
        learning: toAiMemoryScopeConfig(configurationsByMailboxId.get(mailboxId)),
        memory: buildAiMemoryScope({
          changes: changesByMailboxId.get(mailboxId)?.slice(0, 12) ?? [],
          memories: memoriesByMailboxId.get(mailboxId)?.slice(0, MEMORY_CANDIDATE_LIMIT) ?? [],
        }),
      },
    ]),
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
  const scope = requestedScope === "user" ? userScope(userId) : mailboxScope(mailboxId ?? "");
  if (requestedScope === "mailbox" && !mailboxId) throw new Error("A mailbox is required.");
  const [memory] = await db
    .select()
    .from(aiMemory)
    .where(and(eq(aiMemory.id, memoryId), eq(aiMemory.scopeKey, scope.scopeKey)))
    .limit(1);
  if (!memory || memory.status === "archived") return null;
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
        kind: memory.kind,
        key: memory.key,
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
  const scope = requestedScope === "user" ? userScope(userId) : mailboxScope(mailboxId ?? "");
  if (requestedScope === "mailbox" && !mailboxId) throw new Error("A mailbox is required.");
  return await db.transaction(async (tx) => {
    const scopeCondition =
      requestedScope === "user"
        ? and(eq(aiMemoryChangeSet.userId, userId), isNull(aiMemoryChangeSet.mailboxId))
        : eq(aiMemoryChangeSet.mailboxId, mailboxId ?? "");
    const [changeSet] = await tx
      .select()
      .from(aiMemoryChangeSet)
      .where(and(eq(aiMemoryChangeSet.id, changeSetId), scopeCondition))
      .limit(1);
    if (!changeSet || changeSet.status !== "applied" || changeSet.changes.length === 0) {
      throw new Error("That memory change cannot be undone.");
    }
    const [existingUndo] = await tx
      .select({ id: aiMemoryChangeSet.id })
      .from(aiMemoryChangeSet)
      .where(eq(aiMemoryChangeSet.undoOfId, changeSet.id))
      .limit(1);
    if (existingUndo) throw new Error("That memory change was already undone.");

    const now = new Date();
    const inverse: AiMemoryChange[] = [];
    for (const change of [...changeSet.changes].reverse()) {
      const [current] = await tx
        .select()
        .from(aiMemory)
        .where(and(eq(aiMemory.id, change.memoryId), eq(aiMemory.scopeKey, scope.scopeKey)))
        .limit(1);
      if (!current || !change.after || current.version !== change.after.version) {
        throw new Error(
          "Memory changed again after this update and can no longer be safely undone.",
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
                expiresAt: previous.expiresAt ? new Date(previous.expiresAt) : null,
                importance: previous.importance,
                kind: previous.kind,
                key: previous.key,
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
              },
        )
        .where(and(eq(aiMemory.id, current.id), eq(aiMemory.version, current.version)))
        .returning();
      if (!updated) throw new Error("Memory changed while the undo was being applied.");
      inverse.push({
        after: toSnapshot(updated),
        before: toSnapshot(current),
        memoryId: updated.id,
        operation:
          updated.status === "archived"
            ? "archive"
            : current.status === "archived"
              ? "restore"
              : "update",
      });
    }

    const [undo] = await tx
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
    return undo;
  });
};

export const purgePersonalAiMemory = async (userId: string) =>
  await db.transaction(async (tx) => {
    await tx.delete(aiMemory).where(eq(aiMemory.scopeKey, `user:${userId}`));
    await tx
      .delete(aiMemoryChangeSet)
      .where(and(eq(aiMemoryChangeSet.userId, userId), isNull(aiMemoryChangeSet.mailboxId)));
    await tx
      .delete(userAiContextEvent)
      .where(
        and(
          eq(userAiContextEvent.userId, userId),
          or(
            eq(userAiContextEvent.kind, "chat_discovery"),
            eq(userAiContextEvent.kind, "explicit_preference"),
            sql`${userAiContextEvent.metadata}->>'memoryScope' = 'user'`,
          ),
        ),
      );
    return { deleted: true };
  });

export const purgeMailboxAiMemory = async (mailboxId: string) =>
  await db.transaction(async (tx) => {
    await tx.delete(aiMemory).where(eq(aiMemory.scopeKey, `mailbox:${mailboxId}`));
    await tx.delete(aiMemoryChangeSet).where(eq(aiMemoryChangeSet.mailboxId, mailboxId));
    await tx.delete(userAiContextEvent).where(eq(userAiContextEvent.mailboxId, mailboxId));
    await tx.delete(mailAutoLabelFeedback).where(eq(mailAutoLabelFeedback.mailboxId, mailboxId));
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
