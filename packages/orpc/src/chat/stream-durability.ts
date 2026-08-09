import { db } from "@quieter/database/client";
import type { DatabaseClient } from "@quieter/database/client";
import { chatRun, chatRunStreamChunk } from "@quieter/database/schema";
import { EventType } from "@tanstack/ai";
import type { StreamChunk, StreamDurability } from "@tanstack/ai";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";

import { delay, isAborted } from "./stream-delay";

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

type StreamChunkRow = {
  chunk: Record<string, unknown>;
  offset: string;
  seq: number;
};

export const encodeChatRunStreamOffset = (runId: string, seq: number) =>
  `${runId}:${seq}`;

export const decodeChatRunStreamSeq = (
  runId: string,
  offset: string
): number | null => {
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
  offset: string | null | undefined
): string => {
  if (
    offset === null ||
    offset === undefined ||
    offset === "" ||
    offset === FROM_START_OFFSET
  ) {
    return FROM_START_OFFSET;
  }

  if (offset === FROM_TAIL_OFFSET) {
    return FROM_TAIL_OFFSET;
  }

  return decodeChatRunStreamSeq(runId, offset) === null
    ? FROM_START_OFFSET
    : offset;
};

const isStreamChunkRecord = (value: unknown): value is StreamChunk => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const type: unknown = Reflect.get(value, "type");
  return typeof type === "string";
};

const toStoredStreamChunk = (chunk: StreamChunk): Record<string, unknown> => {
  if (!isStreamChunkRecord(chunk)) {
    throw new Error("Invalid stream chunk payload.");
  }

  return { ...chunk };
};

const parseStoredStreamChunk = (
  value: Record<string, unknown>
): StreamChunk => {
  if (!isStreamChunkRecord(value)) {
    throw new Error("Invalid stored stream chunk payload.");
  }

  return value;
};

export const closeChatRunStreamLog = async (
  runId: string,
  client: DatabaseClient = db
) => {
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
  return row?.streamClosedAt !== null && row?.streamClosedAt !== undefined;
};

const readAfter = async (
  runId: string,
  afterSeq: number,
  client: DatabaseClient
): Promise<StreamChunkRow[]> =>
  await client
    .select({
      chunk: chatRunStreamChunk.chunk,
      offset: chatRunStreamChunk.offset,
      seq: chatRunStreamChunk.seq,
    })
    .from(chatRunStreamChunk)
    .where(
      and(
        eq(chatRunStreamChunk.runId, runId),
        gt(chatRunStreamChunk.seq, afterSeq)
      )
    )
    .orderBy(asc(chatRunStreamChunk.seq));

const getChunkType = (chunk: Record<string, unknown>) => {
  const type = Reflect.get(chunk, "type");
  return typeof type === "string" ? type : undefined;
};

const resolveTailCursorSeq = async (
  runId: string,
  client: DatabaseClient
): Promise<number> => {
  const [tail] = await client
    .select({
      chunk: chatRunStreamChunk.chunk,
      seq: chatRunStreamChunk.seq,
    })
    .from(chatRunStreamChunk)
    .where(eq(chatRunStreamChunk.runId, runId))
    .orderBy(desc(chatRunStreamChunk.seq))
    .limit(1);
  const tailSeq = tail?.seq ?? 0;

  if (tail === undefined) {
    return tailSeq;
  }

  if (!(await isStreamClosed(runId, client))) {
    return tailSeq;
  }

  const tipType = getChunkType(tail.chunk);
  if (tipType === EventType.RUN_FINISHED || tipType === EventType.RUN_ERROR) {
    return tail.seq - 1;
  }

  return tailSeq;
};

const yieldEntries = function* yieldEntries(
  entries: StreamChunkRow[],
  state: { cursorSeq: number; sawChunk: boolean }
) {
  for (const entry of entries) {
    state.cursorSeq = entry.seq;
    state.sawChunk = true;
    yield {
      chunk: parseStoredStreamChunk(entry.chunk),
      offset: entry.offset,
    };
  }
};

/**
 * Postgres-backed TanStack AI StreamDurability (legacy delivery log).
 * Live chat observation uses the in-memory hub / Durable Object instead.
 */
export const createPostgresStreamDurability = (
  source: Request | PostgresStreamDurabilityInit,
  options?: { client?: DatabaseClient; firstChunkDeadlineMs?: number }
): StreamDurability => {
  const init: PostgresStreamDurabilityInit =
    source instanceof Request
      ? {
          client: options?.client,
          firstChunkDeadlineMs: options?.firstChunkDeadlineMs,
          offset:
            source.headers.get("Last-Event-ID") ??
            new URL(source.url).searchParams.get("offset"),
          runId:
            source.headers.get("X-Run-Id") ??
            new URL(source.url).searchParams.get("runId") ??
            "",
        }
      : source;

  if (init.runId === "") {
    throw new Error(
      "a runId is required: send it as an X-Run-Id header, a ?runId query param, or MemoryStreamInit.runId"
    );
  }

  const { runId } = init;
  const client = init.client ?? options?.client ?? db;
  const resumeOffset = init.offset ?? null;
  const firstChunkDeadlineMs =
    init.firstChunkDeadlineMs ??
    options?.firstChunkDeadlineMs ??
    DEFAULT_FIRST_CHUNK_DEADLINE_MS;
  let nextSeq: number | undefined;

  return {
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
            chunk: toStoredStreamChunk(chunk),
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
    async *read(offset, signal) {
      let cursorSeq: number;
      if (offset === FROM_TAIL_OFFSET) {
        cursorSeq = await resolveTailCursorSeq(runId, client);
      } else {
        const seq = decodeChatRunStreamSeq(runId, offset);
        if (seq === null) {
          throw new Error(`Invalid stream offset ${JSON.stringify(offset)}`);
        }
        cursorSeq = seq;
      }

      const startedAt = Date.now();
      const state = {
        cursorSeq,
        sawChunk: cursorSeq > 0 || offset === FROM_TAIL_OFFSET,
      };

      const poll = async function* poll(): AsyncGenerator<
        { chunk: StreamChunk; offset: string },
        void,
        undefined
      > {
        if (isAborted(signal)) {
          return;
        }

        const entries = await readAfter(runId, state.cursorSeq, client);
        yield* yieldEntries(entries, state);

        if (await isStreamClosed(runId, client)) {
          const trailing = await readAfter(runId, state.cursorSeq, client);
          if (trailing.length === 0) {
            return;
          }

          yield* yieldEntries(trailing, state);
          yield* poll();
          return;
        }

        if (!state.sawChunk && Date.now() - startedAt > firstChunkDeadlineMs) {
          throw new Error(
            `Chat stream run ${runId} produced no data within ${firstChunkDeadlineMs}ms`
          );
        }

        try {
          await delay(READ_POLL_INTERVAL_MS, signal);
        } catch {
          return;
        }

        yield* poll();
      };

      yield* poll();
    },
    resumeFrom: () => resumeOffset,
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
        chunk: parseStoredStreamChunk(row.chunk),
        offset: row.offset,
      }));
    },
  };
};
