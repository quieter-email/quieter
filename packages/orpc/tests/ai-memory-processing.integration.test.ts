import type { planAiMemoryUpdate } from "@quieter/ai/ai-memory";
import type { reportAiUsage } from "@quieter/billing";
import type { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import {
  mailbox,
  member,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { processPendingAiMemoryEvents } from "../src/ai-memory";

const state = vi.hoisted(() => ({
  billed: vi.fn<typeof reportAiUsage>(),
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  entitlement: vi.fn<typeof hasUserBillingFeature>(),
  plan: vi.fn<typeof planAiMemoryUpdate>(),
}));

vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});
vi.mock(import("@quieter/ai/ai-memory"), async (original) => ({
  ...(await original()),
  planAiMemoryUpdate: state.plan,
}));
vi.mock(import("@quieter/billing/entitlements"), async (original) => ({
  ...(await original()),
  hasUserBillingFeature: state.entitlement,
}));
vi.mock(import("@quieter/billing"), async (original) => ({
  ...(await original()),
  reportAiUsage: state.billed,
}));

describe.skipIf(state.databaseUrl === undefined)(
  "memory processing fairness on PostgreSQL",
  () => {
    let actorIds: string[] = [];
    let mailboxIds: string[] = [];
    let organizationId = "";

    beforeAll(() => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Memory processing tests require a loopback test database."
        );
      }
    });

    beforeEach(async () => {
      vi.resetAllMocks();
      state.entitlement.mockResolvedValue({
        account: null,
        hasAccess: true,
        hasUnlimitedAccess: true,
        product: null,
      });
      state.plan.mockResolvedValue({
        answer: "Reviewed the observations.",
        operations: [],
        summary: "No durable facts to add.",
      });
      actorIds = [crypto.randomUUID(), crypto.randomUUID()];
      mailboxIds = actorIds.map(() => crypto.randomUUID());
      organizationId = crypto.randomUUID();
      const now = new Date();
      await db.insert(user).values(
        actorIds.map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Memory processing test",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Memory processing test",
        slug: organizationId,
      });
      await db.insert(member).values(
        actorIds.map((userId) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          organizationId,
          role: "member",
          userId,
        }))
      );
      await db.insert(mailbox).values(
        actorIds.map((ownerUserId, index) => ({
          createdAt: now,
          emailAddress: `${mailboxIds[index]}@example.test`,
          id: mailboxIds[index],
          organizationId,
          ownerUserId,
          provider: "gmail" as const,
          updatedAt: now,
        }))
      );
      await db.insert(userAiContextEvent).values(
        actorIds.flatMap((userId, index) =>
          Array.from({ length: index === 0 ? 12 : 1 }, () => ({
            createdAt: new Date(
              now.getTime() - (index === 0 ? 600_000 : 300_000)
            ),
            id: crypto.randomUUID(),
            kind: "mail_action" as const,
            mailboxId: mailboxIds[index],
            metadata: {
              bodyText: "A routine update with no lasting preference.",
              memoryScope: "user",
            },
            organizationId,
            updatedAt: new Date(
              now.getTime() - (index === 0 ? 600_000 : 300_000)
            ),
            userId,
          }))
        )
      );
    });

    afterEach(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, actorIds));
    });

    afterAll(async () => {
      await db.$client.end();
    });

    test("a busy user's old backlog does not prevent another user's observations from learning", async () => {
      await processPendingAiMemoryEvents({ allowLocal: true });
      const observations = await db
        .select({
          mergedAt: userAiContextEvent.mergedAt,
          userId: userAiContextEvent.userId,
        })
        .from(userAiContextEvent)
        .where(inArray(userAiContextEvent.userId, actorIds));
      for (const userId of actorIds) {
        expect(
          observations.some(
            (event) => event.userId === userId && event.mergedAt !== null
          )
        ).toBeTruthy();
      }
    });

    test("a user-specific drain leaves another user's observations untouched", async () => {
      await processPendingAiMemoryEvents({
        allowLocal: true,
        userId: actorIds[0],
      });
      const observations = await db
        .select({ mergedAt: userAiContextEvent.mergedAt })
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, actorIds[1]));
      expect(observations).toHaveLength(1);
      expect(observations[0].mergedAt).toBeNull();
    });

    test.each(["unavailable", "error"])(
      "another user still learns when one user's billing is %s",
      async (failure) => {
        // oxlint-disable-next-line eslint/require-await -- The async billing stub returns an in-memory fixture.
        state.entitlement.mockImplementation(async ({ userId }) => {
          if (userId === actorIds[0] && failure === "error") {
            throw new Error("Temporary billing lookup failure.");
          }
          return {
            account: null,
            hasAccess: userId !== actorIds[0],
            hasUnlimitedAccess: true,
            product: null,
          };
        });
        await processPendingAiMemoryEvents({ allowLocal: true });
        const observations = await db
          .select({
            mergedAt: userAiContextEvent.mergedAt,
            userId: userAiContextEvent.userId,
          })
          .from(userAiContextEvent)
          .where(inArray(userAiContextEvent.userId, actorIds));
        expect(
          observations.some(
            (event) => event.userId === actorIds[1] && event.mergedAt !== null
          )
        ).toBeTruthy();
        expect(
          observations
            .filter((event) => event.userId === actorIds[0])
            .every((event) => event.mergedAt === null)
        ).toBeTruthy();
      }
    );
  }
);
