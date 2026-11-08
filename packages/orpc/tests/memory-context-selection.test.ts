import type { aiMemory } from "@quieter/database/schema";
import { describe, expect, test } from "vite-plus/test";

import {
  selectAiMemoryContext,
  serializeAiAgentContext,
} from "../src/ai-memory-context";

type Memory = typeof aiMemory.$inferSelect;
const now = new Date();
const fact = (overrides: Partial<Memory> = {}): Memory => ({
  archivedAt: null,
  confidence: 0.9,
  content: "Uses concise, warm replies with natural contractions.",
  createdAt: now,
  embeddedAt: null,
  embedding: null,
  expiresAt: null,
  id: "voice",
  importance: 4,
  key: "voice",
  kind: "learned",
  lastConfirmedAt: now,
  lastUsedAt: null,
  mailboxId: null,
  metadata: { agents: ["all"], category: "writing_style", correspondents: [] },
  reinforcementCount: 2,
  scope: "user",
  scopeKey: "user:reader",
  source: "inferred",
  sourceReference: null,
  status: "active",
  summary: "Writing voice",
  updatedAt: now,
  userId: "reader",
  version: 1,
  ...overrides,
});

describe("task-specific text memory", () => {
  test.each(["reply_suggestion", "mail_action"])(
    "reserves general voice and matching recipient tone despite unrelated high volume (%s)",
    (agent) => {
      const context = serializeAiAgentContext(
        selectAiMemoryContext({
          agent,
          candidates: [
            ...Array.from({ length: 300 }, (_, index) =>
              fact({
                content: `Working on project ${index}. ${"Current work detail. ".repeat(60)}`,
                id: `activity-${index}`,
                importance: 5,
                key: `activity-${index}`,
                metadata: { agents: ["all"], category: "activity" },
              })
            ),
            fact(),
            fact({
              content:
                "With Alex, use playful language and sign off with See you.",
              id: "alex",
              key: "alex-voice",
              metadata: {
                agents: ["all"],
                category: "writing_style",
                correspondents: ["alex@example.test"],
              },
            }),
            fact({
              content: "With Blair, use formal greetings and full titles.",
              id: "blair",
              key: "blair-voice",
              metadata: {
                agents: ["all"],
                category: "writing_style",
                correspondents: ["blair@example.test"],
              },
            }),
          ],
          query: "Reply to Alex <alex@example.test> about lunch",
        })
      );
      expect(context).toContain("warm replies");
      expect(context).toContain("playful language");
      expect(context).not.toContain("full titles");
    }
  );

  test("excludes expired, archived, wrong-agent and secret-bearing records", () => {
    const selected = selectAiMemoryContext({
      agent: "compose",
      candidates: [
        fact(),
        fact({
          content: "obsolete detail",
          expiresAt: new Date(now.getTime() - 1000),
          id: "expired",
        }),
        fact({
          content: "archived detail",
          id: "archived",
          status: "archived",
        }),
        fact({
          content: "label-only detail",
          id: "label-only",
          metadata: { agents: ["auto_label"], category: "labeling" },
        }),
        fact({ content: "verification code is 123456", id: "secret" }),
      ],
      query: "write a reply",
    });
    const context = serializeAiAgentContext(selected);
    expect(context).toContain("warm replies");
    expect(context).not.toMatch(
      /obsolete detail|archived detail|label-only detail|123456/u
    );
  });
});
