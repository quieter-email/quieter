import { EventType, memoryStream, replayRunStream, type StreamChunk } from "@tanstack/ai";
import { describe, expect, test } from "vite-plus/test";
import {
  CHAT_AGENT_MAX_ITERATIONS,
  CHAT_AGENT_MAX_TOKENS,
  streamChunksThroughDurability,
} from "../src/run-chat-stream";

const collect = async (stream: AsyncIterable<StreamChunk>) => {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
};

describe("chat generation budget", () => {
  test("keeps each run within the configured hard bounds", () => {
    expect(CHAT_AGENT_MAX_ITERATIONS).toBeLessThanOrEqual(12);
    expect(CHAT_AGENT_MAX_TOKENS).toBeLessThanOrEqual(4_096);
  });
});

describe("streamChunksThroughDurability", () => {
  test("closes with a cancelled terminal when the producer aborts without one", async () => {
    const durability = memoryStream({ runId: "run-cancel-terminal" });
    const abortController = new AbortController();

    const producer = (async () => {
      const stream = (async function* () {
        yield {
          type: EventType.RUN_STARTED,
          timestamp: Date.now(),
          runId: "run-cancel-terminal",
          threadId: "thread-1",
        } as StreamChunk;
        abortController.abort();
      })();

      await collect(
        streamChunksThroughDurability({
          abortSignal: abortController.signal,
          durability,
          stream,
        }),
      );
    })();

    await producer;

    const replayed = await collect(replayRunStream(durability));
    expect(replayed.some((chunk) => chunk.type === EventType.RUN_STARTED)).toBe(true);
    expect(
      replayed.some(
        (chunk) =>
          chunk.type === EventType.RUN_ERROR && "code" in chunk && chunk.code === "cancelled",
      ),
    ).toBe(true);
  });

  test("does not invent a second terminal when the producer already finished", async () => {
    const durability = memoryStream({ runId: "run-finished-terminal" });

    await collect(
      streamChunksThroughDurability({
        durability,
        stream: (async function* () {
          yield {
            type: EventType.RUN_STARTED,
            timestamp: Date.now(),
            runId: "run-finished-terminal",
            threadId: "thread-1",
          } as StreamChunk;
          yield {
            type: EventType.RUN_FINISHED,
            timestamp: Date.now(),
            runId: "run-finished-terminal",
            threadId: "thread-1",
          } as StreamChunk;
        })(),
      }),
    );

    const replayed = await collect(replayRunStream(durability));
    expect(replayed.filter((chunk) => chunk.type === EventType.RUN_FINISHED)).toHaveLength(1);
    expect(replayed.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(false);
  });
});
