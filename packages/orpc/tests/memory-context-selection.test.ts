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
  test("reserves general voice and matching recipient tone despite unrelated high volume", () => {
    const context = serializeAiAgentContext(
      selectAiMemoryContext({
        agent: "reply_suggestion",
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
  });

  test("resolves relationship references before knowing a person's address", () => {
    const context = serializeAiAgentContext(
      selectAiMemoryContext({
        agent: "search",
        candidates: [
          fact({
            content: "Alex is my husband.",
            id: "relationship",
            key: "husband",
            metadata: {
              agents: ["all"],
              category: "relationships",
              correspondents: ["alex@example.test"],
            },
            summary: "Alex's relationship",
          }),
        ],
        query: "emails from my husband",
      })
    );
    expect(context).toContain("husband");
    expect(context).toContain("alex@example.test");
  });

  test("preserves voice and preferences when many relationship facts apply", () => {
    const context = serializeAiAgentContext(
      selectAiMemoryContext({
        agent: "reply_suggestion",
        candidates: [
          fact(),
          fact({
            content: "Keep replies focused on the next concrete action.",
            id: "reply-preference",
            metadata: { agents: ["all"], category: "preferences" },
          }),
          ...Array.from({ length: 24 }, (_, index) =>
            fact({
              content: `Contact ${index} is a project collaborator. ${"They work together regularly. ".repeat(55)}`,
              id: `contact-${index}`,
              importance: 5,
              key: `contact-${index}`,
              metadata: {
                agents: ["all"],
                category: "relationships",
                correspondents: [`contact-${index}@example.test`],
              },
            })
          ),
        ],
        query: "Write a reply about the project",
      })
    );
    expect(context).toContain("warm replies");
    expect(context).toContain("next concrete action");
    expect(context).toContain("project collaborator");
  });

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

  test("keeps explicit instructions ahead of learned context when the budget fills", () => {
    const context = selectAiMemoryContext({
      agent: "auto_label",
      candidates: [
        ...Array.from({ length: 100 }, (_, index) =>
          fact({
            content: `Invoice habit ${index}. ${"Learned finance preference. ".repeat(60)}`,
            id: `fact-${index}`,
            key: `fact-${index}`,
            metadata: { agents: ["all"], category: "labeling" },
          })
        ),
        fact({
          content:
            "Keep invoices in Finance and never hide account-security mail.",
          id: "instruction",
          key: "instruction",
          kind: "instruction",
          metadata: { agents: ["all"], category: "labeling" },
          source: "explicit",
        }),
      ],
      query: "invoice",
    });
    expect(context.instructions).toContain("never hide account-security mail");
    expect(context.memory).toContain("additional matching memories");
  });
});
