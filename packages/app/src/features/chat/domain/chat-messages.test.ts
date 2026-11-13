import { toCanonicalTranscript } from "@quieter/ai/chat-transcript";
import { getAssistantProgress } from "@quieter/app/features/chat/domain/chat-messages";
import { isChatToolPart } from "@quieter/app/features/chat/domain/chat-tools";
import type { UIMessage } from "ai";
import { describe, expect, test } from "vite-plus/test";

describe("chat message conversion", () => {
  test.each(["tool-memory", "tool-read_personal_context"])(
    "keeps internal context activity hidden after restoring %s from history",
    (type) => {
      const restored = toCanonicalTranscript([
        {
          id: "assistant",
          parts: [
            {
              input: {},
              output: { status: "success" },
              state: "output-available",
              toolCallId: "internal-context",
              type,
            },
          ],
          role: "assistant",
        },
      ]);
      const parts = restored.flatMap((message) => message.parts);
      expect(parts.filter(isChatToolPart)).toHaveLength(0);
    }
  );

  test("reloads interrupted actions as uncertain and preserves their history", () => {
    const messages = toCanonicalTranscript([
      {
        id: "user",
        parts: [{ text: "Move it to trash", type: "text" }],
        role: "user",
      },
      {
        id: "assistant",
        parts: [
          {
            approval: { approved: true, id: "approval" },
            input: { action: "trash" },
            state: "approval-responded",
            toolCallId: "trash",
            type: "tool-modify_mail",
          },
        ],
        role: "assistant",
      },
    ]);

    expect(messages[1]?.parts[0]).toMatchObject({
      input: { action: "trash" },
      state: "output-error",
    });
  });
});

describe("assistant progress", () => {
  test("keeps progress visible between commentary and the next response", () => {
    const parts: UIMessage["parts"] = [
      {
        state: "done",
        text: "I will check the remaining messages.",
        type: "text",
      },
    ];
    expect(getAssistantProgress(parts, true)).not.toBeNull();
    parts.push({ type: "step-start" });
    expect(getAssistantProgress(parts, true)).not.toBeNull();
    parts.push({
      state: "streaming",
      text: "Private reasoning",
      type: "reasoning",
    });
    expect(getAssistantProgress(parts, true)).not.toBeNull();
    parts.push({
      state: "streaming",
      text: "Here are the results",
      type: "text",
    });
    expect(getAssistantProgress(parts, true)).toBeNull();
    expect(getAssistantProgress(parts, false)).toBeNull();
  });

  test("reports hidden tool work while its details stay private", () => {
    const parts: UIMessage["parts"] = [
      { state: "done", text: "I will check.", type: "text" },
      {
        input: {},
        state: "input-available",
        toolCallId: "context",
        type: "tool-read_personal_context",
      },
    ];
    expect(getAssistantProgress(parts, true)).not.toBeNull();
    expect(parts.filter(isChatToolPart)).toHaveLength(0);
    expect(getAssistantProgress(parts, false)).toBeNull();
  });
});
