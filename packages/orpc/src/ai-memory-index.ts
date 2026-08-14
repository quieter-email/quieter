import { randomUUID } from "node:crypto";

import type { db } from "@quieter/database/client";
import { aiMemoryIndexJob } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { z } from "zod";

import { hasText } from "./text";

const MEMORY_SEARCH_TIMEOUT_MS = 2500;
const MEMORY_SYNC_TIMEOUT_MS = 5000;
const semanticSearchResponseSchema = z.object({
  matches: z.array(
    z.object({
      id: z.string().min(1),
      score: z.number(),
    })
  ),
});

type MemoryIndexWriter = Pick<typeof db, "insert">;

export const enqueueAiMemoryIndexJobs = async ({
  database,
  memoryIds,
  operation,
}: {
  database: MemoryIndexWriter;
  memoryIds: string[];
  operation: "delete" | "upsert";
}) => {
  const uniqueMemoryIds = [...new Set(memoryIds.filter(hasText))];
  if (uniqueMemoryIds.length === 0) {
    return;
  }
  const now = new Date();
  await database
    .insert(aiMemoryIndexJob)
    .values(
      uniqueMemoryIds.map((memoryId) => ({
        attemptCount: 0,
        availableAt: now,
        completedAt: null,
        createdAt: now,
        id: randomUUID(),
        lastError: null,
        memoryId,
        operation,
        processingAt: null,
        status: "pending" as const,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      set: {
        attemptCount: 0,
        availableAt: now,
        completedAt: null,
        lastError: null,
        operation,
        processingAt: null,
        status: "pending",
        updatedAt: now,
      },
      target: aiMemoryIndexJob.memoryId,
    });
};

const memoryServiceRequest = async ({
  body,
  path,
  timeoutMs,
}: {
  body?: unknown;
  path: "/search" | "/sync";
  timeoutMs: number;
}) => {
  const serviceUrl = serverEnv.AI_MEMORY_SERVICE_URL;
  const token = serverEnv.AI_MEMORY_SERVICE_TOKEN;
  if (!hasText(serviceUrl) || !hasText(token)) {
    return null;
  }
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);
  try {
    return await fetch(new URL(path, serviceUrl), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const searchAiMemoryIndex = async ({
  query,
  scopeKeys,
}: {
  query: string;
  scopeKeys: string[];
}) => {
  if (!hasText(query) || scopeKeys.length === 0) {
    return new Map<string, number>();
  }
  try {
    const response = await memoryServiceRequest({
      body: { query: query.slice(0, 2000), scopeKeys: scopeKeys.slice(0, 2) },
      path: "/search",
      timeoutMs: MEMORY_SEARCH_TIMEOUT_MS,
    });
    if (response === null || !response.ok) {
      return new Map<string, number>();
    }
    const parsed = semanticSearchResponseSchema.safeParse(
      await response.json()
    );
    if (!parsed.success) {
      return new Map<string, number>();
    }
    return new Map(
      parsed.data.matches.map((match) => [match.id, match.score] as const)
    );
  } catch (error: unknown) {
    reportError(error, { operation: "ai-memory:semantic-search" });
    return new Map<string, number>();
  }
};

export const triggerAiMemoryIndexing = async () => {
  try {
    const response = await memoryServiceRequest({
      path: "/sync",
      timeoutMs: MEMORY_SYNC_TIMEOUT_MS,
    });
    if (response !== null && !response.ok) {
      throw new Error(`AI memory index sync returned ${response.status}.`);
    }
  } catch (error: unknown) {
    reportError(error, { operation: "ai-memory:index-sync" });
  }
};
