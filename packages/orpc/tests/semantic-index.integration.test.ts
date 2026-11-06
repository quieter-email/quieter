import { ORPCError } from "@orpc/server";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import {
  mailbox,
  organization,
  semanticIndexRequest,
  user,
} from "@quieter/database/schema";
import type { reportError } from "@quieter/observability";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  processPendingSemanticIndexes,
  requestSemanticIndex,
  requestFullMailSemanticIndex,
} from "../src/semantic-index";
import { advanceSemanticMailImport } from "../src/semantic-mail-import";
import { indexSemanticSources } from "../src/semantic-search";

const state = vi.hoisted<{
  databaseUrl: string | undefined;
  deployment: "local" | "production";
}>(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  deployment: "production",
}));

vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      get QUIETER_DEPLOYMENT_ENV() {
        return state.deployment;
      },
    },
  };
});
vi.mock(import("sst"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    Resource: new Proxy(actual.Resource, {
      get() {
        throw new Error("Linked resources are disabled in synthetic tests.");
      },
    }),
  };
});
vi.mock(import("../src/semantic-search"), () => ({
  indexSemanticSources: vi.fn<typeof indexSemanticSources>(),
}));
vi.mock(import("../src/semantic-mail-import"), () => ({
  advanceSemanticMailImport: vi.fn<typeof advanceSemanticMailImport>(),
}));
vi.mock(import("@quieter/billing/ai-reservation"), async (original) => ({
  ...(await original()),
  createMailboxAiBillingContext: vi.fn<typeof createMailboxAiBillingContext>(),
}));
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: vi.fn<typeof reportError>(),
}));

