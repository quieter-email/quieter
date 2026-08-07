import type { StreamChunk, StreamDurability } from "@tanstack/ai";
import { db } from "@quieter/database/client";
import { chatRun, chatRunStreamChunk } from "@quieter/database/schema";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";

const FROM_START_OFFSET = "-1";
const FROM_TAIL_OFFSET = "now";
const READ_POLL_INTERVAL_MS = 200;
const DEFAULT_FIRST_CHUNK_DEADLINE_MS = 30_000;

type PostgresStreamDurabilityInit = {
  firstChunkDeadlineMs?: number;
  offset?: string | null;
  runId: string;
};

const encodeOffset = (runId: string, seq: number) => `${runId}:${seq}`;

const decodeSeq = (runId: string, offset: string): number | null => {
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

const isStreamClosed = async (runId: string) => {
  const [row] = await db
    .select({ streamClosedAt: chatRun.streamClosedAt })
    .from(chatRun)
    .where(eq(chatRun.id, runId))
    .limit(1);
  return Boolean(row?.streamClosedAt);
};

const readAfter = async (runId: string, afterSeq: number) =>
  db
    .select({
      chunk: chatRunStreamChunk.chunk,
      offset: chatRunStreamChunk.offset,
      seq: chatRunStreamChunk.seq,
    })
    .from(chatRunStreamChunk)
    .where(and(eq(chatRunStreamChunk.runId, runId), gt(chatRunStreamChunk.seq, afterSeq)))
    .orderBy(asc(chatRunStreamChunk.seq));

/**
 * Postgres-backed TanStack AI StreamDurability for detached chat producers
 * (AWS Workflow / local in-process) and Cloudflare Worker observers.
 */
export const createPostgresStreamDurability = (
  source: Request | PostgresStreamDurabilityInit,
  options?: { firstChunkDeadlineMs?: number },
): StreamDurability => {
  const init: PostgresStreamDurabilityInit =
    source instanceof Request
      ? {
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
  const resumeOffset = init.offset ?? null;
  const firstChunkDeadlineMs =
    init.firstChunkDeadlineMs ?? options?.firstChunkDeadlineMs ?? DEFAULT_FIRST_CHUNK_DEADLINE_MS;

  return {
    resumeFrom: () => resumeOffset,
    append: async (chunks) => {
      if (chunks.length === 0) {
        return [];
      }

      const now = new Date();
      const offsets: string[] = [];

      await db.transaction(async (tx) => {
        const [tail] = await tx
          .select({ seq: chatRunStreamChunk.seq })
          .from(chatRunStreamChunk)
          .where(eq(chatRunStreamChunk.runId, runId))
          .orderBy(desc(chatRunStreamChunk.seq))
          .limit(1);
        let nextSeq = tail?.seq ?? 0;

        const rows = chunks.map((chunk) => {
          nextSeq += 1;
          const offset = encodeOffset(runId, nextSeq);
          offsets.push(offset);
          return {
            chunk: chunk as unknown as Record<string, unknown>,
            createdAt: now,
            offset,
            runId,
            seq: nextSeq,
          };
        });

        await tx.insert(chatRunStreamChunk).values(rows);
      });

      return offsets;
    },
    close: async () => {
      await db
        .update(chatRun)
        .set({ streamClosedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(chatRun.id, runId), isNull(chatRun.streamClosedAt)));
    },
    snapshot: async () => {
      const rows = await db
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
        const [tail] = await db
          .select({ seq: chatRunStreamChunk.seq })
          .from(chatRunStreamChunk)
          .where(eq(chatRunStreamChunk.runId, runId))
          .orderBy(desc(chatRunStreamChunk.seq))
          .limit(1);
        cursorSeq = tail?.seq ?? 0;
      } else {
        const seq = decodeSeq(runId, offset);
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

        const entries = await readAfter(runId, cursorSeq);
        for (const entry of entries) {
          cursorSeq = entry.seq;
          sawChunk = true;
          yield {
            chunk: entry.chunk as unknown as StreamChunk,
            offset: entry.offset,
          };
        }

        if (await isStreamClosed(runId)) {
          return;
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

export const closeChatRunStreamLog = async (runId: string) => {
  await db
    .update(chatRun)
    .set({ streamClosedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(chatRun.id, runId), isNull(chatRun.streamClosedAt)));
};
