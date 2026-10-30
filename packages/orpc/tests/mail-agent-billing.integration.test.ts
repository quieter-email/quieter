/* oxlint-disable eslint/require-await -- Provider doubles preserve asynchronous contracts without network I/O. */
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import {
  createMailboxAiBillingContext,
  reserveAiCreditUsage,
  releaseAiCreditUsage,
} from "@quieter/billing/ai-reservation";
import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import type * as EntitlementsModule from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  mailbox,
  member,
  organization,
  user,
  mailboxAgentRevision,
  mailboxAgentSetting,
  mailboxAgentRun,
  mailboxAgentEffect,
} from "@quieter/database/schema";
import { wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
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

import { createAiBillingMiddleware } from "../../ai/src/billing";
import type { recordAiGeneratedMailBody } from "../src/ai-mail-authorship";
import type { loadAiAgentContext } from "../src/ai-memory";
import type {
  listLinearMcpToolsForUser,
  runLinearMcpToolCallsForUser,
} from "../src/connectors/linear-mcp";
import {
  compileAgentManifest,
  loadAgentCatalog,
} from "../src/mail-agent/catalog";
import { drainMailAgentRuns } from "../src/mail-agent/runtime";
import type { composeMailOperations } from "../src/mail/compose";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  entitlement: vi.fn<typeof EntitlementsModule.hasUserBillingFeature>(),
  linear: vi.fn<typeof runLinearMcpToolCallsForUser>(),
  linearTools: vi.fn<typeof listLinearMcpToolsForUser>(),
  memory: vi.fn<typeof loadAiAgentContext>(),
  model:
    vi.fn<
      (
        billing: AiBillingContext,
        onProviderStart?: () => void
      ) => ReturnType<typeof wrapLanguageModel>
    >(),
  provenance: vi.fn<typeof recordAiGeneratedMailBody>(),
  read: vi.fn<() => Promise<unknown>>(),
  save: vi.fn<
    (
      input: Parameters<typeof composeMailOperations.saveDraft>[0]
    ) => Promise<{ baseRevision: string; draftId: string; messageId: string }>
  >(),
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
vi.mock(import("@quieter/billing/entitlements"), async (original) => ({
  ...(await original()),
  hasUserBillingFeature: state.entitlement,
}));
vi.mock(import("@quieter/billing/polar"), async (original) => ({
  ...(await original()),
  ingestPolarEvents: async () => {},
}));
vi.mock(import("@quieter/ai/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: (_model, options) =>
    state.model(options.billing, options.onProviderStart),
}));
vi.mock(import("../src/ai-mail-authorship"), () => ({
  recordAiGeneratedMailBody: state.provenance,
}));
vi.mock(import("../src/connectors/linear-mcp"), async (original) => ({
  ...(await original()),
  listLinearMcpToolsForUser: state.linearTools,
  runLinearMcpToolCallsForUser: state.linear,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Mail adapters are the external provider boundary for this test.
vi.mock("../src/mail/compose", () => ({
  composeMailOperations: { saveDraft: state.save },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- No real mailbox or personal context leaves the test process.
vi.mock("../src/mail/queries", () => ({
  queriesMailOperations: { getThread: state.read },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Actions uses selected context, while the module also exposes an unrelated overview overload.
vi.mock("../src/ai-memory", async () => {
  const { buildMailMemoryQuery, serializeAiAgentContext } =
    await import("../src/ai-memory-context");
  return {
    buildMailMemoryQuery,
    loadAiAgentContext: state.memory,
    serializeAiAgentContext,
  };
});
vi.mock(import("../src/mail-agent/usage"), () => ({
  reportAgentUsage: async () => {},
}));
vi.mock(import("../src/mail-updates"), async (original) => ({
  ...(await original()),
  publishMailUpdate: async () => {},
}));
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: () => {},
}));

type Generation = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
const generation = (
  content: Generation["content"],
  tools = false
): Generation => ({
  content,
  finishReason: { raw: undefined, unified: tools ? "tool-calls" : "stop" },
  providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
  usage: {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
    outputTokens: { reasoning: 0, text: 10, total: 10 },
  },
  warnings: [],
});

const modelWithDrafts = (bodies: string[]) =>
  new MockLanguageModelV4({
    doGenerate: [
      generation(
        bodies.map((bodyText, index) => ({
          input: JSON.stringify({
            bodyText,
            subject: "Reply",
            to: "sender@example.test",
          }),
          toolCallId: `call-${index}`,
          toolName: "capability_1",
          type: "tool-call",
        })),
        true
      ),
      generation([
        {
          text: JSON.stringify({
            matched: true,
            summary: "Prepared replies for review.",
          }),
          type: "text",
        },
      ]),
    ],
  });

describe.skipIf(state.databaseUrl === undefined)(
  "scheduled action billing admission on PostgreSQL",
  () => {
    const actor = {
      mailboxId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    };
    const account = {
      creditAmountCents: 100,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      externalCustomerId: `organization:${actor.organizationId}`,
      organizationId: actor.organizationId,
      product: "pro" as const,
    };
    let runId: string;
    let providerCalls: number;
    let beforeAdmission: (() => Promise<void>) | undefined;
    let afterEffect: (() => Promise<void>) | undefined;
    const row = async () => {
      const [run] = await db
        .select()
        .from(mailboxAgentRun)
        .where(eq(mailboxAgentRun.id, runId));
      if (run === undefined) {
        throw new Error("Missing fixture run.");
      }
      return run;
    };
    const hold = async () =>
      await reserveAiCreditUsage(
        await createMailboxAiBillingContext({
          externalId: `competing:${crypto.randomUUID()}`,
          mailboxId: actor.mailboxId,
          usageKind: "mailAction",
          userId: actor.userId,
        })
      );
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error("Requires disposable loopback PostgreSQL.");
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${actor.userId}@example.test`,
        emailVerified: true,
        id: actor.userId,
        name: "Synthetic action user",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: actor.organizationId,
        name: "Synthetic action team",
        slug: actor.organizationId,
      });
      await db.insert(member).values({
        createdAt: now,
        id: crypto.randomUUID(),
        organizationId: actor.organizationId,
        role: "owner",
        userId: actor.userId,
      });
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${actor.mailboxId}@example.test`,
        id: actor.mailboxId,
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        provider: "gmail",
        updatedAt: now,
      });
    });
    beforeEach(async () => {
      vi.clearAllMocks();
      providerCalls = 0;
      beforeAdmission = undefined;
      afterEffect = undefined;
      state.entitlement.mockResolvedValue({
        account,
        hasAccess: true,
        hasUnlimitedAccess: false,
        product: "pro",
      });
      state.memory.mockResolvedValue({ instructions: null, memory: null });
      state.provenance.mockResolvedValue();
      state.read.mockResolvedValue({
        messages: [
          {
            bodyText: "Prepare a reply.",
            from: "sender@example.test",
            id: "message",
            threadId: "thread",
          },
        ],
        threadId: "thread",
      });
      state.save.mockImplementation(async () => {
        await afterEffect?.();
        return {
          baseRevision: "revision-1",
          draftId: "draft",
          messageId: "draft-message",
        };
      });
      const specification = actionSpecificationSchema.parse({
        connectors: [],
        instructions: "Prepare replies for review.",
        mailboxId: actor.mailboxId,
        permissions: [
          { id: "read", operation: "read", scope: "mailbox" },
          { id: "write", operation: "write", scope: "mailbox" },
        ],
        review: { assumptions: [], questions: [], summary: "Prepare replies." },
        sourceText: "Prepare replies.",
        toolGrants: [
          {
            confirmation: "none",
            permissionId: "read",
            toolId: "mail.read_thread",
          },
          {
            confirmation: "none",
            permissionId: "write",
            toolId: "mail.save_draft",
          },
        ],
        trigger: { kind: "mail_received" },
        version: 1,
      });
      const manifest = compileAgentManifest(
        specification,
        await loadAgentCatalog({ connectionIds: [], userId: actor.userId })
      );
      const revisionId = crypto.randomUUID();
      const now = new Date();
      runId = crypto.randomUUID();
      await db.insert(mailboxAgentRevision).values({
        createdAt: now,
        createdByUserId: actor.userId,
        id: revisionId,
        mailboxId: actor.mailboxId,
        manifest,
        manifestDigest: manifest.digest,
        specification,
      });
      await db.insert(mailboxAgentSetting).values({
        activatedByUserId: actor.userId,
        activationVersion: 1,
        activeRevisionId: revisionId,
        createdAt: now,
        enabled: true,
        mailboxId: actor.mailboxId,
        updatedAt: now,
      });
      await db.insert(mailboxAgentRun).values({
        actorUserId: actor.userId,
        createdAt: now,
        id: runId,
        invocationKey: runId,
        mailboxId: actor.mailboxId,
        messageId: "message",
        revisionId,
        settingVersion: 1,
        threadId: "thread",
        triggerKind: "mail_received",
        updatedAt: now,
      });
      state.model.mockImplementation((billing, onProviderStart) => {
        const provider = modelWithDrafts(["Prepared reply."]);
        return wrapLanguageModel({
          middleware: [
            {
              specificationVersion: "v4",
              wrapGenerate: async ({ doGenerate }) => {
                await beforeAdmission?.();
                return await doGenerate();
              },
            },
            createAiBillingMiddleware(billing, () => 0.001, onProviderStart),
          ],
          model: wrapLanguageModel({
            middleware: {
              specificationVersion: "v4",
              wrapGenerate: async ({ doGenerate }) => {
                providerCalls += 1;
                return await doGenerate();
              },
            },
            model: provider,
          }),
        });
      });
    });
    afterEach(async () => {
      await db
        .delete(mailboxAgentRun)
        .where(eq(mailboxAgentRun.mailboxId, actor.mailboxId));
      await db
        .delete(mailboxAgentSetting)
        .where(eq(mailboxAgentSetting.mailboxId, actor.mailboxId));
      await db
        .delete(mailboxAgentRevision)
        .where(eq(mailboxAgentRevision.mailboxId, actor.mailboxId));
      await db
        .delete(aiCreditReservation)
        .where(eq(aiCreditReservation.organizationId, actor.organizationId));
      await db
        .delete(billingCreditUsageEvent)
        .where(
          eq(billingCreditUsageEvent.organizationId, actor.organizationId)
        );
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(eq(organization.id, actor.organizationId));
      await db.delete(user).where(eq(user.id, actor.userId));
      await db.$client.end();
    });

    test("contention defers without attempts or effects, avoids hot loops and eventually executes once", async () => {
      const reservation = await hold();
      await drainMailAgentRuns({ limit: 1 });
      const deferred = await row();
      expect(deferred).toMatchObject({
        attempts: 0,
        finishedAt: null,
        leaseToken: null,
        status: "queued",
      });
      expect(deferred.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(providerCalls).toBe(0);
      expect(state.save).not.toHaveBeenCalled();
      await expect(
        db
          .select()
          .from(mailboxAgentEffect)
          .where(eq(mailboxAgentEffect.runId, runId))
      ).resolves.toHaveLength(0);
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 0,
        leaseExpiresAt: deferred.leaseExpiresAt,
        status: "queued",
      });
      await db
        .update(mailboxAgentRun)
        .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(mailboxAgentRun.id, runId));
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 0,
        status: "queued",
      });
      expect(providerCalls).toBe(0);
      await releaseAiCreditUsage(reservation);
      await db
        .update(mailboxAgentRun)
        .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(mailboxAgentRun.id, runId));
      await drainMailAgentRuns({ limit: 1 });
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 1,
        status: "succeeded",
      });
      expect(state.save).toHaveBeenCalledOnce();
      expect(providerCalls).toBeGreaterThan(0);
      await expect(
        db
          .select()
          .from(mailboxAgentEffect)
          .where(eq(mailboxAgentEffect.runId, runId))
      ).resolves.toMatchObject([{ status: "completed" }]);
    });

    test("exhausted credit is terminal without retry", async () => {
      state.entitlement.mockResolvedValue({
        account: { ...account, creditAmountCents: 0 },
        hasAccess: true,
        hasUnlimitedAccess: false,
        product: "pro",
      });
      await drainMailAgentRuns({ limit: 1 });
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 1,
        leaseExpiresAt: null,
        status: "needs_attention",
      });
      expect(providerCalls).toBe(0);
      expect(state.save).not.toHaveBeenCalled();
    });

    test("revoked authority is terminal", async () => {
      await db
        .update(mailboxAgentSetting)
        .set({ enabled: false })
        .where(eq(mailboxAgentSetting.mailboxId, actor.mailboxId));
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 1,
        status: "needs_attention",
      });
      expect(providerCalls).toBe(0);
      expect(state.save).not.toHaveBeenCalled();
    });

    test("stale claim cannot defer or refund a replacement worker", async () => {
      await hold();
      const replacement = crypto.randomUUID();
      beforeAdmission = async () => {
        await db
          .update(mailboxAgentRun)
          .set({
            attempts: 2,
            leaseExpiresAt: new Date(Date.now() + 60_000),
            leaseToken: replacement,
          })
          .where(eq(mailboxAgentRun.id, runId));
      };
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 2,
        leaseToken: replacement,
        status: "running",
      });
      expect(providerCalls).toBe(0);
    });

    test("expired claim cannot defer or refund while its token still matches", async () => {
      await hold();
      beforeAdmission = async () => {
        await db
          .update(mailboxAgentRun)
          .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
          .where(eq(mailboxAgentRun.id, runId));
      };
      await drainMailAgentRuns({ limit: 1 });
      const expired = await row();
      expect(expired).toMatchObject({ attempts: 1, status: "running" });
      expect(expired.leaseToken).not.toBeNull();
      expect(expired.leaseExpiresAt?.getTime()).toBeLessThan(Date.now());
      expect(providerCalls).toBe(0);
      expect(state.save).not.toHaveBeenCalled();
    });

    test("contention after provider work without a write is terminal without an attempt refund", async () => {
      let admissionAttempts = 0;
      state.model.mockImplementation((billing, onProviderStart) =>
        wrapLanguageModel({
          middleware: [
            {
              specificationVersion: "v4",
              wrapGenerate: async ({ doGenerate }) => {
                admissionAttempts += 1;
                if (admissionAttempts === 2) {
                  await hold();
                }
                return await doGenerate();
              },
            },
            createAiBillingMiddleware(billing, () => 0.001, onProviderStart),
          ],
          model: new MockLanguageModelV4({
            doGenerate: async () => {
              providerCalls += 1;
              return generation(
                [
                  {
                    input: "{}",
                    toolCallId: "read-thread",
                    toolName: "capability_0",
                    type: "tool-call",
                  },
                ],
                true
              );
            },
          }),
        })
      );
      await drainMailAgentRuns({ limit: 1 });
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 1,
        status: "needs_attention",
      });
      expect(providerCalls).toBe(1);
      expect(state.save).not.toHaveBeenCalled();
      await expect(
        db
          .select()
          .from(mailboxAgentEffect)
          .where(eq(mailboxAgentEffect.runId, runId))
      ).resolves.toHaveLength(0);
    });

    test("contention after a confirmed draft remains terminal without refund or duplicate effects", async () => {
      afterEffect = async () => {
        await hold();
      };
      await drainMailAgentRuns({ limit: 1 });
      await drainMailAgentRuns({ limit: 1 });
      await expect(row()).resolves.toMatchObject({
        attempts: 1,
        status: "needs_attention",
      });
      expect(state.save).toHaveBeenCalledOnce();
      expect(providerCalls).toBe(1);
      await expect(
        db
          .select()
          .from(mailboxAgentEffect)
          .where(eq(mailboxAgentEffect.runId, runId))
      ).resolves.toMatchObject([{ status: "completed" }]);
    });
  }
);
