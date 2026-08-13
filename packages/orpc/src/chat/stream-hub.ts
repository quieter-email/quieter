import { EventType } from "@tanstack/ai";
import type { StreamChunk, StreamDurability } from "@tanstack/ai";

import { hasText } from "../text";
import { createQueueWaiter, isAborted } from "./stream-delay";

export type ChatRunHubOffset = string;

type HubSubscriber = {
  push: (entry: { chunk: StreamChunk; offset: string }) => void;
  close: (error?: unknown) => void;
};

/**
 * In-memory live fanout for one chat run.
 * Producer appends StreamChunks; observers get dump-then-live over SSE.
 * Used in-process locally and inside the ChatRunSession Durable Object.
 */
export type ChatRunHub = {
  readonly runId: string;
  append: (chunks: StreamChunk[]) => ChatRunHubOffset[];
  close: () => void;
  isClosed: () => boolean;
  snapshot: () => { chunk: StreamChunk; offset: string }[];
  subscribe: (
    signal?: AbortSignal
  ) => AsyncGenerator<{ chunk: StreamChunk; offset: string }, void, undefined>;
};

const hubs = new Map<string, ChatRunHub>();
const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Bound memory for long tool+LLM runs. */
const MAX_HUB_BUFFER_CHUNKS = 4000;
/** Keep sealed hubs briefly so late dump-then-close attaches still work. */
const SEALED_HUB_RETENTION_MS = 60_000;
const SSE_HEARTBEAT_MS = 15_000;

const isTerminalChunk = (chunk: StreamChunk) =>
  chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR;

export const encodeChatRunHubOffset = (runId: string, seq: number) =>
  `${runId}:${seq}`;

export const peekChatRunHub = (runId: string) => hubs.get(runId);

const clearEvictionTimer = (runId: string) => {
  const timer = evictionTimers.get(runId);
  if (timer === undefined) {
    return;
  }
  clearTimeout(timer);
  evictionTimers.delete(runId);
};

/** Close the hub for subscribers but keep the buffer for late dump-then-close attaches. */
export const sealChatRunHub = (runId: string) => {
  hubs.get(runId)?.close();
  clearEvictionTimer(runId);
  evictionTimers.set(
    runId,
    setTimeout(() => {
      evictionTimers.delete(runId);
      const hub = hubs.get(runId);
      if (hub !== undefined && hub.isClosed()) {
        hubs.delete(runId);
      }
    }, SEALED_HUB_RETENTION_MS)
  );
};

/** Close and drop the hub — used before a stale takeover starts a fresh producer. */
export const releaseChatRunHub = (runId: string) => {
  clearEvictionTimer(runId);
  const hub = hubs.get(runId);
  if (hub === undefined) {
    return;
  }
  hub.close();
  hubs.delete(runId);
};

const buildTerminalChatRunChunk = (input: {
  error: string | null;
  runId: string;
  status: string;
}): StreamChunk => {
  if (input.status === "cancelled") {
    return {
      code: "cancelled",
      message: "Generation cancelled.",
      timestamp: Date.now(),
      type: EventType.RUN_ERROR,
    } satisfies StreamChunk;
  }

  if (input.status === "failed") {
    const message = hasText(input.error)
      ? input.error
      : "The response could not finish.";
    return {
      code: "failed",
      message,
      timestamp: Date.now(),
      type: EventType.RUN_ERROR,
    } satisfies StreamChunk;
  }

  return {
    runId: input.runId,
    threadId: input.runId,
    timestamp: Date.now(),
    type: EventType.RUN_FINISHED,
  } satisfies StreamChunk;
};