describe.skipIf(state.databaseUrl === undefined)(
  "durable search preparation",
  () => {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const otherMailboxId = crypto.randomUUID();
    const scope = { kind: "chat" as const, mailboxId, userId };
    let fixturesMayExist = false;

    beforeAll(async () => {
      const target = new URL(state.databaseUrl ?? "");
      if (
        !["postgres:", "postgresql:"].includes(target.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
        target.pathname !== "/quieter_migration_test" ||
        target.search ||
        target.hash
      ) {
        throw new Error(
          "Tests require disposable loopback quieter_migration_test."
        );
      }
      await db.execute(sql`select 1 from ${semanticIndexRequest} limit 1`);
      fixturesMayExist = true;
      const now = new Date();
      await db.insert(user).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Synthetic search owner",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Synthetic search preparation",
        slug: organizationId,
      });
      await db.insert(mailbox).values(
        [
          { id: mailboxId, ownerUserId: userId },
          { id: otherMailboxId, ownerUserId: otherUserId },
        ].map((entry) => ({
          ...entry,
          accessMode: "private" as const,
          createdAt: now,
          emailAddress: `${entry.id}@example.test`,
          organizationId,
          provider: "gmail" as const,
          updatedAt: now,
        }))
      );
    });

    beforeEach(async () => {
      if (fixturesMayExist) {
        await db
          .delete(semanticIndexRequest)
          .where(inArray(semanticIndexRequest.userId, [userId, otherUserId]));
        await db
          .update(mailbox)
          .set({ ownerUserId: userId })
          .where(eq(mailbox.id, mailboxId));
      }
      state.deployment = "production";
      vi.mocked(createMailboxAiBillingContext).mockReset();
      vi.mocked(createMailboxAiBillingContext).mockResolvedValue({
        account: null,
        admittedAt: new Date(),
        groupId: "synthetic-full-import",
        kind: "team",
        organizationId,
        usageKind: "aiMemory",
      });
      vi.mocked(advanceSemanticMailImport).mockReset();
      vi.mocked(advanceSemanticMailImport).mockResolvedValue({
        complete: true,
        pageToken: null,
        pendingIds: [],
      });
      vi.mocked(indexSemanticSources).mockReset();
      vi.mocked(indexSemanticSources).mockResolvedValue({
        complete: true,
        indexedSources: 1,
        totalSources: 1,
      });
    });

    afterAll(async () => {
      if (fixturesMayExist) {
        await db
          .delete(organization)
          .where(eq(organization.id, organizationId));
        await db.delete(user).where(inArray(user.id, [userId, otherUserId]));
      }
    });

    test("an inaccessible mailbox cannot register paid background work", async () => {
      await expect(
        requestSemanticIndex({ ...scope, mailboxId: otherMailboxId })
      ).rejects.toBeInstanceOf(ORPCError);
      await expect(
        db
          .select()
          .from(semanticIndexRequest)
          .where(eq(semanticIndexRequest.userId, userId))
      ).resolves.toHaveLength(0);
      expect(indexSemanticSources).not.toHaveBeenCalled();
    });

    test("repeated requests preserve an active lease and retry backoff", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      const leaseToken = crypto.randomUUID();
      const later = new Date(Date.now() + 600_000);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: later, leaseExpiresAt: later, leaseToken })
        .where(eq(semanticIndexRequest.userId, userId));
      await requestSemanticIndex(scope);
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 0,
      });
      const [pending] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(pending).toMatchObject({ leaseToken });
      expect(indexSemanticSources).not.toHaveBeenCalled();
    });

    test("concurrent workers charge only one indexing batch for a claimed request", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      vi.mocked(indexSemanticSources).mockImplementation(async () => {
        started.resolve(true);
        await release.promise;
        return { complete: true, indexedSources: 2, totalSources: 2 };
      });
      const first = processPendingSemanticIndexes();
      await started.promise;
      try {
        await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
          processed: 0,
        });
        expect(indexSemanticSources).toHaveBeenCalledOnce();
      } finally {
        release.resolve(true);
      }
      await expect(first).resolves.toMatchObject({ processed: 1 });
      const [completed] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(completed).toMatchObject({
        indexedSources: 2,
        lastError: null,
        leaseToken: null,
        totalSources: 2,
      });
      expect(completed?.completedAt).toBeInstanceOf(Date);
    });

    test("a timed-out owner cannot complete a reclaimed request", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      vi.mocked(indexSemanticSources).mockImplementation(async () => {
        started.resolve(true);
        await release.promise;
        return { complete: true, indexedSources: 2, totalSources: 2 };
      });
      const running = processPendingSemanticIndexes();
      await started.promise;
      const replacementToken = crypto.randomUUID();
      try {
        await db
          .update(semanticIndexRequest)
          .set({
            leaseExpiresAt: new Date(Date.now() + 120_000),
            leaseToken: replacementToken,
          })
          .where(eq(semanticIndexRequest.userId, userId));
      } finally {
        release.resolve(true);
      }
      await expect(running).resolves.toMatchObject({ processed: 0 });
      const [pending] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(pending).toMatchObject({
        completedAt: null,
        leaseToken: replacementToken,
      });
    });

    test("an expired lease cannot publish completion", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      vi.mocked(indexSemanticSources).mockImplementation(async () => {
        started.resolve(true);
        await release.promise;
        return { complete: true, indexedSources: 2, totalSources: 2 };
      });
      const running = processPendingSemanticIndexes();
      await started.promise;
      try {
        await db
          .update(semanticIndexRequest)
          .set({ leaseExpiresAt: new Date(0) })
          .where(eq(semanticIndexRequest.userId, userId));
      } finally {
        release.resolve(true);
      }
      await expect(running).resolves.toMatchObject({ processed: 0 });
      const [pending] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(pending).toMatchObject({ completedAt: null, indexedSources: 0 });
    });

    test("expired requests recover and partial preparation stays eligible", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      await db
        .update(semanticIndexRequest)
        .set({ leaseExpiresAt: new Date(0), leaseToken: crypto.randomUUID() })
        .where(eq(semanticIndexRequest.userId, userId));
      vi.mocked(indexSemanticSources).mockResolvedValue({
        complete: false,
        indexedSources: 1,
        totalSources: 3,
      });
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 1,
      });
      vi.mocked(indexSemanticSources).mockResolvedValue({
        complete: true,
        indexedSources: 3,
        totalSources: 3,
      });
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 1,
      });
      const [completed] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(completed).toMatchObject({
        indexedSources: 3,
        leaseToken: null,
        totalSources: 3,
      });
      expect(completed?.completedAt).toBeInstanceOf(Date);
    });

    test("usage admission failures retry without leaking private diagnostics", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      vi.mocked(indexSemanticSources).mockRejectedValue(
        new ORPCError("FORBIDDEN", { message: "private-provider-diagnostic" })
      );
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        failed: 1,
      });
      const [pending] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(pending).toMatchObject({ attemptCount: 1, leaseToken: null });
      expect(pending?.lastError).not.toContain("private-provider-diagnostic");
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 0,
      });
    });

    test("revoked access cancels a registration", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      await db
        .update(mailbox)
        .set({ ownerUserId: otherUserId })
        .where(eq(mailbox.id, mailboxId));
      vi.mocked(indexSemanticSources).mockRejectedValue(
        new ORPCError("NOT_FOUND")
      );
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        cancelled: 1,
      });
      await expect(
        db
          .select()
          .from(semanticIndexRequest)
          .where(eq(semanticIndexRequest.userId, userId))
      ).resolves.toHaveLength(0);
    });

    test("a completed healthy registration is promptly reconsidered for new content", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({
          availableAt: new Date(Date.now() + 86_400_000),
          completedAt: new Date(),
        })
        .where(eq(semanticIndexRequest.userId, userId));
      const [before] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      await requestSemanticIndex(scope);
      const [after] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(after?.availableAt.getTime()).toBeLessThan(
        before?.availableAt.getTime() ?? 0
      );
    });

    test("full mail preparation requires available AI access", async () => {
      vi.mocked(createMailboxAiBillingContext).mockRejectedValue(
        new ORPCError("FORBIDDEN")
      );
      await expect(
        requestFullMailSemanticIndex({ mailboxId, userId })
      ).rejects.toBeInstanceOf(ORPCError);
      await expect(
        db
          .select()
          .from(semanticIndexRequest)
          .where(eq(semanticIndexRequest.userId, userId))
      ).resolves.toHaveLength(0);
      expect(advanceSemanticMailImport).not.toHaveBeenCalled();
    });

    test("mail import checkpoints survive embedding failures without resetting the full scan", async () => {
      await requestFullMailSemanticIndex({ mailboxId, userId });
      vi.mocked(advanceSemanticMailImport).mockResolvedValue({
        complete: false,
        pageToken: "synthetic-next-page",
        pendingIds: ["synthetic-pending-id"],
      });
      vi.mocked(indexSemanticSources).mockRejectedValue(
        new ORPCError("FORBIDDEN")
      );
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        failed: 1,
      });
      await requestFullMailSemanticIndex({ mailboxId, userId });
      const [failed] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(failed).toMatchObject({
        completedAt: null,
        mailImportPageToken: "synthetic-next-page",
        mailImportPendingIds: ["synthetic-pending-id"],
        mailImportedAt: null,
      });
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 0,
      });
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      vi.mocked(advanceSemanticMailImport).mockResolvedValue({
        complete: true,
        pageToken: null,
        pendingIds: [],
      });
      vi.mocked(indexSemanticSources).mockResolvedValue({
        complete: true,
        indexedSources: 3,
        totalSources: 3,
      });
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 1,
      });
      const [completed] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(completed?.mailImportedAt).toBeInstanceOf(Date);
      expect(completed?.completedAt).toBeInstanceOf(Date);
      await requestFullMailSemanticIndex({ mailboxId, userId });
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 1,
      });
      expect(advanceSemanticMailImport).toHaveBeenCalledTimes(2);
    });

    test("incomplete mail import prevents a false complete index", async () => {
      await requestFullMailSemanticIndex({ mailboxId, userId });
      vi.mocked(advanceSemanticMailImport).mockResolvedValue({
        complete: false,
        pageToken: "synthetic-next-page",
        pendingIds: [],
      });
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 1,
      });
      const [pending] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(pending).toMatchObject({
        completedAt: null,
        mailImportPageToken: "synthetic-next-page",
        mailImportedAt: null,
      });
    });

    test("a reclaimed mail import cannot checkpoint or start paid indexing", async () => {
      await requestFullMailSemanticIndex({ mailboxId, userId });
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      vi.mocked(advanceSemanticMailImport).mockImplementation(async () => {
        started.resolve(true);
        await release.promise;
        return { complete: true, pageToken: null, pendingIds: [] };
      });
      const running = processPendingSemanticIndexes();
      await started.promise;
      const replacementToken = crypto.randomUUID();
      try {
        await db
          .update(semanticIndexRequest)
          .set({
            leaseExpiresAt: new Date(Date.now() + 120_000),
            leaseToken: replacementToken,
          })
          .where(eq(semanticIndexRequest.userId, userId));
      } finally {
        release.resolve(true);
      }
      await expect(running).resolves.toMatchObject({ processed: 0 });
      expect(indexSemanticSources).not.toHaveBeenCalled();
      const [pending] = await db
        .select()
        .from(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      expect(pending).toMatchObject({
        completedAt: null,
        leaseToken: replacementToken,
        mailImportedAt: null,
      });
    });

    test("local scheduled work is disabled and explicit execution is scoped", async () => {
      await requestSemanticIndex(scope);
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(eq(semanticIndexRequest.userId, userId));
      await requestSemanticIndex({
        kind: "chat",
        mailboxId: otherMailboxId,
        userId: otherUserId,
      });
      await db
        .update(semanticIndexRequest)
        .set({ availableAt: new Date(0) })
        .where(inArray(semanticIndexRequest.userId, [userId, otherUserId]));
      state.deployment = "local";
      await expect(processPendingSemanticIndexes()).resolves.toMatchObject({
        processed: 0,
      });
      await expect(
        processPendingSemanticIndexes({ allowLocal: true })
      ).rejects.toThrow(/local user.*mailbox/u);
      await expect(
        processPendingSemanticIndexes({
          allowLocal: true,
          mailboxId,
          userId,
        })
      ).resolves.toMatchObject({ processed: 1 });
      const remaining = await db
        .select()
        .from(semanticIndexRequest)
        .where(
          and(
            eq(semanticIndexRequest.userId, otherUserId),
            eq(semanticIndexRequest.mailboxId, otherMailboxId)
          )
        );
      expect(remaining[0]).toMatchObject({ completedAt: null });
    });
  }
);
