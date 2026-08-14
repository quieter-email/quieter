import { db, withRequestDatabaseClient } from "@quieter/database/client";
import { aiMemory, aiMemoryIndexJob } from "@quieter/database/schema";
import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";

import {
  readBoundedJson,
  readLinkedSecret,
  reportWorkerError,
  signaturesMatch,
} from "./worker-utils";

const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b" as const;
const RETRIEVAL_INSTRUCTION =
  "Retrieve durable personal or mailbox knowledge that is relevant to the current agent task.";
const INDEX_BATCH_SIZE = 50;
const MAX_JOB_ATTEMPTS = 8;
const REQUEST_BODY_LIMIT = 16 * 1024;

type AiMemoryWorkerEnv = {
  AI: Ai;
  AI_MEMORY_VECTOR: VectorizeIndex;
  SST_RESOURCE_AiMemoryServiceToken: string;
};

const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  scopeKeys: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^(?:mailbox|user):/u)
    )
    .min(1)
    .max(2),
});

const getBearerToken = (request: Request) =>
  request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(?<token>.+)$/iu)
    ?.groups?.token?.trim() ?? null;

const isAuthorized = async (request: Request, env: AiMemoryWorkerEnv) => {
  const actual = getBearerToken(request);
  if (actual === null || actual === "") {
    return false;
  }
  return await signaturesMatch(
    actual,
    readLinkedSecret(env.SST_RESOURCE_AiMemoryServiceToken)
  );
};

const retryDelay = (attemptCount: number) =>
  Math.min(60 * 60_000, 2 ** Math.min(attemptCount, 10) * 1000);

const claimIndexJobs = async () => {
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - 5 * 60_000);
  const pending = await db
    .select({ id: aiMemoryIndexJob.id })
    .from(aiMemoryIndexJob)
    .where(
      and(
        or(
          eq(aiMemoryIndexJob.status, "pending"),
          and(
            eq(aiMemoryIndexJob.status, "processing"),
            lte(aiMemoryIndexJob.processingAt, staleProcessingBefore)
          )
        ),
        lte(aiMemoryIndexJob.availableAt, now)
      )
    )
    .orderBy(asc(aiMemoryIndexJob.availableAt), asc(aiMemoryIndexJob.createdAt))
    .limit(INDEX_BATCH_SIZE);
  if (pending.length === 0) {
    return [];
  }
  return await db
    .update(aiMemoryIndexJob)
    .set({
      attemptCount: aiMemoryIndexJob.attemptCount,
      processingAt: now,
      status: "processing",
      updatedAt: now,
    })
    .where(
      and(
        inArray(
          aiMemoryIndexJob.id,
          pending.map((job) => job.id)
        ),
        or(
          eq(aiMemoryIndexJob.status, "pending"),
          and(
            eq(aiMemoryIndexJob.status, "processing"),
            lte(aiMemoryIndexJob.processingAt, staleProcessingBefore)
          )
        )
      )
    )
    .returning();
};

