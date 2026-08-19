import { EventType } from "@tanstack/ai";
import type { StreamChunk } from "@tanstack/ai";
import { describe, expect, test, vi } from "vite-plus/test";

import { followChatRunEvents } from "./chat-run-stream";

const CHAT_STREAM_PATH = "/api/chat/runs/";

// `openChatRunStream` builds the SSE url from `window.location.origin`.
(globalThis as Record<string, unknown>).window = {
  location: { origin: "http://localhost" },
};

const textChunk = (messageId: string, delta: string): StreamChunk => ({
  delta,
  messageId,
  timestamp: Date.now(),
  type: EventType.TEXT_MESSAGE_CONTENT,
});

const finishChunk = (runId: string): StreamChunk => ({
  runId,
  threadId: runId,
  timestamp: Date.now(),
  type: EventType.RUN_FINISHED,
});

const sseResponse = (
  events: { chunk: StreamChunk; id?: string }[]
): Response => {
  const body = events
    .map(
      ({ chunk, id }) =>
        `${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(
          chunk
        )}\n\n`
    )
    .join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

const getLastEventId = (init?: RequestInit) =>
  new Headers(init?.headers).get("Last-Event-ID") ?? undefined;

type ChatStreamFetchMock = ReturnType<typeof vi.fn<FetchLike>>;

/** Mock fetch for the SSE endpoint only; the internal `delay` helper also calls fetch. */
const stubChatStreamFetch = (
  handler: (init?: RequestInit) => Response | Promise<Response>
) => {
  const fetchMock = vi.fn<FetchLike>(async (input, init) => {
    if (!requestUrl(input).includes(CHAT_STREAM_PATH)) {
      return new Response(null, { status: 200 });
    }
    return await handler(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const chatStreamCallCount = (fetchMock: ChatStreamFetchMock) =>
  fetchMock.mock.calls.filter(([input]) =>
    requestUrl(input).includes(CHAT_STREAM_PATH)
  ).length;

describe("followChatRunEvents reconnect loop", () => {
  test("yields chunks through a clean terminal stream", async () => {
    const runId = "run-clean";
    const fetchMock = stubChatStreamFetch(() =>
      sseResponse([
        { chunk: textChunk("m1", "Hello"), id: `${runId}:1` },
        { chunk: finishChunk(runId), id: `${runId}:2` },
      ])
    );

    const chunks: StreamChunk[] = [];
    for await (const chunk of followChatRunEvents({ runId })) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.type)).toStrictEqual([
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.RUN_FINISHED,
    ]);
    expect(chatStreamCallCount(fetchMock)).toBe(1);
    vi.unstubAllGlobals();
  });

  test("resumes from the last event id on a drop and dedupes replayed chunks", async () => {
    const runId = "run-resume";
    const fetchMock = stubChatStreamFetch((init) => {
      const lastEventId = getLastEventId(init);
      if (lastEventId === undefined) {
        // First connection delivers one chunk then closes without a terminal chunk.
        return sseResponse([
          { chunk: textChunk("m1", "Hello"), id: `${runId}:1` },
        ]);
      }
      // Reconnect replays the same chunk; the seen set must drop the replay.
      return sseResponse([
        { chunk: textChunk("m1", "Hello"), id: `${runId}:1` },
        { chunk: finishChunk(runId), id: `${runId}:2` },
      ]);
    });

    const deltas: string[] = [];
    for await (const chunk of followChatRunEvents({ runId })) {
      if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) {
        deltas.push(chunk.delta ?? "");
      }
    }

    expect(deltas).toStrictEqual(["Hello"]);
    expect(chatStreamCallCount(fetchMock)).toBe(2);
    vi.unstubAllGlobals();
  });

  test("gives up after the bounded reconnect budget instead of retrying forever", async () => {
    const runId = "run-dead";
    const fetchMock = stubChatStreamFetch(() => {
      throw new Error("connection refused");
    });

    await expect(async () => {
      for await (const _chunk of followChatRunEvents({ runId })) {
        // No chunks can be produced by a dead connection.
      }
    }).rejects.toThrow("connection refused");

    // One initial open plus the 8 allowed reconnects; it must stop, not loop forever.
    expect(chatStreamCallCount(fetchMock)).toBe(9);
    vi.unstubAllGlobals();
  });
});
