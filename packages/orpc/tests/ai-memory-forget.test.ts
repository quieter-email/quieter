import { ORPCError } from "@orpc/server";
import type {
  planAiMemoryDeletion,
  planAiMemoryUpdate,
} from "@quieter/ai/ai-memory";
import type { reportAiUsage } from "@quieter/billing";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import type { hasUserBillingFeature } from "@quieter/billing/entitlements";
import {
  aiMemory,
  aiMemoryChangeSet,
  mailboxAiAuthority,
  mailAutoLabelFeedback,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { AiOrigin } from "../src/ai-authority";
import {
  learnAiMemoryFromChatMessage,
  refreshAiMemoryFromEvent,
} from "../src/ai-memory";
import type { assertAgentMailboxAccess } from "../src/mail-agent/access";
import { refreshAutoLabelMemoryProfile } from "../src/mail-automation/memory";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  authorityAccess: vi.fn<typeof assertAgentMailboxAccess>(),
  billed: vi.fn<typeof reportAiUsage>(),
  consolidate: vi.fn<typeof planAiMemoryUpdate>(),
  deleted: vi.fn<(condition: unknown) => Promise<void>>(),
  entitlement: vi.fn<typeof hasUserBillingFeature>(),
  inserted: vi.fn<() => void>(),
  plan: vi.fn<typeof planAiMemoryDeletion>(),
  readEffect: vi.fn<(table: unknown) => void>(),
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
              groupBy: () => query,
              limit: () => query,
              orderBy: () => query,
              // oxlint-disable unicorn/no-thenable, promise/prefer-await-to-callbacks -- Mirrors an awaited Drizzle query.
              async then(resolve: (rows: unknown[]) => unknown) {
                mocks.readEffect(table);
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
            if (table === aiMemoryChangeSet || table === aiMemory) {
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
  planAiMemoryUpdate: mocks.consolidate,
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

vi.mock(import("../src/mail-agent/access"), () => ({
  assertAgentMailboxAccess: mocks.authorityAccess,
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

const origin = {
  kind: "ai",
  mailboxId: "mailbox",
  mode: "interactive",
  policyVersion: 0,
  userId: "owner",
} satisfies AiOrigin;

const request = {
  bodyText: "Forget my verification code 123456.",
  mailboxId: "mailbox",
  messageId: "message",
  origin,
  userId: "owner",
};

describe("sensitive chat memory erasure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.clear();
    mocks.readEffect.mockReset();
    mocks.authorityAccess.mockResolvedValue({
      canSaveDraft: true,
      memberId: "fixture-member",
      organizationId: "team",
      provider: "gmail",
      shared: false,
    });
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

  test("a read-only change while memory deletion is being planned prevents erasure", async () => {
    mocks.plan.mockImplementationOnce(async () => {
      mocks.rows.set(mailboxAiAuthority, [
        [{ automationPaused: false, readOnly: true, version: 1 }],
      ]);
      return await Promise.resolve([storedSecret.id]);
    });

    await expect(learnAiMemoryFromChatMessage(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.deleted).not.toHaveBeenCalled();
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  test("revoked inbox access during planning prevents erasure of private memory", async () => {
    let revoked = false;
    mocks.authorityAccess.mockImplementation(async () => {
      if (revoked) {
        throw new ORPCError("NOT_FOUND", { message: "Inbox unavailable." });
      }
      return await Promise.resolve({
        canSaveDraft: true,
        memberId: "fixture-member",
        organizationId: "team",
        provider: "gmail",
        shared: false,
      });
    });
    mocks.plan.mockImplementationOnce(async () => {
      revoked = true;
      return await Promise.resolve([storedSecret.id]);
    });

    await expect(learnAiMemoryFromChatMessage(request)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.deleted).not.toHaveBeenCalled();
  });

  test.each([
    {},
    { aiAuthorityMode: "automation", aiAuthorityVersion: 0 },
    { aiAuthorityMode: "automation", aiAuthorityVersion: "current" },
  ])(
    "queued learning cannot regain authority after a policy change %#",
    async (metadata) => {
      mocks.rows.set(userAiContextEvent, [
        [
          {
            id: "observation",
            kind: "chat_discovery",
            mailboxId: "mailbox",
            mergedAt: null,
            metadata: { memoryScope: "user", ...metadata },
            skippedAt: null,
            userId: "owner",
          },
        ],
      ]);
      mocks.rows.set(mailboxAiAuthority, [
        [{ automationPaused: false, readOnly: false, version: 2 }],
      ]);

      await expect(
        refreshAiMemoryFromEvent({ eventId: "observation" })
      ).resolves.toMatchObject({ status: "skipped" });
      expect(mocks.consolidate).not.toHaveBeenCalled();
      expect(mocks.inserted).not.toHaveBeenCalled();
      expect(mocks.deleted).not.toHaveBeenCalled();
    }
  );

  test("profile preparation cannot recapture authority after a pause and resume", async () => {
    let currentVersion = 0;
    mocks.readEffect.mockImplementation((table) => {
      if (table === mailAutoLabelFeedback) {
        currentVersion = 2;
      }
      if (table === mailboxAiAuthority) {
        mocks.rows.set(table, [
          [
            {
              automationPaused: false,
              readOnly: false,
              version: currentVersion,
            },
          ],
        ]);
      }
    });
    mocks.rows.set(mailAutoLabelFeedback, [
      [
        {
          added: 3,
          labelId: "work",
          labelName: "Work",
          removed: 0,
          source: "team@example.test",
        },
      ],
    ]);
    mocks.rows.set(aiMemory, [[], []]);

    await expect(
      refreshAutoLabelMemoryProfile("mailbox", "owner", 0)
    ).resolves.toBeUndefined();
    expect(mocks.inserted).not.toHaveBeenCalled();
    expect(mocks.deleted).not.toHaveBeenCalled();
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

vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  createMailboxAiBillingContext: vi
    .fn<typeof createMailboxAiBillingContext>()
    .mockResolvedValue({
      account: null,
      admittedAt: new Date(),
      groupId: "fixture",
      kind: "team",
      organizationId: "test-team",
      usageKind: "aiChat",
    }),
}));
