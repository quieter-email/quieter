import type { planAiMemoryDeletion } from "@quieter/ai/ai-memory";
import type { reportAiUsage } from "@quieter/billing";
import type { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { aiMemory, aiMemoryChangeSet, user } from "@quieter/database/schema";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { learnAiMemoryFromChatMessage } from "../src/ai-memory";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  billed: vi.fn<typeof reportAiUsage>(),
  deleted: vi.fn<(condition: unknown) => Promise<void>>(),
  entitlement: vi.fn<typeof hasUserBillingFeature>(),
  inserted: vi.fn<() => void>(),
  plan: vi.fn<typeof planAiMemoryDeletion>(),
  rows: new Map<unknown, unknown[][]>(),
}));

vi.mock(import("@quieter/database/client"), async (original) => {
  const actual = await original();
  const fake = new Proxy(actual.db, {
    get(target, property, receiver): unknown {
      if (property === "select") {
        return () => ({
          from: (table: unknown) => {
            const query = {
              catch: async () =>
                await Promise.resolve(mocks.rows.get(table)?.shift() ?? []),
              for: () => query,
              orderBy: () => query,
              // oxlint-disable unicorn/no-thenable, promise/prefer-await-to-callbacks -- Mirrors an awaited Drizzle query.
              async then(resolve: (rows: unknown[]) => unknown) {
                return await resolve(
                  await Promise.resolve(mocks.rows.get(table)?.shift() ?? [])
                );
              },
              // oxlint-enable unicorn/no-thenable, promise/prefer-await-to-callbacks
              where: () => query,
            };
            return query;
          },
        });
      }
      if (property === "transaction") {
        // oxlint-disable promise/prefer-await-to-callbacks -- Mirrors Drizzle's transaction callback API.
        return async (
          callback: (transaction: typeof actual.db) => Promise<unknown>
        ) => await callback(fake);
        // oxlint-enable promise/prefer-await-to-callbacks
      }
      if (property === "delete") {
        return () => ({ where: mocks.deleted });
      }
      if (property === "insert") {
        return (table: unknown) => ({
          values: () => {
            if (table === aiMemoryChangeSet) {
              mocks.inserted();
            }
            return { onConflictDoUpdate: async () => {} };
          },
        });
      }
      if (property === "update") {
        return () => ({ set: () => ({ where: async () => {} }) });
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...actual, db: fake };
});
vi.mock(import("@quieter/ai/ai-memory"), async (original) => ({
  ...(await original()),
  planAiMemoryDeletion: mocks.plan,
}));
vi.mock(import("@quieter/billing/entitlements"), async (original) => ({
  ...(await original()),
  hasUserBillingFeature: mocks.entitlement,
}));
vi.mock(import("@quieter/billing"), async (original) => ({
  ...(await original()),
  reportAiUsage: mocks.billed,
}));
vi.mock(import("../src/mailbox/service"), async (original) => ({
  ...(await original()),
  assertAccessibleMailbox: mocks.access,
}));

const storedSecret = {
  archivedAt: null,
  confidence: 1,
  content: "Verification code 123456",
  createdAt: new Date(),
  embeddedAt: null,
  embedding: null,
  expiresAt: null,
  id: "saved-code",
  importance: 3,
  key: "verification-code",
  kind: "learned",
  lastConfirmedAt: new Date(),
  lastUsedAt: null,
  mailboxId: null,
  metadata: {},
  reinforcementCount: 1,
  scope: "user",
  scopeKey: "user:owner",
  source: "explicit",
  sourceReference: null,
  status: "archived",
  summary: "Verification code 123456",
  updatedAt: new Date(),
  userId: "owner",
  version: 1,
} satisfies typeof aiMemory.$inferSelect;

const request = {
  bodyText: "Forget my verification code 123456.",
  mailboxId: "mailbox",
  messageId: "message",
  userId: "owner",
};

describe("sensitive chat memory erasure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.clear();
    mocks.rows.set(aiMemory, [[storedSecret], [storedSecret]]);
    mocks.rows.set(user, [[{ id: "owner" }]]);
    mocks.rows.set(aiMemoryChangeSet, [[]]);
    mocks.plan.mockResolvedValue([storedSecret.id]);
    mocks.entitlement.mockResolvedValue({
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: null,
    });
    mocks.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: "mailbox",
      organizationId: "team",
      provider: "gmail",
    });
  });

  test("erases archived memory without journaling the secret-bearing message", async () => {
    await expect(learnAiMemoryFromChatMessage(request)).resolves.toMatchObject({
      status: "refreshed",
    });

    expect(mocks.deleted).toHaveBeenCalledWith(expect.anything());
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  test("rejects a changed target and a target removed by a concurrent reset", async () => {
    mocks.rows.set(aiMemory, [
      [storedSecret],
      [{ ...storedSecret, version: 2 }],
    ]);
    await expect(learnAiMemoryFromChatMessage(request)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    mocks.rows.set(aiMemory, [[storedSecret], []]);
    await expect(learnAiMemoryFromChatMessage(request)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(mocks.deleted).not.toHaveBeenCalled();
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  test("ignores foreign target IDs even if the deletion planner proposes them", async () => {
    mocks.plan.mockResolvedValue(["other-users-memory"]);
    await expect(learnAiMemoryFromChatMessage(request)).resolves.toMatchObject({
      status: "skipped",
    });

    expect(mocks.deleted).not.toHaveBeenCalled();
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  test("secret questions with no forgetting intent neither mutate nor enter the learning ledger", async () => {
    mocks.plan.mockResolvedValue([]);
    await expect(
      learnAiMemoryFromChatMessage({
        ...request,
        bodyText: "What is my verification code 123456 used for?",
      })
    ).resolves.toMatchObject({ status: "skipped" });

    expect(mocks.deleted).not.toHaveBeenCalled();
    expect(mocks.inserted).not.toHaveBeenCalled();
  });
});
