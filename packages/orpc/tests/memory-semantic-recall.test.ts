import { describe, expect, test } from "vite-plus/test";

import { selectAiMemoryContext } from "../src/ai-memory-context";

const now = new Date();
const fact = {
  archivedAt: null,
  confidence: 1,
  content: "Always choose vegan meals when travelling.",
  createdAt: now,
  expiresAt: null,
  id: "diet",
  importance: 3,
  key: "diet",
  kind: "learned",
  lastConfirmedAt: now,
  lastUsedAt: null,
  mailboxId: null,
  metadata: { agents: ["all"], category: "preferences" },
  reinforcementCount: 1,
  scope: "user",
  scopeKey: "user:actor",
  source: "explicit",
  sourceReference: null,
  status: "active",
  summary: "Dietary preference",
  updatedAt: now,
  userId: "actor",
  version: 2,
} satisfies Parameters<typeof selectAiMemoryContext>[0]["candidates"][number];

const selection = {
  categories: ["writing_style"],
  characterBudget: 4000,
} satisfies NonNullable<
  Parameters<typeof selectAiMemoryContext>[0]["selection"]
>;

describe("hybrid recall selection authority", () => {
  test("a current semantic match can recover a fact outside category and lexical candidates", () => {
    const input = {
      agent: "compose",
      candidates: [fact],
      query: "Suggest plant-based dishes.",
      selection,
    };
    expect(selectAiMemoryContext(input).memory).toBeNull();
    expect(
      selectAiMemoryContext({
        ...input,
        semanticMatches: [{ id: fact.id, similarity: 0.9, version: 2 }],
      }).memory
    ).toContain(fact.content);
  });

  test("a match for an earlier fact version cannot make the edited fact relevant", () => {
    const context = selectAiMemoryContext({
      agent: "compose",
      candidates: [fact],
      query: "Suggest plant-based dishes.",
      selection,
      semanticMatches: [{ id: fact.id, similarity: 0.99, version: 1 }],
    });
    expect(context.memory).toBeNull();
  });

  test("semantic similarity cannot select another correspondent's writing style", () => {
    const recipient = {
      ...fact,
      content: "With Alex use a playful tone.",
      id: "recipient",
      key: "recipient",
      metadata: {
        agents: ["all"],
        category: "writing_style",
        correspondents: ["alex@example.test"],
      },
      summary: "Recipient voice",
    } satisfies Parameters<
      typeof selectAiMemoryContext
    >[0]["candidates"][number];
    const context = selectAiMemoryContext({
      agent: "compose",
      candidates: [recipient],
      query: "Reply to blair@example.test",
      semanticMatches: [{ id: recipient.id, similarity: 0.99, version: 2 }],
    });
    expect(context.memory).toBeNull();
  });
});
