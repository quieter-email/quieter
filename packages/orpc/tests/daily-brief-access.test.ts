import { ORPCError } from "@orpc/server";
import type { DatabaseClient } from "@quieter/database/client";
import type { aiMemory } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type {
  loadAiAgentContext,
  loadAiAgentMemoryCandidates,
} from "../src/ai-memory";
import {
  configureDailyBrief,
  dailyBriefInputs,
  getDailyBrief,
  giveDailyBriefFeedback,
  loadDailyBriefMemoryContext,
  refreshDailyBrief,
} from "../src/daily-brief";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  candidates: vi.fn<typeof loadAiAgentMemoryCandidates>(),
  memoryContext: vi.fn<typeof loadAiAgentContext>(),
  select: vi.fn<DatabaseClient["select"]>(),
  update: vi.fn<DatabaseClient["update"]>(),
}));
vi.mock(import("../src/ai-memory"), async (original) => ({
  ...(await original()),
  loadAiAgentContext: mocks.memoryContext,
  loadAiAgentMemoryCandidates: mocks.candidates,
}));
vi.mock(import("../src/mailbox/service"), async (original) => ({
  ...(await original()),
  assertAccessibleMailbox: mocks.access,
}));
vi.mock(import("@quieter/database/client"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property, receiver): unknown {
        if (property === "select") {
          return mocks.select;
        }
        if (property === "update") {
          return mocks.update;
        }
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});

const context = { userId: "reader" };
const input = { mailboxId: "inaccessible-mailbox" };

type Memory = typeof aiMemory.$inferSelect;
const memory = (overrides: Partial<Memory>): Memory => ({
  archivedAt: null,
  confidence: 1,
  content: "Prefer concise summaries",
  createdAt: new Date(),
  embeddedAt: null,
  embedding: null,
  expiresAt: null,
  id: "personal-instruction",
  importance: 5,
  key: "brief-style",
  kind: "instruction",
  lastConfirmedAt: new Date(),
  lastUsedAt: null,
  mailboxId: null,
  metadata: { agents: ["all"] },
  reinforcementCount: 1,
  scope: "user",
  scopeKey: "user:reader",
  source: "explicit",
  sourceReference: null,
  status: "active",
  summary: "Concise summaries",
  updatedAt: new Date(),
  userId: "reader",
  version: 1,
  ...overrides,
});

describe("Daily Brief authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
  });

  test("revalidates access before every read, refresh, configuration, or feedback operation", async () => {
    await expect(getDailyBrief({ context, input })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(refreshDailyBrief({ context, input })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      configureDailyBrief({
        context,
        input: {
          ...input,
          enabled: true,
          localTime: "06:00",
          scheduleEnabled: false,
          timeZone: "Europe/Berlin",
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      giveDailyBriefFeedback({
        context,
        input: { ...input, action: "dismiss", itemId: "item" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("rejects client-supplied identities, model choices, and generated content", () => {
    for (const extra of [
      { userId: "other" },
      { model: "other" },
      { items: [] },
    ]) {
      expect(
        dailyBriefInputs.refresh.safeParse({ ...input, ...extra }).success
      ).toBeFalsy();
    }
  });

  test("includes written personal instructions without using learned personal or other-mailbox context", async () => {
    mocks.candidates.mockResolvedValue([
      memory({}),
      memory({ id: "personal-learned", kind: "learned" }),
      memory({
        id: "mailbox-learned",
        kind: "learned",
        mailboxId: "current",
        scope: "mailbox",
        scopeKey: "mailbox:current",
        userId: null,
      }),
      memory({
        id: "other-mailbox",
        mailboxId: "other",
        scope: "mailbox",
        scopeKey: "mailbox:other",
        userId: null,
      }),
      memory({ id: "other-user", scopeKey: "user:other", userId: "other" }),
    ]);
    mocks.memoryContext.mockResolvedValue({
      instructions: "Prefer concise summaries",
      memory: null,
    });
    await loadDailyBriefMemoryContext({
      mailboxId: "current",
      query: "Review mail",
      userId: "reader",
    });
    const supplied = mocks.memoryContext.mock.calls[0]?.[0].candidates ?? [];
    expect(supplied).toContainEqual(
      expect.objectContaining({ id: "personal-instruction" })
    );
    expect(supplied).toContainEqual(
      expect.objectContaining({ id: "mailbox-learned" })
    );
    expect(
      supplied.some((candidate) =>
        ["personal-learned", "other-mailbox", "other-user"].includes(
          candidate.id
        )
      )
    ).toBeFalsy();
  });
});
