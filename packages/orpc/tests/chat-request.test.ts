import { settleChatStreamBeforeTerminal } from "@quieter/orpc/chat";
import { EventType } from "@tanstack/ai";
import type { StreamChunk } from "@tanstack/ai";
import { describe, expect, test } from "vite-plus/test";

import {
  createChatTitle,
  toCanonicalTranscript,
  validateChatRequest,
} from "../src/chat/request";

const validParams = () => ({
  forwardedProps: {
    category: "inbox",
    context: { threadId: "gmail-thread-1" },
    mailboxId: "mailbox-1",
    model: "openai/gpt-5.6-luna",
  },
  messages: [
    {
      content: "Summarize this thread",
      id: "message-1",
      parts: [{ content: "Summarize this thread", type: "text" }],
      role: "user",
    },
  ],
  runId: "run-1",
  threadId: "b44942c1-aeeb-40a9-9da8-5c054e9f6030",
});

describe("chat request validation", () => {
  test("creates a compact first-message title", () => {
    expect(createChatTitle("  Summarize\n\nmy unread messages  ")).toBe(
      "Summarize my unread messages"
    );
    expect(createChatTitle("x".repeat(80))).toBe(`${"x".repeat(60)}...`);
  });

  test("extracts the latest simple user message and forwarded properties", () => {
    const input = validParams();
    input.messages.unshift({
      content: "Earlier question",
      id: "message-0",
      parts: [{ content: "Earlier question", type: "text" }],
      role: "user",
    });

    expect(validateChatRequest(input)).toStrictEqual({
      forwardedProps: input.forwardedProps,
      kind: "message",
      runId: "run-1",
      threadId: input.threadId,
      userMessage: {
        id: "message-1",
        text: "Summarize this thread",
      },
    });
  });

  test("rejects unknown forwarded properties", () => {
    const input = validParams();
    Object.assign(input.forwardedProps, { userId: "attacker" });

    expect(() => validateChatRequest(input)).toThrow(/unrecognized key/iu);
  });

  test("rejects mismatched or multimodal user content", () => {
    const mismatched = validParams();
    mismatched.messages[0] = {
      content: "Trusted mirror",
      id: "message-1",
      parts: [{ content: "Different part", type: "text" }],
      role: "user",
    };
    expect(() => validateChatRequest(mismatched)).toThrow(/must match/u);

    const multimodal = validParams();
    multimodal.messages[0] = {
      content: "Describe it",
      id: "message-1",
      parts: [{ content: "Describe it", type: "image" }],
      role: "user",
    };
    expect(() => validateChatRequest(multimodal)).toThrow(/invalid input/iu);
  });

  test("requires a UUID thread id", () => {
    const input = validParams();
    input.threadId = "not-a-client-uuid";

    expect(() => validateChatRequest(input)).toThrow(/invalid UUID/iu);
  });

  test("accepts an interrupt continuation without trusting a client message", () => {
    const input = validParams();
    input.messages = [];
    const resumed = {
      ...input,
      parentRunId: "run-parent",
      resume: [
        {
          interruptId: "approval-tool-1",
          payload: { approved: true },
          status: "resolved" as const,
        },
      ],
    };

    expect(validateChatRequest(resumed)).toStrictEqual({
      forwardedProps: input.forwardedProps,
      kind: "resume",
      parentRunId: "run-parent",
      resume: resumed.resume,
      runId: "run-1",
      threadId: input.threadId,
    });
  });
});

describe("canonical transcript conversion", () => {
  test("keeps canonical text and tool parts from database rows", () => {
    const createdAt = new Date("2026-08-20T00:00:00.000Z");
    expect(
      toCanonicalTranscript([
        {
          createdAt,
          id: "system-1",
          parts: [{ content: "hidden", type: "text" }],
          role: "system",
        },
        {
          createdAt,
          id: "user-1",
          parts: [{ content: "Question", type: "text" }],
          role: "user",
        },
        {
          createdAt,
          id: "assistant-1",
          parts: [
            { content: "Answer", type: "text" },
            { content: "ignored", type: "thinking" },
            {
              arguments: '{"query":"is:unread"}',
              id: "tool-1",
              name: "search_gmail",
              state: "complete",
              type: "tool-call",
            },
            {
              content: '{"status":"success"}',
              state: "complete",
              toolCallId: "tool-1",
              type: "tool-result",
            },
          ],
          role: "assistant",
        },
      ])
    ).toStrictEqual([
      {
        createdAt,
        id: "user-1",
        parts: [{ content: "Question", type: "text" }],
        role: "user",
      },
      {
        createdAt,
        id: "assistant-1",
        parts: [
          { content: "Answer", type: "text" },
          { content: "ignored", type: "thinking" },
          {
            arguments: '{"query":"is:unread"}',
            id: "tool-1",
            name: "search_gmail",
            state: "complete",
            type: "tool-call",
          },
          {
            content: '{"status":"success"}',
            state: "complete",
            toolCallId: "tool-1",
            type: "tool-result",
          },
        ],
        role: "assistant",
      },
    ]);
  });
});

describe("chat stream settlement", () => {
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
