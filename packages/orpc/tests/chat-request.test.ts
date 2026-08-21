import { describe, expect, test } from "vite-plus/test";

import {
  createChatTitle,
  hasLinearConnectorMention,
  toCanonicalTranscript,
  validateChatRequest,
} from "../src/chat/request";

const validBody = (): Record<string, unknown> => ({
  category: "inbox",
  context: { threadId: "gmail-thread-1" },
  mailboxId: "mailbox-1",
  message: {
    id: "message-1",
    parts: [{ text: "Summarize this thread", type: "text" }],
    role: "user",
  },
  model: "openai/gpt-5.6-luna",
  threadId: "b44942c1-aeeb-40a9-9da8-5c054e9f6030",
  trigger: "submit-message",
});

describe("chat request validation", () => {
  test("requires an explicit Linear mention before enabling Linear tools", () => {
    expect(hasLinearConnectorMention("Create a Linear issue")).toBeFalsy();
    expect(hasLinearConnectorMention("Create @Linear issue")).toBeTruthy();
    expect(hasLinearConnectorMention("@Linearity is not Linear")).toBeFalsy();
  });

  test("creates a compact first-message title", () => {
    expect(createChatTitle("  Summarize\n\nmy unread messages  ")).toBe(
      "Summarize my unread messages"
    );
    expect(createChatTitle("x".repeat(80))).toBe(`${"x".repeat(60)}...`);
  });

  test("extracts the latest simple user message and forwarded properties", () => {
    const body = validBody();

    expect(validateChatRequest(body)).toStrictEqual({
      forwardedProps: {
        category: body.category,
        context: body.context,
        mailboxId: body.mailboxId,
        model: body.model,
      },
      kind: "message",
      threadId: body.threadId,
      trigger: "submit-message",
      userMessage: {
        id: "message-1",
        text: "Summarize this thread",
      },
    });
  });

  test("rejects unknown body properties", () => {
    const body = validBody();
    Object.assign(body, { userId: "attacker" });

    expect(() => validateChatRequest(body)).toThrow(
      /unrecognized key|invalid/iu
    );
  });

  test("rejects multimodal user content", () => {
    const body = validBody();
    body.message = {
      id: "message-1",
      parts: [
        { text: "Describe it", type: "text" },
        { text: "data:image/png;base64,x", type: "text" },
      ],
      role: "user",
    };
    expect(() => validateChatRequest(body)).toThrow(/exactly one text part/iu);
  });

  test("requires a UUID thread id", () => {
    const body = validBody();
    body.threadId = "not-a-client-uuid";

    expect(() => validateChatRequest(body)).toThrow(/invalid UUID/iu);
  });

  test("collects approval decisions from an assistant continuation message", () => {
    const body = validBody();
    body.message = {
      id: "assistant-1",
      parts: [
        {
          approval: { approved: true, id: "approval-1" },
          state: "approval-responded",
          toolCallId: "tool-1",
          type: "tool-modify_mail",
        },
      ],
      role: "assistant",
    };

    const validated = validateChatRequest(body);
    expect(validated.kind).toBe("continue");
    const continued = validated.kind === "continue" ? validated : undefined;
    expect(continued?.toolDecisions.get("tool-1")).toBeTruthy();
    expect(continued?.assistantMessageId).toBe("assistant-1");
  });

  test("rejects an assistant message without client resolutions", () => {
    const body = validBody();
    body.message = {
      id: "assistant-1",
      parts: [],
      role: "assistant",
    };

    expect(() => validateChatRequest(body)).toThrow(/no client resolutions/iu);
  });
});

describe("canonical transcript conversion", () => {
  test("keeps canonical text and tool parts from database rows", () => {
    expect(
      toCanonicalTranscript([
        {
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          id: "system-1",
          parts: [{ text: "hidden", type: "text" }],
          role: "system",
        },
        {
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          id: "user-1",
          parts: [{ text: "Question", type: "text" }],
          role: "user",
        },
        {
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          id: "assistant-1",
          parts: [
            { text: "Answer", type: "text" },
            { type: "step-start" },
            {
              input: { query: "is:unread" },
              output: { status: "success" },
              state: "output-available",
              toolCallId: "tool-1",
              type: "tool-search_gmail",
            },
            { secret: "not rendered", type: "provider-detail" },
            { type: "text" },
          ],
          role: "assistant",
        },
      ])
    ).toStrictEqual([
      {
        id: "user-1",
        parts: [{ text: "Question", type: "text" }],
        role: "user",
      },
      {
        id: "assistant-1",
        parts: [
          { text: "Answer", type: "text" },
          { type: "step-start" },
          {
            input: { query: "is:unread" },
            output: { status: "success" },
            state: "output-available",
            toolCallId: "tool-1",
            type: "tool-search_gmail",
          },
        ],
        role: "assistant",
      },
    ]);
  });

  test("drops messages whose parts are all malformed", () => {
    expect(
      toCanonicalTranscript([
        {
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          id: "assistant-empty",
          parts: [{ type: "unknown-shape" }, { mystery: true, type: "odd" }],
          role: "assistant",
        },
      ])
    ).toStrictEqual([]);
  });
});
