import { settleChatStreamBeforeTerminal } from "@quieter/orpc/chat";
import { EventType } from "@tanstack/ai";
import type { StreamChunk } from "@tanstack/ai";
import { describe, expect, test } from "vite-plus/test";

const runStarted = {
  runId: "run-1",
  threadId: "thread-1",
  type: EventType.RUN_STARTED,
} satisfies StreamChunk;

const runFinished = {
  runId: "run-1",
  threadId: "thread-1",
  type: EventType.RUN_FINISHED,
} satisfies StreamChunk;

describe("chat stream settlement", () => {
  test("settles the source before exposing its terminal event", async () => {
    let settled = false;
    const source = async function* source(): AsyncGenerator<StreamChunk> {
      yield runStarted;
      yield runFinished;
      settled = true;
    };
    const iterator =
      settleChatStreamBeforeTerminal(source())[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: runStarted,
    });
    expect(settled).toBeFalsy();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: runFinished,
    });
    expect(settled).toBeTruthy();
    await expect(iterator.next()).resolves.toStrictEqual({
      done: true,
      value: undefined,
    });
  });
});