const buildEmbeddingText = (memory: typeof aiMemory.$inferSelect) =>
  [
    memory.summary,
    memory.content,
    ...(memory.metadata.topics ?? []),
    ...(memory.metadata.sourceDomains ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);

const markJobsCompleted = async (
  jobs: (typeof aiMemoryIndexJob.$inferSelect)[]
) => {
  if (jobs.length === 0) {
    return;
  }
  const now = new Date();
  await Promise.all(
    jobs.map(async (job) => {
      if (job.processingAt === null) {
        return;
      }
      await db
        .update(aiMemoryIndexJob)
        .set({
          completedAt: now,
          lastError: null,
          processingAt: null,
          status: "completed",
          updatedAt: now,
        })
        .where(
          and(
            eq(aiMemoryIndexJob.id, job.id),
            eq(aiMemoryIndexJob.status, "processing"),
            eq(aiMemoryIndexJob.processingAt, job.processingAt)
          )
        );
    })
  );
};

const markJobsForRetry = async (
  jobs: (typeof aiMemoryIndexJob.$inferSelect)[],
  error: unknown
) => {
  const message =
    error instanceof Error ? error.message.slice(0, 2000) : "Unknown error.";
  await Promise.all(
    jobs.map(async (job) => {
      if (job.processingAt === null) {
        return;
      }
      const attemptCount = job.attemptCount + 1;
      const now = new Date();
      await db
        .update(aiMemoryIndexJob)
        .set({
          attemptCount,
          availableAt: new Date(now.getTime() + retryDelay(attemptCount)),
          lastError: message,
          processingAt: null,
          status: attemptCount >= MAX_JOB_ATTEMPTS ? "failed" : "pending",
          updatedAt: now,
        })
        .where(
          and(
            eq(aiMemoryIndexJob.id, job.id),
            eq(aiMemoryIndexJob.status, "processing"),
            eq(aiMemoryIndexJob.processingAt, job.processingAt)
          )
        );
    })
  );
};

const processIndexJobs = async (env: AiMemoryWorkerEnv) => {
  const jobs = await claimIndexJobs();
  if (jobs.length === 0) {
    return { processed: 0 };
  }
  try {
    const memoryIds = jobs.map((job) => job.memoryId);
    const memories = await db
      .select()
      .from(aiMemory)
      .where(inArray(aiMemory.id, memoryIds));
    const memoriesById = new Map(
      memories.map((memory) => [memory.id, memory] as const)
    );
    const deleteIds = jobs.flatMap((job) => {
      const memory = memoriesById.get(job.memoryId);
      return job.operation === "delete" || memory?.status !== "active"
        ? [job.memoryId]
        : [];
    });
    if (deleteIds.length > 0) {
      await env.AI_MEMORY_VECTOR.deleteByIds([...new Set(deleteIds)]);
    }

    const activeMemories = jobs.flatMap((job) => {
      const memory = memoriesById.get(job.memoryId);
      return job.operation === "upsert" && memory?.status === "active"
        ? [memory]
        : [];
    });
    if (activeMemories.length > 0) {
      const embeddingResult = await env.AI.run(EMBEDDING_MODEL, {
        text: activeMemories.map(buildEmbeddingText),
      });
      const embeddings = embeddingResult.data ?? [];
      if (embeddings.length !== activeMemories.length) {
        throw new Error(
          "Embedding result count did not match the memory batch."
        );
      }
      await env.AI_MEMORY_VECTOR.upsert(
        activeMemories.map((memory, index) => ({
          id: memory.id,
          metadata: { kind: memory.kind, version: memory.version },
          namespace: memory.scopeKey,
          values: embeddings[index] ?? [],
        }))
      );
    }
    await markJobsCompleted(jobs);
    return { processed: jobs.length };
  } catch (error: unknown) {
    await markJobsForRetry(jobs, error);
    throw error;
  }
};

const searchMemory = async (request: Request, env: AiMemoryWorkerEnv) => {
  const parsed = searchRequestSchema.safeParse(
    await readBoundedJson(request, REQUEST_BODY_LIMIT)
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const embeddingResult = await env.AI.run(EMBEDDING_MODEL, {
    text: `Instruct: ${RETRIEVAL_INSTRUCTION}\nQuery: ${parsed.data.query}`,
  });
  const embedding = embeddingResult.data?.[0];
  if (embedding === undefined) {
    throw new Error("The memory query could not be embedded.");
  }
  const results = await Promise.all(
    [...new Set(parsed.data.scopeKeys)].map(
      async (scopeKey) =>
        await env.AI_MEMORY_VECTOR.query(embedding, {
          namespace: scopeKey,
          returnMetadata: "none",
          returnValues: false,
          topK: 40,
        })
    )
  );
  const scores = new Map<string, number>();
  for (const result of results) {
    for (const match of result.matches) {
      scores.set(match.id, Math.max(scores.get(match.id) ?? 0, match.score));
    }
  }
  return Response.json({
    matches: [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .toSorted((left, right) => right.score - left.score),
  });
};

const handleRequest = async (request: Request, env: AiMemoryWorkerEnv) => {
  if (!(await isAuthorized(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === "/sync") {
    return Response.json(await processIndexJobs(env));
  }
  if (request.method === "POST" && path === "/search") {
    return await searchMemory(request, env);
  }
  return new Response(null, { status: 404 });
};

export default {
  async fetch(request: Request, env: AiMemoryWorkerEnv) {
    try {
      return await withRequestDatabaseClient(
        async () => await handleRequest(request, env)
      );
    } catch (error: unknown) {
      reportWorkerError(error, { operation: "ai-memory-worker:request" });
      return Response.json({ error: "Request failed." }, { status: 500 });
    }
  },

  scheduled(_controller, env, context) {
    const runScheduledIndexing = async () => {
      try {
        await withRequestDatabaseClient(
          async () => await processIndexJobs(env)
        );
      } catch (error: unknown) {
        reportWorkerError(error, { operation: "ai-memory-worker:scheduled" });
      }
    };
    context.waitUntil(runScheduledIndexing());
  },
} satisfies ExportedHandler<AiMemoryWorkerEnv>;