export const getChatRunHub = (runId: string): ChatRunHub => {
  const existing = hubs.get(runId);
  if (existing !== undefined) {
    return existing;
  }

  const buffer: { chunk: StreamChunk; offset: string }[] = [];
  const subscribers = new Set<HubSubscriber>();
  let nextSeq = 0;
  let closed = false;

  const hub: ChatRunHub = {
    append: (chunks) => {
      if (chunks.length === 0) {
        return [];
      }

      const offsets: string[] = [];
      for (const chunk of chunks) {
        nextSeq += 1;
        const offset = encodeChatRunHubOffset(runId, nextSeq);
        const entry = { chunk, offset };
        buffer.push(entry);
        offsets.push(offset);
        for (const subscriber of subscribers) {
          subscriber.push(entry);
        }
      }
      if (buffer.length > MAX_HUB_BUFFER_CHUNKS) {
        buffer.splice(0, buffer.length - MAX_HUB_BUFFER_CHUNKS);
      }
      return offsets;
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      for (const subscriber of subscribers) {
        subscriber.close();
      }
      subscribers.clear();
    },
    isClosed: () => closed,
    runId,
    snapshot: () => buffer.map((entry) => ({ ...entry })),
    async *subscribe(signal) {
      const queue: { chunk: StreamChunk; offset: string }[] = [];
      const waiter = createQueueWaiter();
      let done = closed;

      const subscriber: HubSubscriber = {
        close: (error) => {
          done = true;
          if (error === undefined) {
            waiter.wake();
          } else {
            waiter.reject(error);
          }
        },
        push: (entry) => {
          queue.push(entry);
          waiter.wake();
        },
      };

      const onAbort = () => {
        subscribers.delete(subscriber);
        waiter.reject(
          signal?.reason ?? new DOMException("Aborted", "AbortError")
        );
      };

      if (isAborted(signal)) {
        throw signal?.reason ?? new DOMException("Aborted", "AbortError");
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      subscribers.add(subscriber);

      const drainLive = async function* drainLive(): AsyncGenerator<
        { chunk: StreamChunk; offset: string },
        void,
        undefined
      > {
        if (isAborted(signal) || (done && queue.length === 0)) {
          return;
        }

        if (queue.length === 0) {
          await waiter.wait();
          yield* drainLive();
          return;
        }

        const entry = queue.shift();
        if (entry === undefined) {
          yield* drainLive();
          return;
        }

        yield entry;
        if (!isTerminalChunk(entry.chunk)) {
          yield* drainLive();
        }
      };

      try {
        const replay = buffer.slice();
        const replayedOffsets = new Set(replay.map((entry) => entry.offset));
        for (const entry of replay) {
          yield entry;
        }

        while (
          queue.length > 0 &&
          replayedOffsets.has(queue[0]?.offset ?? "")
        ) {
          queue.shift();
        }

        if (replay.some((entry) => isTerminalChunk(entry.chunk))) {
          return;
        }

        yield* drainLive();
      } finally {
        signal?.removeEventListener("abort", onAbort);
        subscribers.delete(subscriber);
      }
    },
  };

  hubs.set(runId, hub);
  return hub;
};

/** Producer-side StreamDurability backed by the in-memory hub (no Postgres). */
export const createHubStreamDurability = (runId: string): StreamDurability => {
  const hub = getChatRunHub(runId);

  return {
    append: async (chunks) => {
      const offsets = hub.append(chunks);
      await Promise.resolve();
      return offsets;
    },
    close: async () => {
      hub.close();
      await Promise.resolve();
    },
    async *read(_offset, signal) {
      yield* hub.subscribe(signal);
    },
    resumeFrom: () => null,
    snapshot: async () => {
      await Promise.resolve();
      return hub.snapshot();
    },
  };
};

const sseEncoder = new TextEncoder();
const sseHeaders = {
  "Cache-Control": "no-cache, no-transform",
  "Content-Type": "text/event-stream",
  "X-Accel-Buffering": "no",
} as const;

export const encodeChatRunSseChunk = (chunk: StreamChunk, offset: string) =>
  sseEncoder.encode(`id: ${offset}\ndata: ${JSON.stringify(chunk)}\n\n`);

export const createTerminalChatRunSseResponse = (input: {
  error: string | null;
  runId: string;
  status: string;
}) => {
  const chunk = buildTerminalChatRunChunk(input);
  const body = encodeChatRunSseChunk(chunk, `${input.runId}:terminal`);
  return new Response(body, {
    headers: sseHeaders,
  });
};

/** Dump-then-live SSE Response from an in-memory hub. */
export const createChatRunHubSseResponse = (
  hub: ChatRunHub,
  signal?: AbortSignal
) => {
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      // Subscriber cleanup happens in hub.subscribe finally via abort signal.
    },
    async start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseEncoder.encode(":\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, SSE_HEARTBEAT_MS);

      try {
        for await (const entry of hub.subscribe(signal)) {
          controller.enqueue(encodeChatRunSseChunk(entry.chunk, entry.offset));
          if (isTerminalChunk(entry.chunk)) {
            break;
          }
        }
        controller.close();
      } catch (error) {
        if (isAborted(signal)) {
          controller.close();
          return;
        }
        controller.error(error);
      } finally {
        clearInterval(heartbeat);
      }
    },
  });

  return new Response(stream, {
    headers: sseHeaders,
  });
};
