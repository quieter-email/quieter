import { db, type DatabaseClient } from "@quieter/database/client";
import { chatRun, chatRunStreamChunk } from "@quieter/database/schema";
import { EventType, type StreamChunk, type StreamDurability } from "@tanstack/ai";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";

const FROM_START_OFFSET = "-1";
const FROM_TAIL_OFFSET = "now";
const READ_POLL_INTERVAL_MS = 200;
const DEFAULT_FIRST_CHUNK_DEADLINE_MS = 30_000;

type PostgresStreamDurabilityInit = {
  client?: DatabaseClient;
  firstChunkDeadlineMs?: number;
  offset?: string | null;
  runId: string;
};

export const encodeChatRunStreamOffset = (runId: string, seq: number) => `${runId}:${seq}`;

export const decodeChatRunStreamSeq = (runId: string, offset: string): number | null => {
  if (offset === FROM_START_OFFSET) {
    return 0;
  }

  const prefix = `${runId}:`;
  if (!offset.startsWith(prefix)) {
    return null;
  }

  const seq = Number(offset.slice(prefix.length));
  return Number.isSafeInteger(seq) && seq >= 1 ? seq : null;
};

/** Normalize a client resume cursor; unknown/unsafe values restart from the beginning. */
export const sanitizeChatRunStreamOffset = (
  runId: string,
  offset: string | null | undefined,
): string => {
  if (offset == null || offset === "" || offset === FROM_START_OFFSET) {
    return FROM_START_OFFSET;
  }

  if (offset === FROM_TAIL_OFFSET) {
    return FROM_TAIL_OFFSET;
  }

  return decodeChatRunStreamSeq(runId, offset) === null ? FROM_START_OFFSET : offset;
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(finish, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const closeChatRunStreamLog = async (runId: string, client: DatabaseClient = db) => {
  await client
    .update(chatRun)
    .set({ streamClosedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(chatRun.id, runId), isNull(chatRun.streamClosedAt)));
};

const isStreamClosed = async (runId: string, client: DatabaseClient) => {
  const [row] = await client
    .select({ streamClosedAt: chatRun.streamClosedAt })
    .from(chatRun)
    .where(eq(chatRun.id, runId))
    .limit(1);
  return Boolean(row?.streamClosedAt);
};

const readAfter = async (runId: string, afterSeq: number, client: DatabaseClient) =>
  client
    .select({
      chunk: chatRunStreamChunk.chunk,
      offset: chatRunStreamChunk.offset,
      seq: chatRunStreamChunk.seq,
    })
    .from(chatRunStreamChunk)
    .where(and(eq(chatRunStreamChunk.runId, runId), gt(chatRunStreamChunk.seq, afterSeq)))
    .orderBy(asc(chatRunStreamChunk.seq));

/**
 * Postgres-backed TanStack AI StreamDurability (legacy delivery log).
 * Live chat observation uses the in-memory hub / Durable Object instead.
 */
export const createPostgresStreamDurability = (
  source: Request | PostgresStreamDurabilityInit,
  options?: { client?: DatabaseClient; firstChunkDeadlineMs?: number },
): StreamDurability => {
  const init: PostgresStreamDurabilityInit =
    source instanceof Request
      ? {
          client: options?.client,
          firstChunkDeadlineMs: options?.firstChunkDeadlineMs,
          offset:
            source.headers.get("Last-Event-ID") ?? new URL(source.url).searchParams.get("offset"),
          runId:
            source.headers.get("X-Run-Id") ?? new URL(source.url).searchParams.get("runId") ?? "",
        }
      : source;

  if (!init.runId) {
    throw new Error(
      "a runId is required: send it as an X-Run-Id header, a ?runId query param, or MemoryStreamInit.runId",
    );
  }

  const runId = init.runId;
  // Capture the request-scoped client so long-lived SSE reads keep using it after ALS ends.
  const client = init.client ?? options?.client ?? db;
  const resumeOffset = init.offset ?? null;
  const firstChunkDeadlineMs =
    init.firstChunkDeadlineMs ?? options?.firstChunkDeadlineMs ?? DEFAULT_FIRST_CHUNK_DEADLINE_MS;
  // Single-writer producer: resolve the tail once, then allocate seq in memory.
  let nextSeq: number | undefined;

  return {
    resumeFrom: () => resumeOffset,
    append: async (chunks) => {
      if (chunks.length === 0) {
        return [];
      }

      const now = new Date();
      const offsets: string[] = [];

      await client.transaction(async (tx) => {
        if (nextSeq === undefined) {
          const [tail] = await tx
            .select({ seq: chatRunStreamChunk.seq })
            .from(chatRunStreamChunk)
            .where(eq(chatRunStreamChunk.runId, runId))
            .orderBy(desc(chatRunStreamChunk.seq))
            .limit(1);
          nextSeq = tail?.seq ?? 0;
        }

        let seq = nextSeq;
        const rows = chunks.map((chunk) => {
          seq += 1;
          const offset = encodeChatRunStreamOffset(runId, seq);
          offsets.push(offset);
          return {
            chunk: chunk as unknown as Record<string, unknown>,
            createdAt: now,
            offset,
            runId,
            seq,
          };
        });

        await tx.insert(chatRunStreamChunk).values(rows);
        nextSeq = seq;
      });

      return offsets;
    },
    close: async () => {
      await closeChatRunStreamLog(runId, client);
    },
    snapshot: async () => {
      const rows = await client
        .select({
          chunk: chatRunStreamChunk.chunk,
          offset: chatRunStreamChunk.offset,
        })
        .from(chatRunStreamChunk)
        .where(eq(chatRunStreamChunk.runId, runId))
        .orderBy(asc(chatRunStreamChunk.seq));

      return rows.map((row) => ({
        chunk: row.chunk as unknown as StreamChunk,
        offset: row.offset,
      }));
    },
    read: async function* (offset, signal) {
      let cursorSeq: number;
      if (offset === FROM_TAIL_OFFSET) {
        const [tail] = await client
          .select({
            chunk: chatRunStreamChunk.chunk,
            seq: chatRunStreamChunk.seq,
          })
          .from(chatRunStreamChunk)
          .where(eq(chatRunStreamChunk.runId, runId))
          .orderBy(desc(chatRunStreamChunk.seq))
          .limit(1);
        cursorSeq = tail?.seq ?? 0;

        // Late joiners using `now` after close would otherwise skip the terminal
        // event and hang/reconnect forever. Rewind to just before it.
        if (tail && (await isStreamClosed(runId, client))) {
          const tipType = (tail.chunk as { type?: string } | null)?.type;
          if (tipType === EventType.RUN_FINISHED || tipType === EventType.RUN_ERROR) {
            cursorSeq = tail.seq - 1;
          }
        }
      } else {
        const seq = decodeChatRunStreamSeq(runId, offset);
        if (seq === null) {
          throw new Error(`Invalid stream offset ${JSON.stringify(offset)}`);
        }
        cursorSeq = seq;
      }

      const startedAt = Date.now();
      let sawChunk = cursorSeq > 0 || offset === FROM_TAIL_OFFSET;

      for (;;) {
        if (signal?.aborted) {
          return;
        }

        const entries = await readAfter(runId, cursorSeq, client);
        for (const entry of entries) {
          cursorSeq = entry.seq;
          sawChunk = true;
          yield {
            chunk: entry.chunk as unknown as StreamChunk,
            offset: entry.offset,
          };
        }

        if (await isStreamClosed(runId, client)) {
          // Race: producer may append the terminal batch then close. Drain once more.
          const trailing = await readAfter(runId, cursorSeq, client);
          if (trailing.length === 0) {
            return;
          }

          for (const entry of trailing) {
            cursorSeq = entry.seq;
            sawChunk = true;
            yield {
              chunk: entry.chunk as unknown as StreamChunk,
              offset: entry.offset,
            };
          }
          continue;
        }

        if (!sawChunk && Date.now() - startedAt > firstChunkDeadlineMs) {
          throw new Error(
            `Chat stream run ${runId} produced no data within ${firstChunkDeadlineMs}ms`,
          );
        }

        try {
          await wait(READ_POLL_INTERVAL_MS, signal);
        } catch {
          return;
        }
      }
    },
  };
};
