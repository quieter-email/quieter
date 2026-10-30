import { spawnSync } from "node:child_process";

import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  billingSubscription,
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
import { z } from "zod";

import { runAiCreditRecovery } from "../src/ai-credit-recovery";
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
import {
  getBillingCreditUsage,
  syncUnreportedBillingCreditUsage,
} from "../src/credits";
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

    const recoveryDecision = async () => {
      const reservationId = z
        .string()
        .parse(await reserveAiCreditUsage(context));
      const inspected = z.object({ snapshot: z.string() }).parse(
        await runAiCreditRecovery({
          mode: "inspect",
          organizationId: account.organizationId,
          reservationId,
        })
      );
      return {
        confirmation: `resolve:${reservationId}:${inspected.snapshot}`,
        evidence: "incident:G04-provider-record",
        expectedSnapshot: inspected.snapshot,
        mode: "resolve" as const,
        operator: "github-run:synthetic",
        organizationId: account.organizationId,
        reason: "confirmed-provider-outcome",
        reservationId,
        resolution: { costUsd: 0.01, kind: "actual-cost" as const },
      };
    };

    test("inspects and dry-runs without releasing admission or calling external services", async () => {
      const input = await recoveryDecision();
      const { confirmation, ...dryRun } = input;
      expect(confirmation).toContain(input.reservationId);
      const network = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", network);
      await expect(
        runAiCreditRecovery({ ...dryRun, mode: "dry-run" })
      ).resolves.toMatchObject({ outcome: "dry-run" });
      await expect(reserveAiCreditUsage(context)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        db
          .select()
          .from(billingCreditUsageEvent)
          .where(
            eq(billingCreditUsageEvent.organizationId, account.organizationId)
          )
      ).resolves.toHaveLength(0);
      expect(network).not.toHaveBeenCalled();
      expect(state.ingest).not.toHaveBeenCalled();
    });

    test("runs the local CLI against a disposable reservation without revealing the account", async () => {
      const input = await recoveryDecision();
      const result = spawnSync(
        process.execPath,
        [
          "scripts/ai-credit-recovery.ts",
          JSON.stringify({
            mode: "inspect",
            organizationId: input.organizationId,
            reservationId: input.reservationId,
          }),
          "--local",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_URL: state.databaseUrl,
            QUIETER_DEPLOYMENT_ENV: "local",
          },
        }
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        reservationId: input.reservationId,
        status: "reserved",
      });
      expect(result.stdout).not.toContain(account.externalCustomerId);
      const linked = spawnSync(
        process.execPath,
        [
          "scripts/ai-credit-recovery.ts",
          JSON.stringify({
            mode: "inspect",
            organizationId: input.organizationId,
            reservationId: input.reservationId,
          }),
          "github-run:123:synthetic-admin",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_URL: "postgres://postgres@127.0.0.1:1/ignored",
            SST_RESOURCE_App: JSON.stringify({
              name: "synthetic",
              stage: "production",
            }),
            SST_RESOURCE_DatabaseUrl: JSON.stringify({
              value: state.databaseUrl,
            }),
          },
        }
      );
      expect(linked.status).toBe(0);
      expect(JSON.parse(linked.stdout)).toMatchObject({
        reservationId: input.reservationId,
        status: "reserved",
      });
      expect(linked.stdout).not.toContain(account.externalCustomerId);

      await expect(
        getOutstandingAiCreditReservations(account)
      ).resolves.toBeGreaterThan(0);
    });

    test("refuses wrong identity, missing confirmation and changed snapshots", async () => {
      const input = await recoveryDecision();
      await expect(
        runAiCreditRecovery({ ...input, organizationId: "g04-destination" })
      ).rejects.toThrow(/identity|confirmation|changed/u);
      await expect(
        runAiCreditRecovery({ ...input, confirmation: "yes" })
      ).rejects.toThrow(/identity|confirmation|changed/u);
      await recordAiCreditProviderGeneration({
        generationId: "gen-updated",
        reservationId: input.reservationId,
      });
      await expect(runAiCreditRecovery(input)).rejects.toThrow(/changed/u);
      await expect(
        getOutstandingAiCreditReservations(account)
      ).resolves.toBeGreaterThan(0);
    });

    test("settles actual cost exactly once against its original account after mailbox movement", async () => {
      const input = await recoveryDecision();
      await db
        .update(mailbox)
        .set({ organizationId: "g04-destination" })
        .where(eq(mailbox.id, "g04-mailbox"));
      const results = await Promise.all([
        runAiCreditRecovery(input),
        runAiCreditRecovery(input),
      ]);
      expect(results).toContainEqual(
        expect.objectContaining({ outcome: "already-resolved" })
      );
      const events = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          inArray(billingCreditUsageEvent.organizationId, organizationIds)
        );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        createdAt: context.admittedAt,
        metadata: { recoveryEvidence: input.evidence },
        organizationId: account.organizationId,
      });
      expect(events[0]?.costMicroCents).toBeGreaterThan(0);
      expect(state.ingest).not.toHaveBeenCalled();
      await expect(
        runAiCreditRecovery({
          ...input,
          resolution: { costUsd: 0.02, kind: "actual-cost" },
        })
      ).rejects.toThrow(/identity|confirmation|changed/u);
      await expect(
        runAiCreditRecovery({ ...input, resolution: { kind: "non-execution" } })
      ).rejects.toThrow(/identity|confirmation|changed/u);
      await expect(reserveAiCreditUsage(context)).resolves.toStrictEqual(
        expect.any(String)
      );
    });

    test("confirmed non-execution creates a zero audit entry and restores AI admission", async () => {
      const input = {
        ...(await recoveryDecision()),
        resolution: { kind: "non-execution" },
      };
      await expect(runAiCreditRecovery(input)).resolves.toMatchObject({
        status: "released",
      });
      await expect(runAiCreditRecovery(input)).resolves.toMatchObject({
        outcome: "already-resolved",
      });
      const events = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          eq(billingCreditUsageEvent.organizationId, account.organizationId)
        );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        billableCostMicroCents: 0,
        costMicroCents: 0,
      });
      await expect(reserveAiCreditUsage(context)).resolves.toStrictEqual(
        expect.any(String)
      );
    });

    test("refuses non-execution when provider identity or actual cost is known", async () => {
      const input = await recoveryDecision();
      await recordAiCreditProviderGeneration({
        generationId: "gen-confirmed",
        reservationId: input.reservationId,
      });
      const inspected = z.object({ snapshot: z.string() }).parse(
        await runAiCreditRecovery({
          mode: "inspect",
          organizationId: input.organizationId,
          reservationId: input.reservationId,
        })
      );
      await expect(
        runAiCreditRecovery({
          ...input,
          confirmation: `resolve:${input.reservationId}:${inspected.snapshot}`,
          expectedSnapshot: inspected.snapshot,
          resolution: { kind: "non-execution" },
        })
      ).rejects.toThrow(/provider identity/u);
      await db
        .update(aiCreditReservation)
        .set({ actualCostMicroCents: 123 })
        .where(eq(aiCreditReservation.id, input.reservationId));
      const current = z.object({ snapshot: z.string() }).parse(
        await runAiCreditRecovery({
          mode: "inspect",
          organizationId: input.organizationId,
          reservationId: input.reservationId,
        })
      );
      await expect(
        runAiCreditRecovery({
          ...input,
          confirmation: `resolve:${input.reservationId}:${current.snapshot}`,
          expectedSnapshot: current.snapshot,
        })
      ).rejects.toThrow(/conflicts/u);
    });

    test("rolls back audit and credit transitions together on persistence failure", async () => {
      const input = {
        ...(await recoveryDecision()),
        resolution: { kind: "non-execution" },
      };
      await db.execute(
        sql`alter table "aiCreditReservation" add constraint g04_recovery_rollback_check check (status <> 'released') not valid`
      );
      try {
        await expect(runAiCreditRecovery(input)).rejects.toThrow(
          /Failed query/u
        );
        await expect(
          db
            .select()
            .from(billingCreditUsageEvent)
            .where(
              eq(billingCreditUsageEvent.organizationId, account.organizationId)
            )
        ).resolves.toHaveLength(0);
        await expect(
          getOutstandingAiCreditReservations(account)
        ).resolves.toBeGreaterThan(0);
      } finally {
        await db.execute(
          sql`alter table "aiCreditReservation" drop constraint g04_recovery_rollback_check`
        );
      }
      await expect(runAiCreditRecovery(input)).resolves.toMatchObject({
        status: "released",
      });
    });

    test("serializes conflicting operational resolutions and refuses altered terminal identity", async () => {
      const input = await recoveryDecision();
      const results = await Promise.allSettled([
        runAiCreditRecovery(input),
        runAiCreditRecovery({
          ...input,
          resolution: { kind: "non-execution" },
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      await expect(
        db
          .select()
          .from(billingCreditUsageEvent)
          .where(
            eq(billingCreditUsageEvent.organizationId, account.organizationId)
          )
      ).resolves.toHaveLength(1);
      const [terminal] = await db
        .select({ status: aiCreditReservation.status })
        .from(aiCreditReservation)
        .where(eq(aiCreditReservation.id, input.reservationId));
      const retry =
        terminal?.status === "settled"
          ? input
          : { ...input, resolution: { kind: "non-execution" as const } };
      await expect(runAiCreditRecovery(retry)).resolves.toMatchObject({
        outcome: "already-resolved",
      });
      await db
        .update(aiCreditReservation)
        .set({ groupId: "changed-authorizing-group" })
        .where(eq(aiCreditReservation.id, input.reservationId));
      await expect(runAiCreditRecovery(retry)).rejects.toThrow(/changed/u);
    });

    test("rolls back a recorded charge and settled transition if final cost persistence fails", async () => {
      const input = await recoveryDecision();
      await db.execute(
        sql`alter table "aiCreditReservation" add constraint g04_recovery_cost_rollback_check check ("actualCostMicroCents" is null) not valid`
      );
      try {
        await expect(runAiCreditRecovery(input)).rejects.toThrow(
          /Failed query/u
        );
        await expect(
          db
            .select()
            .from(billingCreditUsageEvent)
            .where(
              eq(billingCreditUsageEvent.organizationId, account.organizationId)
            )
        ).resolves.toHaveLength(0);
        await expect(
          getOutstandingAiCreditReservations(account)
        ).resolves.toBeGreaterThan(0);
      } finally {
        await db.execute(
          sql`alter table "aiCreditReservation" drop constraint g04_recovery_cost_rollback_check`
        );
      }
      await expect(runAiCreditRecovery(input)).resolves.toMatchObject({
        status: "settled",
      });
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

    test.each(["unavailable", "throws", "malformed", "missing-cost"])(
      "reconciliation advances past %s generations without releasing unknown holds",
      async (outcome) => {
        const reservationId = await reserveAiCreditUsage(context);
        const laterAccount = {
          ...account,
          externalCustomerId: "organization:g04-destination",
          organizationId: "g04-destination",
        };
        const laterReservationId = await reserveAiCreditUsage({
          ...context,
          account: laterAccount,
          organizationId: laterAccount.organizationId,
        });
        await recordAiCreditProviderGeneration({
          generationId: "gen-unresolved",
          reservationId,
        });
        await recordAiCreditProviderGeneration({
          generationId: "gen-recoverable",
          reservationId: laterReservationId,
        });
        vi.stubGlobal(
          "fetch",
          vi.fn<typeof fetch>().mockImplementation(async (input) => {
            const url = new URL(input instanceof Request ? input.url : input);
            if (url.searchParams.get("id") === "gen-recoverable") {
              return await Promise.resolve(
                Response.json({
                  data: {
                    finish_reason: "stop",
                    id: "gen-recoverable",
                    total_cost: 0.01,
                  },
                })
              );
            }
            if (outcome === "throws") {
              throw new Error("Synthetic unavailable generation");
            }
            if (outcome === "malformed") {
              return new Response("invalid json");
            }
            if (outcome === "missing-cost") {
              return Response.json({
                data: { finish_reason: "stop", id: "gen-unresolved" },
              });
            }
            return new Response(null, { status: 404 });
          })
        );
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await reconcileAiCreditReservations({ limit: 1 });
        }
        const events = await db
          .select()
          .from(billingCreditUsageEvent)
          .where(
            inArray(billingCreditUsageEvent.organizationId, organizationIds)
          );
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          organizationId: laterAccount.organizationId,
        });
        await expect(
          getOutstandingAiCreditReservations(laterAccount)
        ).resolves.toBe(0);
        await expect(
          getOutstandingAiCreditReservations(account)
        ).resolves.toBeGreaterThan(0);
        await expect(reserveAiCreditUsage(context)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    );

    test("concurrent reconciliation recovers another organization while a provider read waits", async () => {
      const reservationId = await reserveAiCreditUsage(context);
      const laterAccount = {
        ...account,
        externalCustomerId: "organization:g04-destination",
        organizationId: "g04-destination",
      };
      const laterReservationId = await reserveAiCreditUsage({
        ...context,
        account: laterAccount,
        organizationId: laterAccount.organizationId,
      });
      await recordAiCreditProviderGeneration({
        generationId: "gen-waiting",
        reservationId,
      });
      await recordAiCreditProviderGeneration({
        generationId: "gen-ready",
        reservationId: laterReservationId,
      });
      if (laterReservationId === null) {
        throw new Error("Expected a paid reservation.");
      }
      await db
        .update(aiCreditReservation)
        .set({ lastReconciledAt: new Date(0) })
        .where(eq(aiCreditReservation.id, laterReservationId));
      const waiting = Promise.withResolvers<Response>();
      const started = Promise.withResolvers<boolean>();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockImplementation(async (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.searchParams.get("id") === "gen-waiting") {
            started.resolve(true);
            return await waiting.promise;
          }
          return Response.json({
            data: { finish_reason: "stop", id: "gen-ready", total_cost: 0.01 },
          });
        })
      );
      const first = reconcileAiCreditReservations({ limit: 1 });
      try {
        await started.promise;
        await reconcileAiCreditReservations({ limit: 1 });
        await expect(
          getOutstandingAiCreditReservations(laterAccount)
        ).resolves.toBe(0);
        await expect(
          getOutstandingAiCreditReservations(account)
        ).resolves.toBeGreaterThan(0);
      } finally {
        waiting.resolve(new Response(null, { status: 404 }));
        await first;
      }
      const events = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          inArray(billingCreditUsageEvent.organizationId, organizationIds)
        );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        organizationId: laterAccount.organizationId,
      });
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

    test.each([
      "current",
      "superseded",
      "expired-renewing",
      "expired-trialing",
    ] as const)(
      "recovered %s usage follows subscription reporting eligibility",
      async (period) => {
        const reservationId = await reserveAiCreditUsage(context);
        if (reservationId === null) {
          throw new Error("Expected a paid reservation.");
        }
        const historical = period !== "current";
        const start = historical
          ? new Date(Date.now() - 172_800_000)
          : account.currentPeriodStart;
        const end = historical
          ? new Date(Date.now() - 86_400_000)
          : account.currentPeriodEnd;
        const admittedAt = new Date(start.getTime() + 1000);
        await db
          .update(aiCreditReservation)
          .set({
            account: {
              ...account,
              currentPeriodEnd: end.toISOString(),
              currentPeriodStart: start.toISOString(),
            },
            actualCostMicroCents: 1000,
            createdAt: admittedAt,
          })
          .where(eq(aiCreditReservation.id, reservationId));
        await db.insert(billingSubscription).values({
          createdAt: new Date(),
          currentPeriodEnd: end,
          currentPeriodStart: start,
          id: "g04-subscription",
          metadata: { quieterOrganizationId: account.organizationId },
          organizationId: account.organizationId,
          plan: "pro",
          provider: "polar",
          providerProductId: "fixture",
          providerSubscriptionId: "g04-subscription",
          status: period === "expired-trialing" ? "trialing" : "active",
          updatedAt: new Date(),
          userId: "g04-user",
        });
        if (period === "superseded") {
          await db.insert(billingSubscription).values({
            createdAt: new Date(),
            currentPeriodEnd: account.currentPeriodEnd,
            currentPeriodStart: account.currentPeriodStart,
            id: "g04-later-subscription",
            metadata: { quieterOrganizationId: account.organizationId },
            organizationId: account.organizationId,
            plan: "pro",
            provider: "polar",
            providerProductId: "fixture",
            providerSubscriptionId: "g04-later-subscription",
            status: "active",
            updatedAt: new Date(),
            userId: "g04-user",
          });
        }
        await reconcileAiCreditReservations();
        await reconcileAiCreditReservations();
        expect(state.ingest).not.toHaveBeenCalled();
        const events = await db
          .select()
          .from(billingCreditUsageEvent)
          .where(
            eq(billingCreditUsageEvent.organizationId, account.organizationId)
          );
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          costMicroCents: 1000,
          createdAt: admittedAt,
          polarEventReportedAt: null,
        });
        const result = await syncUnreportedBillingCreditUsage();
        const eligible = period === "current" || period === "expired-renewing";
        expect(result.synced).toBe(eligible ? 1 : 0);
        expect(state.ingest).toHaveBeenCalledTimes(eligible ? 1 : 0);
        await expect(getOutstandingAiCreditReservations(account)).resolves.toBe(
          0
        );
      }
    );

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
      const inspected = z.object({ snapshot: z.string() }).parse(
        await runAiCreditRecovery({
          mode: "inspect",
          organizationId: account.organizationId,
          reservationId: first,
        })
      );
      await runAiCreditRecovery({
        confirmation: `resolve:${first}:${inspected.snapshot}`,
        evidence: "incident:confirmed-not-executed",
        expectedSnapshot: inspected.snapshot,
        mode: "resolve",
        operator: "github-run:synthetic",
        organizationId: account.organizationId,
        reason: "confirmed-non-execution",
        reservationId: first,
        resolution: { kind: "non-execution" },
      });
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
