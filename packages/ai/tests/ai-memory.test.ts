import { describe, expect, test } from "vite-plus/test";
import {
  AI_MEMORY_CONTENT_MAX_LENGTH,
  AI_MEMORY_REQUEST_MAX_LENGTH,
  buildAiMemoryEditorInput,
  sanitizeAiMemoryUpdatePlan,
  type AiMemoryUpdatePlan,
} from "../src/ai-memory";

describe("dynamic AI memory", () => {
  test("sanitizes model-proposed keys, tags, dates, and content", () => {
    const plan: AiMemoryUpdatePlan = {
      answer: "  Saved the instruction. ",
      operations: [
        {
          action: "add",
          agents: ["Chat Agent", "chat-agent"],
          confidence: 0.9,
          content: `  ${"Preference ".repeat(400)}  `,
          expiresAt: "not-a-date",
          importance: 4,
          kind: "instruction",
          key: " Reply Style / Concise ",
          summary: "  Prefers concise replies. ",
          targetId: null,
          topics: ["Reply Style", "reply-style"],
        },
      ],
      summary: "  Saved preference. ",
    };

    const result = sanitizeAiMemoryUpdatePlan(plan);

    expect(result.operations[0]).toMatchObject({
      agents: ["chat-agent"],
      confidence: 1,
      expiresAt: null,
      importance: 5,
      key: "reply-style-concise",
      summary: "Prefers concise replies.",
      topics: ["reply-style"],
    });
    expect(result.operations[0]?.content).toHaveLength(AI_MEMORY_CONTENT_MAX_LENGTH);
    expect(result.summary).toBe("Saved preference.");
    expect(result.answer).toBe("Saved the instruction.");
  });

  test("bounds untrusted editor inputs before model processing", () => {
    const input = buildAiMemoryEditorInput({
      currentMemories: Array.from({ length: 120 }, (_, index) => ({
        agents: ["all"],
        confidence: 1,
        content: "x".repeat(AI_MEMORY_CONTENT_MAX_LENGTH + 50),
        expiresAt: null,
        id: `memory-${index}`,
        importance: 3,
        kind: "learned" as const,
        key: `key-${index}`,
        status: "active" as const,
        summary: "Summary",
        topics: ["test"],
      })),
      request: "x".repeat(AI_MEMORY_REQUEST_MAX_LENGTH + 50),
      source: "explicit",
    });

    expect(input.currentMemories).toHaveLength(100);
    expect(input.currentMemories[0]?.content).toHaveLength(AI_MEMORY_CONTENT_MAX_LENGTH);
    expect(input.request).toHaveLength(AI_MEMORY_REQUEST_MAX_LENGTH);
  });
});
