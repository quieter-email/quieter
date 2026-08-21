import type { RouterOutputs } from "@quieter/orpc";
import type { MessagePart } from "@tanstack/ai";
import { describe, expect, test } from "vite-plus/test";

import {
  getAssistantProgress,
  getMessageText,
  toInitialMessages,
} from "./chat-messages";

type StoredMessage = RouterOutputs["chat"]["get"]["messages"][number];

describe("chat message conversion", () => {
  test("normalizes persisted messages and drops unsupported parts", () => {
    const storedMessage = {
      createdAt: new Date("2026-08-20T10:00:00.000Z"),
      error: null,
      id: "message-1",
      parts: [
        { content: "Hello", type: "text" },
        {
          approval: {
            id: "approval-tool-1",
            needsApproval: true,
          },
          arguments: '{"action":"archive"}',
          id: "tool-1",
          input: { action: "archive" },
          name: "modify_mail",
          state: "approval-requested",
          type: "tool-call",
        },
        { secret: "not rendered", type: "provider-detail" },
      ],
      position: 0,
      resume: null,
      role: "assistant",
      status: "complete",
    } satisfies StoredMessage;

    expect(toInitialMessages([storedMessage])).toStrictEqual([
      {
        createdAt: new Date("2026-08-20T10:00:00.000Z"),
        id: "message-1",
        parts: [
          { content: "Hello", type: "text" },
          {
            approval: {
              id: "approval-tool-1",
              needsApproval: true,
            },
            arguments: '{"action":"archive"}',
            id: "tool-1",
            input: { action: "archive" },
            name: "modify_mail",
            state: "approval-requested",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
    ]);
  });

  test("joins visible text without exposing thinking or tool data", () => {
    const parts: MessagePart[] = [
      { content: "First", type: "text" },
      { content: "private reasoning", type: "thinking" },
      { content: "Second", type: "text" },
    ];

    expect(getMessageText(parts)).toBe("First\n\nSecond");
  });

  test("collapses streaming work into one neutral status", () => {
    const toolPart: MessagePart = {
      arguments: "{}",
      id: "tool-1",
      name: "search_mail",
      state: "input-complete",
      type: "tool-call",
    };

    expect(getAssistantProgress([toolPart], true)).toBe(
      "Working with your mail…"
    );
    expect(getAssistantProgress([toolPart], false)).toBeNull();
    expect(getAssistantProgress([], true)).toBe("Thinking…");
    expect(
      getAssistantProgress(
        [toolPart, { content: "Here is what I found.", type: "text" }],
        true
      )
    ).toBeNull();
  });
});
