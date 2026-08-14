import {
  embedAiMemoryDocuments,
  embedAiMemoryQuery,
} from "@quieter/ai/memory-embeddings";
import { db } from "@quieter/database/client";
import { aiMemory } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import {
  and,
  cosineDistance,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

const EMBEDDING_BACKFILL_BATCH_SIZE = 32;
const SEMANTIC_CANDIDATE_LIMIT = 40;
const SEMANTIC_MINIMUM_SIMILARITY = 0.3;

type MemoryRow = typeof aiMemory.$inferSelect;

/**
 * The embedded document intentionally mirrors what retrieval matches against:
 * the human-readable memory plus its retrieval tags.
 */
export const buildAiMemoryDocument = (
  memory: Pick<MemoryRow, "content" | "metadata" | "summary">
) =>
  [
    memory.summary,
    memory.content,
    ...(memory.metadata.topics ?? []),
    ...(memory.metadata.sourceDomains ?? []),
  ]
    .filter((part) => part !== "")
    .join("\n");

const storeEmbeddings = async (
  rows: { embedding: number[]; id: string; updatedAt: Date }[]
) => {
  const now = new Date();
  await Promise.all(
    rows.map(
      async (row) =>
        await db
          .update(aiMemory)
          .set({
            embeddedAt: now,
            embedding: row.embedding,
            updatedAt: sql`${aiMemory.updatedAt}`,
          })
          .where(
            and(
              eq(aiMemory.id, row.id),
              eq(aiMemory.status, "active"),
              // A concurrent rewrite bumps updatedAt, so a stale embedding
              // never lands on newer content.
              eq(aiMemory.updatedAt, row.updatedAt)
            )
          )
    )
  );
};

const embedMemoryRows = async (rows: MemoryRow[]) => {
  if (rows.length === 0) {
    return 0;
  }
  const embeddings = await embedAiMemoryDocuments(
    rows.map((row) => buildAiMemoryDocument(row))
  );
  if (embeddings === null) {
    return 0;
  }
  await storeEmbeddings(
    rows.flatMap((row, index) => {
      const embedding = embeddings[index];
      return embedding === undefined
        ? []
        : [{ embedding, id: row.id, updatedAt: row.updatedAt }];
    })
  );
  return rows.length;
};

/**
 * Embeds the given memories immediately. Failures are non-fatal because
 * `embedPendingAiMemories` re-attempts anything still missing an embedding.
 */
export const embedAiMemories = async (memoryIds: string[]) => {
  const uniqueIds = [...new Set(memoryIds)];
  if (uniqueIds.length === 0) {
    return;
  }
  try {
    const rows = await db
      .select()
      .from(aiMemory)
      .where(
        and(inArray(aiMemory.id, uniqueIds), eq(aiMemory.status, "active"))
      )
      .limit(EMBEDDING_BACKFILL_BATCH_SIZE);
    await embedMemoryRows(rows);
  } catch (error: unknown) {
    reportError(error, { operation: "ai-memory:embed" });
  }
};

/**
 * Drains memories that have no current embedding. A null embedding is the
 * queue, so a failed write, a migration backfill, and a newly written record
 * all recover through the same path.
 */
export const embedPendingAiMemories = async (scopeKeys: string[]) => {
  if (scopeKeys.length === 0) {
    return;
  }
  try {
    const rows = await db
      .select()
      .from(aiMemory)
      .where(
        and(
          inArray(aiMemory.scopeKey, scopeKeys),
          eq(aiMemory.status, "active"),
          isNull(aiMemory.embedding)
        )
      )
      .limit(EMBEDDING_BACKFILL_BATCH_SIZE);
    await embedMemoryRows(rows);
  } catch (error: unknown) {
    reportError(error, { operation: "ai-memory:embed-pending" });
  }
};

/**
 * Returns the semantically closest active memories in the given scopes,
 * together with their cosine similarity. Returns an empty result when
 * embeddings are unavailable so retrieval degrades to lexical ranking.
 */
export const searchAiMemoryBySimilarity = async ({
  query,
  scopeKeys,
}: {
  query: string;
  scopeKeys: string[];
}): Promise<{ rows: MemoryRow[]; similarity: ReadonlyMap<string, number> }> => {
  const empty = { rows: [], similarity: new Map<string, number>() };
  if (query === "" || scopeKeys.length === 0) {
    return empty;
  }
  try {
    const embedding = await embedAiMemoryQuery(query);
    if (embedding === null) {
      return empty;
    }
    const similarity = sql<number>`1 - (${cosineDistance(aiMemory.embedding, embedding)})`;
    const matches = await db
      .select({ memory: aiMemory, similarity })
      .from(aiMemory)
      .where(
        and(
          inArray(aiMemory.scopeKey, scopeKeys),
          eq(aiMemory.status, "active"),
          gt(similarity, SEMANTIC_MINIMUM_SIMILARITY)
        )
      )
      .orderBy(desc(similarity))
      .limit(SEMANTIC_CANDIDATE_LIMIT);
    return {
      rows: matches.map((match) => match.memory),
      similarity: new Map(
        matches.map((match) => [match.memory.id, match.similarity] as const)
      ),
    };
  } catch (error: unknown) {
    reportError(error, { operation: "ai-memory:similarity-search" });
    return empty;
  }
};
