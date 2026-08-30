import type { ChatMessagePart } from "@quieter/database/schema";
import type { UIMessage } from "ai";
import { describe, expect, test } from "vite-plus/test";

import {
  getAssistantProgress,
  getChatRetryAction,
  getMessageText,
  toInitialMessages,
} from "./chat-messages";

type StoredMessage = {
  createdAt: Date;
  id: string;
  parts: ChatMessagePart[];
  position: number;
  role: "assistant" | "system" | "user";
};

describe("chat message conversion", () => {
  test("projects persisted rows onto UI messages and skips system rows", () => {
    const storedMessage: StoredMessage = {
      createdAt: new Date("2026-08-20T10:00:00.000Z"),
      id: "message-1",
      parts: [
        { text: "Hello", type: "text" },
        {
          input: { action: "archive" },
          output: { status: "success" },
          state: "output-available",
          toolCallId: "tool-1",
          type: "tool-modify_mail",
        },
        { secret: "not rendered", type: "provider-detail" },
      ],
      position: 0,
      role: "assistant",
    };

    expect(toInitialMessages([storedMessage])).toStrictEqual([
      {
        id: "message-1",
        parts: storedMessage.parts,
        role: "assistant",
      },
    ]);

    expect(
      toInitialMessages([
        {
          ...storedMessage,
          id: "system-1",
          role: "system",
        },
      ])
    ).toStrictEqual([]);
  });

  test("joins visible text without exposing other part types", () => {
    const parts: UIMessage["parts"] = [
      { text: "First", type: "text" },
      { text: "Reasoning", type: "reasoning" },
      { text: "Second", type: "text" },
    ];

    expect(getMessageText(parts)).toBe("First\n\nSecond");
  });

  test("collapses streaming work into one neutral status", () => {
    const toolPart: UIMessage["parts"][number] = {
      input: {},
      state: "input-available",
      toolCallId: "tool-1",
      type: "tool-search_gmail",
    };

    expect(getAssistantProgress([toolPart], true)).toBe(
      "Working with your mail…"
    );
    expect(getAssistantProgress([toolPart], false)).toBeNull();
    expect(getAssistantProgress([], true)).toBe("Thinking…");
    expect(
      getAssistantProgress(
        [toolPart, { text: "Here is what I found.", type: "text" }],
        true
      )
    ).toBeNull();
  });

  test("recovers each retry state without duplicating a persisted user turn", () => {
    const userMessage: UIMessage = {
      id: "user-1",
      parts: [{ text: "Try this", type: "text" }],
      role: "user",
    };
    const oldAssistant: UIMessage = {
      id: "assistant-old",
      parts: [{ text: "Old answer", type: "text" }],
      role: "assistant",
    };
    const newAssistant: UIMessage = {
      id: "assistant-new",
      parts: [{ text: "New answer", type: "text" }],
      role: "assistant",
    };

    expect(getChatRetryAction([userMessage], [])).toStrictEqual({
      messageId: "user-1",
      text: "Try this",
      type: "resubmit-user",
    });
    expect(getChatRetryAction([userMessage], [userMessage])).toStrictEqual({
      type: "regenerate",
    });
    expect(
      getChatRetryAction(
        [userMessage, newAssistant],
        [userMessage, newAssistant]
      )
    ).toStrictEqual({ type: "hydrate" });
    expect(
      getChatRetryAction(
        [userMessage, newAssistant],
        [userMessage, oldAssistant]
      )
    ).toStrictEqual({ type: "regenerate" });
  });
});
