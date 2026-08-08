import { EventType, type StreamChunk } from "@tanstack/ai";
import { describe, expect, test } from "vite-plus/test";
import { isActiveChatRunStatus } from "../src/chat-run-store";
import {
  createHubStreamDurability,
  encodeChatRunHubOffset,
  getChatRunHub,
  peekChatRunHub,
  releaseChatRunHub,
} from "../src/chat/stream-hub";

describe("chat run stream hub", () => {
  test("identifies active statuses", () => {
    expect(isActiveChatRunStatus("queued")).toBe(true);
    expect(isActiveChatRunStatus("waiting_on_tool")).toBe(true);
    expect(isActiveChatRunStatus("complete")).toBe(false);
  });

  test("encodes opaque offsets per chunk", () => {
    expect(encodeChatRunHubOffset("run-a", 1)).toBe("run-a:1");
  });

  test("dump-then-live delivers buffered chunks then live appends", async () => {
    const runId = `hub-${crypto.randomUUID()}`;
    const hub = getChatRunHub(runId);
    const durability = createHubStreamDurability(runId);

    await durability.append([
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        timestamp: Date.now(),
        messageId: "m1",
        delta: "Hello",
      } satisfies StreamChunk,
    ]);

    const received: string[] = [];
    let resolveAttached: (() => void) | undefined;
    const attached = new Promise<void>((resolve) => {
      resolveAttached = resolve;
    });

    const reader = (async () => {
      let sawBuffered = false;
      for await (const entry of hub.subscribe()) {
        if (entry.chunk.type === EventType.TEXT_MESSAGE_CONTENT) {
          received.push(String((entry.chunk as { delta?: string }).delta ?? ""));
          if (!sawBuffered) {
            sawBuffered = true;
            resolveAttached?.();
          }
        }
        if (entry.chunk.type === EventType.RUN_FINISHED) {
          break;
        }
      }
    })();

    await attached;

    await durability.append([
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        timestamp: Date.now(),
        messageId: "m1",
        delta: " world",
      } satisfies StreamChunk,
      {
        type: EventType.RUN_FINISHED,
        timestamp: Date.now(),
        runId,
        threadId: runId,
      } satisfies StreamChunk,
    ]);
    await durability.close();
    await reader;

    expect(received.join("")).toBe("Hello world");
    expect(peekChatRunHub(runId)?.isClosed()).toBe(true);
    releaseChatRunHub(runId);
    expect(peekChatRunHub(runId)).toBeUndefined();
  });
});
