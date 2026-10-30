import {
  createMailboxAiBillingContext,
  reserveAiCreditUsage,
} from "@quieter/billing/ai-reservation";
import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import type * as EntitlementsModule from "@quieter/billing/entitlements";
import type { ingestPolarEvents } from "@quieter/billing/polar";
import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  chat,
  mailbox,
  member,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import type { reportError } from "@quieter/observability";
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
import {
  learnAiMemoryFromChatMessage,
  refreshAiMemoryFromEvent,
} from "../src/ai-memory";
import { createAiChatResponse } from "../src/chat/service";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  entitlement: vi.fn<typeof EntitlementsModule.hasUserBillingFeature>(),
  ingest: vi.fn<typeof ingestPolarEvents>(),
  model:
    vi.fn<
      (billing: AiBillingContext) => ReturnType<typeof wrapLanguageModel>
    >(),
  report: vi.fn<typeof reportError>(),
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
  ingestPolarEvents: state.ingest,
}));
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: state.report,
}));
vi.mock(import("@quieter/ai/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: (_model, options) => state.model(options.billing),
}));

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
};

describe.skipIf(state.databaseUrl === undefined)(
  "foreground and ambient chat billing on PostgreSQL",
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
    let threadId: string;
    let scheduled: Promise<unknown>[];
    let foregroundStarted: ReturnType<typeof Promise.withResolvers<boolean>>;
    let terminal: ReturnType<
      typeof Promise.withResolvers<"success" | "failure" | "cancel">
    >;
    let ambientStarted: ReturnType<typeof Promise.withResolvers<boolean>>;
    let ambientRelease: ReturnType<typeof Promise.withResolvers<boolean>>;
    let ambientCalls: number;
    let titleCalls: number;
    let blockAdmissionAt: number | null;
    let foregroundAttempts: number;

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Chat billing tests require disposable loopback PostgreSQL."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${actor.userId}@example.test`,
        emailVerified: true,
        id: actor.userId,
        name: "Synthetic chat user",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: actor.organizationId,
        name: "Synthetic chat team",
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
      scheduled = [];
      foregroundStarted = Promise.withResolvers<boolean>();
      terminal = Promise.withResolvers<"success" | "failure" | "cancel">();
      ambientStarted = Promise.withResolvers<boolean>();
      ambientRelease = Promise.withResolvers<boolean>();
      ambientCalls = 0;
      titleCalls = 0;
      blockAdmissionAt = null;
      foregroundAttempts = 0;
      state.entitlement.mockResolvedValue({
        account,
        hasAccess: true,
        hasUnlimitedAccess: false,
        product: "pro",
      });
      threadId = crypto.randomUUID();
      await db.insert(chat).values({
        createdAt: new Date(),
        id: threadId,
        mailboxId: actor.mailboxId,
        title: "Existing conversation",
        updatedAt: new Date(),
        userId: actor.userId,
      });
      state.model.mockImplementation((billing) => {
        if (billing.kind !== "team") {
          throw new Error("Fixture must exercise paid team admission.");
        }
        const ambient = billing.groupId.startsWith("ai-memory-event:");
        const model = wrapLanguageModel({
          middleware: createAiBillingMiddleware(billing, () => 0.01),
          model: new MockLanguageModelV4({
            doGenerate: async () => {
              if (billing.groupId.startsWith("chat-title:")) {
                titleCalls += 1;
              }
              if (ambient) {
                ambientCalls += 1;
                ambientStarted.resolve(true);
                await ambientRelease.promise;
              }
              return {
                content: [
                  {
                    text: JSON.stringify(
                      ambient
                        ? {
                            answer: "Reviewed observations.",
                            operations: [],
                            summary: "No lasting facts.",
                          }
                        : { intent: "none" }
                    ),
                    type: "text",
                  },
                ],
                finishReason: { raw: undefined, unified: "stop" },
                providerMetadata: { openrouter: { usage: { cost: 0.01 } } },
                usage,
                warnings: [],
              };
            },
            // oxlint-disable-next-line eslint/require-await -- The SDK test model requires a promise response.
            doStream: async () => {
              foregroundStarted.resolve(true);
              if (blockAdmissionAt === 2) {
                return {
                  stream: new ReadableStream({
                    start(controller) {
                      controller.enqueue({
                        type: "stream-start",
                        warnings: [],
                      });
                      controller.enqueue({
                        input: "{}",
                        toolCallId: "read-context",
                        toolName: "read_personal_context",
                        type: "tool-call",
                      });
                      controller.enqueue({
                        finishReason: { raw: undefined, unified: "tool-calls" },
                        providerMetadata: {
                          openrouter: { usage: { cost: 0.01 } },
                        },
                        type: "finish",
                        usage,
                      });
                      controller.close();
                    },
                  }),
                };
              }
              return {
                stream: new ReadableStream({
                  async start(controller) {
                    controller.enqueue({ type: "stream-start", warnings: [] });
                    controller.enqueue({ id: "answer", type: "text-start" });
                    controller.enqueue({
                      delta: "Your answer is ready.",
                      id: "answer",
                      type: "text-delta",
                    });
                    const outcome = await terminal.promise;
                    if (outcome === "success") {
                      controller.enqueue({ id: "answer", type: "text-end" });
                      controller.enqueue({
                        finishReason: { raw: undefined, unified: "stop" },
                        providerMetadata: {
                          openrouter: { usage: { cost: 0.01 } },
                        },
                        type: "finish",
                        usage,
                      });
                    } else {
                      controller.enqueue({
                        error:
                          outcome === "cancel"
                            ? new DOMException("Cancelled", "AbortError")
                            : new Error(
                                "Synthetic provider connection failed."
                              ),
                        type: "error",
                      });
                    }
                    controller.close();
                  },
                }),
              };
            },
          }),
        });
        return billing.usageKind === "aiChat"
          ? wrapLanguageModel({
              middleware: {
                specificationVersion: "v4",
                wrapStream: async ({ doStream }) => {
                  foregroundAttempts += 1;
                  if (foregroundAttempts === blockAdmissionAt) {
                    await reserveAiCreditUsage({
                      ...billing,
                      groupId: `competing:${threadId}`,
                    });
                  }
                  return await doStream();
                },
              },
              model,
            })
          : model;
      });
    });

    afterEach(async () => {
      terminal.resolve("cancel");
      ambientRelease.resolve(true);
      await Promise.allSettled(scheduled);
      await db.delete(chat).where(eq(chat.id, threadId));
      await db
        .delete(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, actor.userId));
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

    const startChat = async () =>
      await createAiChatResponse({
        body: {
          category: "inbox",
          foreground: {
            capabilities: [],
            exchangeId: crypto.randomUUID(),
            expiresAt: Date.now() + 60_000,
            generation: 1,
            tabId: "synthetic-tab",
          },
          mailboxId: actor.mailboxId,
          message: {
            id: crypto.randomUUID(),
            parts: [{ text: "Help me plan my day.", type: "text" }],
            role: "user",
          },
          model: "openai/gpt-5.6-luna",
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        scheduleBackgroundTask: (task) => {
          scheduled.push(task);
        },
        userId: actor.userId,
      });

    test("eager ambient execution blocks its own foreground admission", async () => {
      await learnAiMemoryFromChatMessage({
        bodyText: "Help me plan my day.",
        deferBackgroundTask: (task) => {
          scheduled.push(task());
        },
        mailboxId: actor.mailboxId,
        messageId: crypto.randomUUID(),
        userId: actor.userId,
      });
      await ambientStarted.promise;
      const foregroundBilling = await createMailboxAiBillingContext({
        externalId: `chat:${threadId}`,
        mailboxId: actor.mailboxId,
        usageKind: "aiChat",
        userId: actor.userId,
      });
      await expect(
        reserveAiCreditUsage(foregroundBilling)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      ambientRelease.resolve(true);
      await Promise.all(scheduled);
    });

    test("the foreground answer settles before default active learning spends, and learning settles once", async () => {
      const response = await startChat();
      const text = response.text();
      const winner = await Promise.race([
        foregroundStarted.promise.then(() => "foreground"),
        ambientStarted.promise.then(() => "ambient"),
        text.then(() => "ended"),
      ]);
      expect(winner).toBe("foreground");
      const pending = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, actor.userId));
      expect(pending).toHaveLength(1);
      expect(pending[0].mergedAt).toBeNull();
      const held = await db
        .select()
        .from(aiCreditReservation)
        .where(eq(aiCreditReservation.organizationId, actor.organizationId));
      expect(held.filter((row) => row.status === "reserved")).toHaveLength(1);
      expect(
        held.some((row) => row.groupId.startsWith("ai-memory-event:"))
      ).toBeFalsy();
      expect(titleCalls).toBe(0);
      terminal.resolve("success");
      await expect(text).resolves.toContain("Your answer is ready.");
      await ambientStarted.promise;
      const learning = await db
        .select()
        .from(aiCreditReservation)
        .where(eq(aiCreditReservation.organizationId, actor.organizationId));
      expect(learning.filter((row) => row.status === "reserved")).toStrictEqual(
        [expect.objectContaining({ usageKind: "aiMemory" })]
      );
      expect(
        learning.some(
          (row) => row.usageKind === "aiChat" && row.status === "settled"
        )
      ).toBeTruthy();
      expect(titleCalls).toBe(1);
      expect(
        learning.filter((row) => row.groupId.startsWith("chat-title:"))
      ).toStrictEqual([expect.objectContaining({ status: "settled" })]);
      ambientRelease.resolve(true);
      await Promise.all(scheduled);
      await refreshAiMemoryFromEvent({ eventId: pending[0].id });
      const events = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, actor.userId));
      expect(events[0].mergedAt).not.toBeNull();
      const reservations = await db
        .select()
        .from(aiCreditReservation)
        .where(eq(aiCreditReservation.organizationId, actor.organizationId));
      expect(
        reservations.filter((row) => row.groupId.startsWith("ai-memory-event:"))
      ).toStrictEqual([expect.objectContaining({ status: "settled" })]);
      const ambientReservation = reservations.find((row) =>
        row.groupId.startsWith("ai-memory-event:")
      );
      const ledger = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(
          eq(billingCreditUsageEvent.organizationId, actor.organizationId)
        );
      expect(
        ledger.filter(
          (event) =>
            event.dedupeKey === `ai:reservation:${ambientReservation?.id}`
        )
      ).toHaveLength(1);
      expect(ambientCalls).toBe(1);
      expect(state.report).not.toHaveBeenCalled();
    });

    test.each([1, 2])(
      "step %i admission preserves an actionable streamed error without reporting it",
      async (step) => {
        blockAdmissionAt = step;
        const response = await startChat();
        const content = await response.text();
        await Promise.all(scheduled);
        expect(content).toContain("quieter.chat.expected-error");
        expect(content).toMatch(/usage|balance|progress|wait/iu);
        expect(foregroundAttempts).toBe(step);
        const holds = await db
          .select()
          .from(aiCreditReservation)
          .where(eq(aiCreditReservation.organizationId, actor.organizationId));
        expect(holds.filter((row) => row.status === "reserved")).toStrictEqual([
          expect.objectContaining({ groupId: `competing:${threadId}` }),
        ]);
        expect(state.report).not.toHaveBeenCalled();
      }
    );

    test("cancelling the response reader drains deferred learning without releasing unknown liability", async () => {
      const response = await startChat();
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error("Chat response must have a stream.");
      }
      let answer = "";
      const decoder = new TextDecoder();
      while (!answer.includes("Your answer is ready.")) {
        const part = await reader.read();
        if (part.done) {
          throw new Error("Chat ended before its answer.");
        }
        answer += decoder.decode(part.value);
      }
      const cancelled = reader.cancel();
      terminal.resolve("cancel");
      await cancelled;
      await Promise.all(scheduled);
      const reservations = await db
        .select()
        .from(aiCreditReservation)
        .where(eq(aiCreditReservation.organizationId, actor.organizationId));
      expect(
        reservations.filter((row) => row.status === "reserved")
      ).toStrictEqual([expect.objectContaining({ usageKind: "aiChat" })]);
      const events = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, actor.userId));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        mergedAt: null,
        processingAt: null,
        skippedAt: null,
      });
      expect(ambientCalls).toBe(0);
      expect(state.report).not.toHaveBeenCalled();
    });

    test.each(["failure", "cancel"] as const)(
      "%s retains unknown foreground liability and leaves ambient evidence pending",
      async (outcome) => {
        const response = await startChat();
        const text = response.text();
        await foregroundStarted.promise;
        terminal.resolve(outcome);
        await text;
        await Promise.all(scheduled);
        const reservations = await db
          .select()
          .from(aiCreditReservation)
          .where(eq(aiCreditReservation.organizationId, actor.organizationId));
        expect(
          reservations.filter((row) => row.status === "reserved")
        ).toStrictEqual([expect.objectContaining({ usageKind: "aiChat" })]);
        expect(ambientCalls).toBe(0);
        const events = await db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.userId, actor.userId));
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          mergedAt: null,
          processingAt: null,
          skippedAt: null,
        });
        expect(
          state.report.mock.calls.some(
            ([, context]) => context?.operation === "chat:generation"
          )
        ).toBe(outcome === "failure");
        expect(
          state.report.mock.calls.every(
            ([, context]) => context?.operation === "chat:generation"
          )
        ).toBeTruthy();
      }
    );
  }
);
