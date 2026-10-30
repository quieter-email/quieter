import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  mailbox,
  organization,
  organizationMailSendIdempotency,
  user,
} from "@quieter/database/schema";
import { eq, inArray, sql } from "drizzle-orm";
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

import {
  createMailboxAiBillingContext,
  getOutstandingAiCreditReservations,
  releaseAiCreditUsage,
  reserveAiCreditUsage,
  reconcileAiCreditReservations,
  recordAiCreditProviderGeneration,
  settleAiCreditUsage,
} from "../src/ai-reservation";
import type { AiBillingContext } from "../src/ai-reservation";
import { getBillingCreditUsage } from "../src/credits";
import type * as EntitlementsModule from "../src/entitlements";
import { reportAiUsage } from "../src/index";
import { reserveOrganizationMailSend } from "../src/mail-send-reservation";
import type * as PolarModule from "../src/polar";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  entitlement: vi.fn<typeof EntitlementsModule.hasUserBillingFeature>(),
  ingest: vi.fn<typeof PolarModule.ingestPolarEvents>(),
  organizationEntitlement:
    vi.fn<typeof EntitlementsModule.getOrganizationBillingEntitlement>(),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      OPENROUTER_API_KEY: "fixture",
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});
vi.mock(import("../src/entitlements"), async (original) => ({
  ...(await original()),
  getOrganizationBillingEntitlement: state.organizationEntitlement,
  hasUserBillingFeature: state.entitlement,
}));
vi.mock(import("../src/polar"), () => ({ ingestPolarEvents: state.ingest }));

