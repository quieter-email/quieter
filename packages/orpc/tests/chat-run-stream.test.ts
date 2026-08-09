import { EventType } from "@tanstack/ai";
import type { StreamChunk } from "@tanstack/ai";
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
    expect(isActiveChatRunStatus("queued")).toBeTruthy();
    expect(isActiveChatRunStatus("waiting_on_tool")).toBeTruthy();
    expect(isActiveChatRunStatus("complete")).toBeFalsy();
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
        delta: "Hello",
        messageId: "m1",
        timestamp: Date.now(),
        type: EventType.TEXT_MESSAGE_CONTENT,
      } satisfies StreamChunk,
    ]);

    const received: string[] = [];
    const hubIterator = hub.subscribe()[Symbol.asyncIterator]();

    const firstEntry = await hubIterator.next();
    if (firstEntry.value?.chunk.type === EventType.TEXT_MESSAGE_CONTENT) {
      received.push(firstEntry.value.chunk.delta ?? "");
    }

    await durability.append([
      {
        delta: " world",
        messageId: "m1",
        timestamp: Date.now(),
        type: EventType.TEXT_MESSAGE_CONTENT,
      } satisfies StreamChunk,
      {
        runId,
        threadId: runId,
        timestamp: Date.now(),
        type: EventType.RUN_FINISHED,
      } satisfies StreamChunk,
    ]);
    await durability.close();

    const secondEntry = await hubIterator.next();
    if (
      secondEntry.done !== true &&
      secondEntry.value.chunk.type === EventType.TEXT_MESSAGE_CONTENT
    ) {
      received.push(secondEntry.value.chunk.delta ?? "");
    }

    const thirdEntry = await hubIterator.next();
    const endEntry = await hubIterator.next();
    expect({
      endDone: endEntry.done,
      terminalDone: thirdEntry.done,
      terminalType: thirdEntry.value?.chunk.type,
    }).toStrictEqual({
      endDone: true,
      terminalDone: false,
      terminalType: EventType.RUN_FINISHED,
    });

    expect(received.join("")).toBe("Hello world");
    expect(peekChatRunHub(runId)?.isClosed()).toBeTruthy();
    releaseChatRunHub(runId);
    expect(peekChatRunHub(runId)).toBeUndefined();
  });
});
