import { toCanonicalTranscript } from "@quieter/ai/chat-transcript";
import { isChatToolPart } from "@quieter/app/features/chat/domain/chat-tools";
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
        parts: [{ text: "Archive it", type: "text" }],
        role: "user",
      },
      {
        id: "assistant",
        parts: [
          {
            approval: { approved: true, id: "approval" },
            input: { action: "archive" },
            state: "approval-responded",
            toolCallId: "archive",
            type: "tool-modify_mail",
          },
        ],
        role: "assistant",
      },
    ]);

    expect(messages[1]?.parts[0]).toMatchObject({
      input: { action: "archive" },
      state: "output-error",
    });
  });
});