describe.skipIf(state.databaseUrl === undefined)(
  "AI credit reservations in PostgreSQL",
  () => {
    const organizationIds = ["g04-source", "g04-destination"];
    const account = {
      creditAmountCents: 10,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      externalCustomerId: "organization:g04-source",
      organizationId: "g04-source",
      product: "pro" as const,
    };
    const context: Extract<AiBillingContext, { kind: "team" }> = {
      account,
      admittedAt: new Date(),
      groupId: "g04-search",
      kind: "team",
      organizationId: account.organizationId,
      usageKind: "aiChat",
    };

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "AI reservation tests require a disposable loopback migration database."
        );
      }
      await db.insert(user).values({
        createdAt: new Date(),
        email: "g04@example.invalid",
        emailVerified: true,
        id: "g04-user",
        name: "Synthetic user",
        updatedAt: new Date(),
      });
    });
    beforeEach(async () => {
      vi.clearAllMocks();
      await db
        .delete(organization)
        .where(inArray(organization.id, organizationIds));
      await db.insert(organization).values(
        organizationIds.map((id) => ({
          createdAt: new Date(),
          id,
          name: id,
          slug: id,
        }))
      );
      await db.insert(mailbox).values({
        createdAt: new Date(),
        emailAddress: "g04@example.invalid",
        id: "g04-mailbox",
        organizationId: account.organizationId,
        ownerUserId: "g04-user",
        provider: "gmail",
        updatedAt: new Date(),
      });
      state.entitlement.mockResolvedValue({
        account,
        hasAccess: true,
        hasUnlimitedAccess: false,
        product: "pro",
      });
      state.organizationEntitlement.mockResolvedValue({
        account,
        hasAccess: true,
        hasUnlimitedAccess: false,
        product: "pro",
      });
    });

    afterEach(() => vi.unstubAllGlobals());

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, organizationIds));
      await db.delete(user).where(eq(user.id, "g04-user"));
      await db.$client.end();
    });

    test("uses independent PostgreSQL transactions for the admission race", async () => {
      const sessions = await Promise.all(
        [0, 1].map(
          async () =>
            await db.transaction(async (tx) => {
              const rows = await tx.execute<{ pid: number }>(
                sql`select pg_backend_pid() as pid, pg_sleep(0.1)`
              );
              return rows[0]?.pid;
            })
        )
      );
      expect(new Set(sessions).size).toBe(2);
      const settledOnlyChecks = await Promise.all(
        [0, 1].map(async () => {
          const usage = await getBillingCreditUsage(account);
          return usage.costMicroCents < usage.creditAmountMicroCents;
        })
      );
      expect(settledOnlyChecks.every(Boolean)).toBeTruthy();
      const provider = vi.fn<() => void>();
      const results = await Promise.allSettled(
        ["search", "transcription"].map(async (groupId) => {
          const id = await reserveAiCreditUsage({ ...context, groupId });
          provider();
          return id;
        })
      );
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(provider).toHaveBeenCalledOnce();
      await expect(
        getOutstandingAiCreditReservations(account)
      ).resolves.toBeGreaterThan(0);
    });

    test("isolates organizations while retaining an unknown provider outcome", async () => {
      await reserveAiCreditUsage(context);
      await expect(reserveAiCreditUsage(context)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        reserveAiCreditUsage({
          ...context,
          account: { ...account, organizationId: "g04-destination" },
          organizationId: "g04-destination",
        })
      ).resolves.toStrictEqual(expect.any(String));
    });

    test.each([
      "free destination",
      "paid destination",
      "deleted mailbox",
      "membership and plan changed",
    ])("settles the original account exactly once after %s", async (change) => {
      const captured = await createMailboxAiBillingContext({
        externalId: "g04-search",
        mailboxId: "g04-mailbox",
        usageKind: "aiChat",
        userId: "g04-user",
      });
      const reservationId = await reserveAiCreditUsage(captured);
      if (change === "deleted mailbox") {
        await db.delete(mailbox).where(eq(mailbox.id, "g04-mailbox"));
      } else {
        await db
          .update(mailbox)
          .set({ organizationId: "g04-destination" })
          .where(eq(mailbox.id, "g04-mailbox"));
      }
      state.entitlement.mockResolvedValue({
        account: null,
        hasAccess: false,
        hasUnlimitedAccess: false,
        product: null,
      });
      await Promise.all(
        [0, 1].map(async () => {
          await settleAiCreditUsage({ costUsd: 0.01, reservationId });
        })
      );
      await reportAiUsage({
        completionTokens: 1,
        costUsd: 0.01,
        externalId: "g04-search",
        mailboxId: "g04-mailbox",
        model: "fixture",
        promptTokens: 1,
        usageKind: "aiChat",
        userId: "g04-user",
      });
      const events = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          inArray(billingCreditUsageEvent.organizationId, organizationIds)
        );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        organizationId: account.organizationId,
      });
      expect(events[0]?.costMicroCents).toBeGreaterThan(0);
      await expect(getOutstandingAiCreditReservations(account)).resolves.toBe(
        0
      );
    });

    test("releases confirmed non-execution idempotently and prevents later settlement", async () => {
      const reservationId = await reserveAiCreditUsage(context);
      await Promise.all([
        releaseAiCreditUsage(reservationId),
        releaseAiCreditUsage(reservationId),
      ]);
      await expect(
        settleAiCreditUsage({ costUsd: 0.01, reservationId })
      ).rejects.toThrow(/reservation is unavailable/u);
      await expect(reserveAiCreditUsage(context)).resolves.toStrictEqual(
        expect.any(String)
      );
    });

    test("zero-cost completion restores admission, and settlement retries preserve the first charge", async () => {
      const reservationId = await reserveAiCreditUsage(context);
      await settleAiCreditUsage({ costUsd: 0, reservationId });
      await settleAiCreditUsage({ costUsd: 1, reservationId });
      const events = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          eq(billingCreditUsageEvent.organizationId, account.organizationId)
        );
      expect(events).toHaveLength(1);
      expect(events[0]?.costMicroCents).toBe(0);
      await expect(reserveAiCreditUsage(context)).resolves.toStrictEqual(
        expect.any(String)
      );
    });

    test("recovers a cancelled provider generation without expiring an unconfirmed hold", async () => {
      const reservationId = await reserveAiCreditUsage(context);
      await recordAiCreditProviderGeneration({
        generationId: "gen-fixture",
        reservationId,
      });
      const fetchProvider = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetchProvider);
      await reconcileAiCreditReservations();
      await expect(reserveAiCreditUsage(context)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      fetchProvider.mockResolvedValue(
        Response.json({
          data: {
            finish_reason: "stop",
            id: "gen-fixture",
            total_cost: 0.01,
          },
        })
      );
      await reconcileAiCreditReservations();
      await reconcileAiCreditReservations();
      const events = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          eq(billingCreditUsageEvent.organizationId, account.organizationId)
        );
      expect(events).toHaveLength(1);
      expect(events[0]?.costMicroCents).toBeGreaterThan(0);
      await expect(reserveAiCreditUsage(context)).resolves.toStrictEqual(
        expect.any(String)
      );
    });

    test("recovers a persisted completion after a crash without reopening its funds", async () => {
      const reservationId = await reserveAiCreditUsage(context);
      if (reservationId === null) {
        throw new Error("Expected a paid reservation.");
      }
      await db
        .update(aiCreditReservation)
        .set({ actualCostMicroCents: 1000 })
        .where(eq(aiCreditReservation.id, reservationId));
      await releaseAiCreditUsage(reservationId);
      await expect(reserveAiCreditUsage(context)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await reconcileAiCreditReservations();
      await reconcileAiCreditReservations();
      const events = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          eq(billingCreditUsageEvent.organizationId, account.organizationId)
        );
      expect(events).toHaveLength(1);
      expect(events[0]?.costMicroCents).toBeGreaterThan(0);
      await expect(getOutstandingAiCreditReservations(account)).resolves.toBe(
        0
      );
    });

    test("settlement retains the admission period after a billing period change", async () => {
      const mutable = { ...context, account: { ...account } };
      const reservationId = await reserveAiCreditUsage(mutable);
      const nextPeriod = {
        ...account,
        creditAmountCents: 100,
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        currentPeriodStart: new Date(Date.now() + 1000),
      };
      mutable.account = nextPeriod;
      await settleAiCreditUsage({ costUsd: 0.01, reservationId });
      const originalUsage = await getBillingCreditUsage(account);
      const newUsage = await getBillingCreditUsage(nextPeriod);
      expect(originalUsage.costMicroCents).toBeGreaterThan(0);
      expect(newUsage.costMicroCents).toBe(0);
    });

    test("AI and outbound mail cannot reuse the same reserved funds", async () => {
      const send = {
        id: "g04-send",
        idempotencyKey: "g04-send",
        messageHeaderId: "<g04@example.invalid>",
        organizationId: account.organizationId,
        rawObject: {
          bucket: "fixture",
          key: "fixture",
          provider: "s3" as const,
        },
        requestHash: "synthetic-hash",
        snapshot: {
          attachments: [],
          bcc: [],
          bodyText: "Synthetic body",
          cc: [],
          headers: [],
          kind: "mailbox" as const,
          mailboxId: "g04-mailbox",
          rawSizeBytes: 5,
          replyTo: [],
          sender: "g04@example.invalid",
          sentAt: new Date().toISOString(),
          subject: "Synthetic",
          tags: [],
          to: ["recipient@example.invalid"],
        },
      };
      const first = await reserveAiCreditUsage(context);
      await expect(reserveOrganizationMailSend(send)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await releaseAiCreditUsage(first);
      await reserveOrganizationMailSend(send);
      const second = await reserveAiCreditUsage(context);
      const [mailHold] = await db
        .select()
        .from(organizationMailSendIdempotency)
        .where(eq(organizationMailSendIdempotency.id, send.id));
      const aiHold = await getOutstandingAiCreditReservations(account);
      expect(
        aiHold + (mailHold?.estimatedCostMicroCents ?? 0)
      ).toBeLessThanOrEqual(account.creditAmountCents * 1_000_000);
      await settleAiCreditUsage({ costUsd: 0.01, reservationId: second });
    });

    test("unlimited accounts leave no funds held and no charge", async () => {
      const unlimited = { ...context, account: null };
      await expect(reserveAiCreditUsage(unlimited)).resolves.toBeNull();
      await expect(reserveAiCreditUsage(unlimited)).resolves.toBeNull();
      const holds = await db
        .select()
        .from(aiCreditReservation)
        .where(eq(aiCreditReservation.organizationId, account.organizationId));
      expect(holds.every((hold) => hold.status === "settled")).toBeTruthy();
      await expect(getOutstandingAiCreditReservations(account)).resolves.toBe(
        0
      );
    });
  }
);
