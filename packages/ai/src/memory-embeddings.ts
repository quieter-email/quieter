import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

/**
 * Multilingual retrieval embeddings for durable AI memory. The model author
 * recommends prefixing search queries (not stored documents) with an English
 * task instruction, which measurably improves cross-lingual recall.
 */
export const AI_MEMORY_EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const AI_MEMORY_EMBEDDING_DIMENSIONS = 1024;
export const AI_MEMORY_EMBEDDING_INPUT_MAX_LENGTH = 4000;
const AI_MEMORY_EMBEDDING_BATCH_LIMIT = 100;
const AI_MEMORY_EMBEDDING_TIMEOUT_MS = 10_000;
const RETRIEVAL_INSTRUCTION =
  "Retrieve durable personal or mailbox knowledge that is relevant to the current agent task.";

const embeddingResponseSchema = z.object({
  result: z.object({ data: z.array(z.array(z.number())) }),
  success: z.literal(true),
});

const isEmbeddingConfigured = () =>
  (serverEnv.CLOUDFLARE_ACCOUNT_ID ?? "") !== "" &&
  (serverEnv.CLOUDFLARE_AI_API_TOKEN ?? "") !== "";

const runEmbeddingModel = async (texts: string[]) => {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, AI_MEMORY_EMBEDDING_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${serverEnv.CLOUDFLARE_ACCOUNT_ID}/ai/run/${AI_MEMORY_EMBEDDING_MODEL}`,
      {
        body: JSON.stringify({ text: texts }),
        headers: {
          authorization: `Bearer ${serverEnv.CLOUDFLARE_AI_API_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: abortController.signal,
      }
    );
    if (!response.ok) {
      throw new Error(`Embedding request failed with ${response.status}.`);
    }
    const parsed = embeddingResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("The embedding response could not be read.");
    }
    return parsed.data.result.data;
  } finally {
    clearTimeout(timeout);
  }
};

const assertDimensions = (vectors: number[][], expectedCount: number) => {
  if (vectors.length !== expectedCount) {
    throw new Error("The embedding count did not match the input batch.");
  }
  for (const vector of vectors) {
    if (vector.length !== AI_MEMORY_EMBEDDING_DIMENSIONS) {
      throw new Error("The embedding model returned an unexpected dimension.");
    }
  }
  return vectors;
};

/**
 * Embeds stored memory records. Returns null when embeddings are not
 * configured so callers can keep working with lexical retrieval only.
 */
export const embedAiMemoryDocuments = async (documents: string[]) => {
  if (documents.length === 0) {
    return [];
  }
  if (!isEmbeddingConfigured()) {
    return null;
  }
  const batches: string[][] = [];
  for (
    let offset = 0;
    offset < documents.length;
    offset += AI_MEMORY_EMBEDDING_BATCH_LIMIT
  ) {
    batches.push(
      documents
        .slice(offset, offset + AI_MEMORY_EMBEDDING_BATCH_LIMIT)
        .map((document) =>
          document.slice(0, AI_MEMORY_EMBEDDING_INPUT_MAX_LENGTH)
        )
    );
  }
  const embedded = await Promise.all(
    batches.map(async (batch) =>
      assertDimensions(await runEmbeddingModel(batch), batch.length)
    )
  );
  return embedded.flat();
};

/**
 * Embeds a retrieval query. Returns null when embeddings are not configured.
 */
export const embedAiMemoryQuery = async (query: string) => {
  if (!isEmbeddingConfigured()) {
    return null;
  }
  const [embedding] = assertDimensions(
    await runEmbeddingModel([
      `Instruct: ${RETRIEVAL_INSTRUCTION}\nQuery: ${query.slice(0, AI_MEMORY_EMBEDDING_INPUT_MAX_LENGTH)}`,
    ]),
    1
  );
  return embedding ?? null;
};
