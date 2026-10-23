import { db } from "@quieter/database/client";
import {
  aiMemoryMailboxState,
  mailbox,
  organization,
  user,
} from "@quieter/database/schema";
import type { reportError } from "@quieter/observability";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { completeOnboarding } from "../src/onboarding/service";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  failingMailboxId: "",
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
vi.mock(import("../src/ai-memory-capture"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    queueMailboxMemoryBootstrap: async (input: {
      mailboxId: string;
      userId: string;
    }) => {
      if (input.mailboxId === state.failingMailboxId) {
        throw new Error("Fixture memory queue unavailable.");
      }
      await actual.queueMailboxMemoryBootstrap(input);
    },
  };
});
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: vi.fn<typeof reportError>(),
}));

describe.skipIf(state.databaseUrl === undefined)(
  "onboarding memory isolation",
  () => {
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const failingMailboxId = crypto.randomUUID();
    const workingMailboxId = crypto.randomUUID();
    const staleMailboxId = crypto.randomUUID();

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Onboarding integration requires loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.test`,
        emailVerified: true,
        id: userId,
        name: "Before onboarding",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Onboarding fixture",
        slug: organizationId,
      });
      await db.insert(mailbox).values(
        [failingMailboxId, workingMailboxId, staleMailboxId].map((id) => ({
          accessMode: "private" as const,
          createdAt: now,
          emailAddress: `${id}@example.test`,
          id,
          managedOwnerUserId: id === staleMailboxId ? userId : null,
          organizationId,
          ownerUserId: id === staleMailboxId ? null : userId,
          provider:
            id === staleMailboxId ? ("managed" as const) : ("gmail" as const),
          updatedAt: now,
        }))
      );
      state.failingMailboxId = failingMailboxId;
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await db.$client.end();
    });

    test("finishes onboarding and queues other inboxes after one learning queue fails", async () => {
      await expect(
        completeOnboarding({ name: "Test reader", userId })
      ).resolves.toBeUndefined();
      const [saved] = await db.select().from(user).where(eq(user.id, userId));
      expect(saved?.onboardingCompletedAt).toBeInstanceOf(Date);
      expect(saved?.termsAcceptedAt).toBeInstanceOf(Date);
      const queued = await db
        .select()
        .from(aiMemoryMailboxState)
        .where(
          inArray(aiMemoryMailboxState.mailboxId, [
            workingMailboxId,
            staleMailboxId,
          ])
        );
      expect(queued.map((item) => item.mailboxId)).toContain(workingMailboxId);
      expect(queued.map((item) => item.mailboxId)).not.toContain(
        staleMailboxId
      );
    });
  }
);
