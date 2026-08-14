import type { aiMemory } from "@quieter/database/schema";
import { describe, expect, test } from "vite-plus/test";

import {
  calculateAiMemorySalience,
  getAiMemoryRetirementReason,
  rankAiMemoryCandidates,
} from "../src/ai-memory";

type Memory = typeof aiMemory.$inferSelect;
const memory = (overrides: Partial<Memory> = {}): Memory => ({
  archivedAt: null,
  confidence: 0.8,
  content: "Prefer concise replies",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  expiresAt: null,
  id: "memory-1",
  importance: 3,
  key: "reply-style",
  kind: "learned",
  lastConfirmedAt: new Date("2026-07-01T00:00:00Z"),
  lastUsedAt: null,
  mailboxId: null,
  metadata: { agents: ["all"], topics: ["replies", "concise"] },
  reinforcementCount: 1,
  scope: "user",
  scopeKey: "user:user-1",
  source: "explicit",
  sourceReference: null,
  status: "active",
  summary: "Concise replies",
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  userId: "user-1",
  version: 1,
  ...overrides,
});

describe("AI memory retrieval ranking", () => {
  test("filters memories by agent, expiration, and relevance", () => {
    const ranked = rankAiMemoryCandidates({
      agent: "chat",
      candidates: [
        memory(),
        memory({
          expiresAt: new Date("2026-07-31T00:00:00Z"),
          id: "expired",
          key: "expired",
        }),
        memory({
          id: "wrong-agent",
          key: "wrong-agent",
          metadata: { agents: ["auto_label"], topics: ["replies"] },
        }),
        memory({
          content: "Always label invoices as Receipts",
          id: "irrelevant",
          key: "invoice-label",
          metadata: { agents: ["auto_label"], topics: ["receipts"] },
        }),
      ],
      now: new Date("2026-08-04T00:00:00Z"),
      query: "Draft a concise reply",
    });

    expect(ranked.map((entry) => entry.memory.id)).toStrictEqual(["memory-1"]);
  });

  test("uses sender-domain evidence and favors a matching mailbox rule", () => {
    const ranked = rankAiMemoryCandidates({
      agent: "auto_label",
      candidates: [
        memory({
          content: "Prefer applying Receipts to newsletter mail",
          id: "personal",
          key: "personal-receipts",
          metadata: {
            agents: ["auto_label"],
            topics: ["newsletter", "receipts"],
          },
        }),
        memory({
          content: "Avoid applying Receipts to newsletters from store.example",
          id: "mailbox",
          key: "mailbox-receipts",
          mailboxId: "mailbox-1",
          metadata: {
            agents: ["auto_label"],
            sourceDomains: ["store.example"],
            topics: ["receipts"],
          },
          scope: "mailbox",
          scopeKey: "mailbox:mailbox-1",
          userId: null,
        }),
      ],
      now: new Date("2026-08-04T00:00:00Z"),
      query: "Newsletter from deals@store.example",
    });

    expect(ranked.map((entry) => entry.memory.id)).toStrictEqual([
      "mailbox",
      "personal",
    ]);
  });

  test("keeps explicit importance-five cross-agent constraints available without lexical overlap", () => {
    const ranked = rankAiMemoryCandidates({
      agent: "chat",
      candidates: [memory({ importance: 5 })],
      now: new Date("2026-08-04T00:00:00Z"),
      query: "What happened today?",
    });

    expect(ranked).toHaveLength(1);
  });

  test("recalls a semantically matched memory without lexical overlap", () => {
    const ranked = rankAiMemoryCandidates({
      agent: "compose",
      candidates: [
        memory({
          content: "Use a warm, informal tone with close collaborators",
          importance: 2,
        }),
      ],
      now: new Date("2026-08-04T00:00:00Z"),
      query: "Draft a note to my cofounder",
      semanticScores: new Map([["memory-1", 0.82]]),
    });

    expect(ranked.map(({ memory: candidate }) => candidate.id)).toStrictEqual([
      "memory-1",
    ]);
  });

  test("decays weak inferred knowledge and retires it conservatively", () => {
    const stale = memory({
      confidence: 0.5,
      lastConfirmedAt: new Date("2024-01-01T00:00:00Z"),
      source: "inferred",
    });
    const reinforced = memory({
      confidence: 0.5,
      lastConfirmedAt: new Date("2024-01-01T00:00:00Z"),
      reinforcementCount: 3,
      source: "inferred",
    });
    const now = new Date("2026-08-04T00:00:00Z");

    expect(calculateAiMemorySalience(stale, now)).toBeLessThan(
      calculateAiMemorySalience(memory(), now)
    );
    expect(getAiMemoryRetirementReason(stale, now)).toBe("stale_low_signal");
    expect(getAiMemoryRetirementReason(reinforced, now)).toBeNull();
  });
});
