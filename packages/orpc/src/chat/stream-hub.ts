import { EventType, type StreamChunk, type StreamDurability } from "@tanstack/ai";

export type ChatRunHubOffset = string;

type HubSubscriber = {
  push: (entry: { chunk: StreamChunk; offset: string }) => void;
  close: (error?: unknown) => void;
};

/**
 * In-memory live fanout for one chat run.
 * Producer appends StreamChunks; observers get dump-then-live over SSE.
 * Used in-process (local/review) and inside the ChatRunSession Durable Object.
 */
export type ChatRunHub = {
  readonly runId: string;
  append: (chunks: StreamChunk[]) => ChatRunHubOffset[];
  close: () => void;
  isClosed: () => boolean;
  snapshot: () => Array<{ chunk: StreamChunk; offset: string }>;
  subscribe: (
    signal?: AbortSignal,
  ) => AsyncGenerator<{ chunk: StreamChunk; offset: string }, void, undefined>;
};

const hubs = new Map<string, ChatRunHub>();

const isTerminalChunk = (chunk: StreamChunk) =>
  chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR;

export const encodeChatRunHubOffset = (runId: string, seq: number) => `${runId}:${seq}`;

export const peekChatRunHub = (runId: string) => hubs.get(runId);

/** Close the hub for subscribers but keep the buffer for late dump-then-close attaches. */
export const sealChatRunHub = (runId: string) => {
  hubs.get(runId)?.close();
};

/** Close and drop the hub — used before a stale takeover starts a fresh producer. */
export const releaseChatRunHub = (runId: string) => {
  const hub = hubs.get(runId);
  if (!hub) {
    return;
  }
  hub.close();
  hubs.delete(runId);
};

export const getChatRunHub = (runId: string): ChatRunHub => {
  const existing = hubs.get(runId);
  if (existing) {
    return existing;
  }

  const buffer: Array<{ chunk: StreamChunk; offset: string }> = [];
  const subscribers = new Set<HubSubscriber>();
  let nextSeq = 0;
  let closed = false;

  const hub: ChatRunHub = {
    runId,
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
    snapshot: () => buffer.map((entry) => ({ ...entry })),
    subscribe: async function* (signal) {
      const queue: Array<{ chunk: StreamChunk; offset: string }> = [];
      let resolveWait: (() => void) | undefined;
      let rejectWait: ((error: unknown) => void) | undefined;
      let done = closed;

      const wake = () => {
        resolveWait?.();
        resolveWait = undefined;
        rejectWait = undefined;
      };

      const subscriber: HubSubscriber = {
        push: (entry) => {
          queue.push(entry);
          wake();
        },
        close: (error) => {
          done = true;
          if (error !== undefined) {
            rejectWait?.(error);
          } else {
            wake();
          }
        },
      };

      const onAbort = () => {
        subscribers.delete(subscriber);
        rejectWait?.(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };

      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      subscribers.add(subscriber);

      try {
        for (const entry of buffer) {
          yield entry;
        }

        if (closed || buffer.some((entry) => isTerminalChunk(entry.chunk))) {
          return;
        }

        while (!done && !signal?.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve, reject) => {
              resolveWait = resolve;
              rejectWait = reject;
            });
            continue;
          }

          const entry = queue.shift();
          if (!entry) {
            continue;
          }
          yield entry;
          if (isTerminalChunk(entry.chunk)) {
            return;
          }
        }
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
export const createHubStreamDurability = (runId: string): StreamDurability<ChatRunHubOffset> => {
  const hub = getChatRunHub(runId);

  return {
    resumeFrom: () => null,
    append: async (chunks) => hub.append(chunks),
    close: async () => {
      hub.close();
    },
    snapshot: async () => hub.snapshot(),
    read: async function* (offset, signal) {
      void offset;
      yield* hub.subscribe(signal);
    },
  };
};

const sseEncoder = new TextEncoder();

export const encodeChatRunSseChunk = (chunk: StreamChunk, offset: string) =>
  sseEncoder.encode(`id: ${offset}\ndata: ${JSON.stringify(chunk)}\n\n`);

export const createTerminalChatRunSseResponse = (input: {
  error: string | null;
  runId: string;
  status: string;
}) => {
  const chunk: StreamChunk =
    input.status === "cancelled"
      ? ({
          type: EventType.RUN_ERROR,
          timestamp: Date.now(),
          message: "Generation cancelled.",
          code: "cancelled",
          error: {
            code: "cancelled",
            message: "Generation cancelled.",
          },
        } satisfies StreamChunk)
      : input.status === "failed"
        ? ({
            type: EventType.RUN_ERROR,
            timestamp: Date.now(),
            message: input.error || "The response could not finish.",
            code: "failed",
            error: {
              code: "failed",
              message: input.error || "The response could not finish.",
            },
          } satisfies StreamChunk)
        : ({
            type: EventType.RUN_FINISHED,
            timestamp: Date.now(),
            runId: input.runId,
            threadId: input.runId,
          } satisfies StreamChunk);

  const body = encodeChatRunSseChunk(chunk, `${input.runId}:terminal`);
  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
};

/** Dump-then-live SSE Response from an in-memory hub. */
export const createChatRunHubSseResponse = (hub: ChatRunHub, signal?: AbortSignal) => {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const entry of hub.subscribe(signal)) {
          controller.enqueue(encodeChatRunSseChunk(entry.chunk, entry.offset));
          if (isTerminalChunk(entry.chunk)) {
            break;
          }
        }
        controller.close();
      } catch (error) {
        if (signal?.aborted) {
          controller.close();
          return;
        }
        controller.error(error);
      }
    },
    cancel() {
      // Subscriber cleanup happens in hub.subscribe finally via abort signal.
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
};
