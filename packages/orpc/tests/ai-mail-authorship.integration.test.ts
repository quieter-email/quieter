import type { suggestReply } from "@quieter/ai/suggest-reply";
import { db } from "@quieter/database/client";
import {
  aiGeneratedMailBody,
  aiMemoryMailboxState,
  aiMemoryScopeConfig,
  mailbox,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { assertCanUseAi } from "../src/ai-access";
import {
  isAiGeneratedMailBody,
  purgeExpiredAiGeneratedMailBodies,
  recordAiGeneratedMailBody,
} from "../src/ai-mail-authorship";
import type * as AiMemoryModule from "../src/ai-memory";
import { captureMailboxMessageMemory } from "../src/ai-memory-capture";
import type { learnAiMemoryFromMailAction } from "../src/mail/feedback";
import type { queriesMailOperations } from "../src/mail/queries";
import { requestReplySuggestion } from "../src/reply-suggestion";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  generate: vi.fn<typeof suggestReply>(),
  thread: vi.fn<(typeof queriesMailOperations)["getThread"]>(),
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
vi.mock(import("@quieter/ai/suggest-reply"), () => ({
  suggestReply: state.generate,
}));
vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<typeof assertCanUseAi>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fixture replaces only ordinary context reads, preserving the overview overload.
vi.mock("../src/ai-memory", async (original) => ({
  ...(await original<typeof AiMemoryModule>()),
  loadAiAgentContext: vi
    .fn<typeof AiMemoryModule.loadAiAgentContext>()
    .mockResolvedValue({ instructions: null, memory: null }),
}));
vi.mock(import("../src/mail/feedback"), () => ({
  learnAiMemoryFromMailAction: vi.fn<typeof learnAiMemoryFromMailAction>(),
}));
vi.mock(import("../src/mail/queries"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    queriesMailOperations: {
      ...actual.queriesMailOperations,
      getThread: state.thread,
    },
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "generated mail authorship on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const secondMailboxId = crypto.randomUUID();
    const bodyText = "Hey Jo,\n\nTuesday works for me.\nThanks!";
    const signatureText = "Sam Example\nOperations\nsam@example.test";
    const signatureHtml =
      "<p>Sam Example<br>Operations<br>sam@example.test</p>";

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Authorship tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.test`,
        emailVerified: true,
        id: userId,
        name: "Mail authorship test",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Mail authorship test",
        slug: organizationId,
      });
      await db.insert(mailbox).values(
        [mailboxId, secondMailboxId].map((id) => ({
          accessMode: "private" as const,
          createdAt: now,
          emailAddress: `${id}@example.test`,
          id,
          organizationId,
          ownerUserId: userId,
          provider: "gmail" as const,
          signatureHtml,
          signatureText,
          updatedAt: now,
        }))
      );
      state.thread.mockResolvedValue({
        messages: [
          {
            bodyText: "Does Tuesday work for you?",
            from: "jo@example.test",
            id: "incoming",
            threadId: "conversation",
          },
        ],
        threadId: "conversation",
      });
      state.generate.mockResolvedValue({ bodyText, status: "suggested" });
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await db.$client.end();
    });

    test("marks suggested text as generated across drafts, send, sync, and bootstrap", async () => {
      const suggestion = await requestReplySuggestion({
        context: { userId },
        input: { mailboxId, messageId: "incoming", threadId: "conversation" },
      });
      expect(suggestion.status).toBe("suggested");
      const now = new Date();
      await db.insert(aiMemoryMailboxState).values({
        createdAt: now,
        mailboxId,
        processingAt: now,
        status: "processing",
        updatedAt: now,
        userId,
      });
      for (const source of ["draft", "sent", "sync", "bootstrap"] as const) {
        const event = await captureMailboxMessageMemory({
          actorUserId: userId,
          bootstrapLease: now.toISOString(),
          mailboxId,
          message: {
            bodyHtml:
              '<p>Hey Jo,</p><p>Tuesday works for me.</p><p>Thanks!</p><div class="gmail_quote">Does Tuesday work for you?</div>',
            ...(source === "draft" ? { draftId: "generated-draft" } : {}),
            id: `generated-${source}`,
            labelIds: ["SENT"],
            threadId: "conversation",
          },
          source,
        });
        const [captured] = await db
          .select({ metadata: userAiContextEvent.metadata })
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.id, event?.id ?? ""));
        expect(captured?.metadata).toMatchObject({
          aiGenerated: true,
          authorship: "ai_generated",
          userAuthored: false,
        });
        expect(captured?.metadata.bodyText).toContain("Tuesday works");
        expect(captured?.metadata.bodyText).not.toContain("Does Tuesday");
      }
    });

    test("recognizes unchanged generated mail after the composer appends a signature", async () => {
      await recordAiGeneratedMailBody({ bodyText, mailboxId, userId });
      const authoredHtml =
        "<p>Hey Jo,</p><p>Tuesday works for me.</p><p>Thanks!</p>";
      const representations = [
        {
          bodyHtml: `${authoredHtml}<div data-quieter-signature="true"><br>${signatureHtml}</div>`,
          bodyText: `${bodyText}\n\n${signatureText}`,
        },
        { bodyText: `${bodyText}\n\n${signatureText}` },
        { bodyHtml: `${authoredHtml}${signatureHtml}` },
      ];
      for (const [index, message] of representations.entries()) {
        const event = await captureMailboxMessageMemory({
          actorUserId: userId,
          mailboxId,
          message: {
            ...message,
            id: `signed-generated-${index}`,
            labelIds: ["SENT"],
            threadId: "conversation",
          },
          source: "sent",
        });
        const [captured] = await db
          .select({ metadata: userAiContextEvent.metadata })
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.id, event?.id ?? ""));
        expect(captured?.metadata).toMatchObject({
          aiGenerated: true,
          userAuthored: false,
        });
      }
    });

    test("keeps unmatched outgoing mail useful without asserting human authorship", async () => {
      await recordAiGeneratedMailBody({ bodyText, mailboxId, userId });
      const event = await captureMailboxMessageMemory({
        actorUserId: userId,
        mailboxId,
        message: {
          bodyText: "Hey Jo! Actually, let's meet on Thursday instead.",
          id: "independent-message",
          labelIds: ["SENT"],
          threadId: "conversation",
        },
        source: "sync",
      });
      const [captured] = await db
        .select({ metadata: userAiContextEvent.metadata })
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.id, event?.id ?? ""));
      expect(captured?.metadata).toMatchObject({
        aiGenerated: false,
        authorship: "observed_outbound",
        evidence: "observed_mail",
        userAuthored: null,
      });
      await expect(
        isAiGeneratedMailBody({ bodyText, mailboxId: secondMailboxId })
      ).resolves.toBeFalsy();
      const count = state.generate.mock.calls.length;
      await expect(
        requestReplySuggestion({
          context: { userId: "another-user" },
          input: { mailboxId, messageId: "incoming", threadId: "conversation" },
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(state.generate).toHaveBeenCalledTimes(count);
    });

    test("records provenance while learning is paused without creating observations", async () => {
      const now = new Date();
      await db.insert(aiMemoryScopeConfig).values({
        activeLearningEnabled: false,
        createdAt: now,
        id: crypto.randomUUID(),
        scope: "user",
        scopeKey: `user:${userId}`,
        updatedAt: now,
        userId,
      });
      await recordAiGeneratedMailBody({
        bodyText: "A generated paused draft.",
        mailboxId,
        userId,
      });
      await expect(
        isAiGeneratedMailBody({
          bodyText: "A generated\n paused   draft.",
          mailboxId,
        })
      ).resolves.toBeTruthy();
      await expect(
        captureMailboxMessageMemory({
          actorUserId: userId,
          mailboxId,
          message: {
            bodyText: "A generated paused draft.",
            id: "paused",
            labelIds: ["SENT"],
            threadId: "paused",
          },
          source: "sent",
        })
      ).resolves.toBeNull();
      const observations = await db
        .select({ id: userAiContextEvent.id })
        .from(userAiContextEvent)
        .where(
          and(
            eq(userAiContextEvent.mailboxId, mailboxId),
            sql`${userAiContextEvent.metadata}->>'messageId' = 'paused'`
          )
        );
      expect(observations).toHaveLength(0);
    });

    test("expires generated provenance and removes expired digests", async () => {
      await recordAiGeneratedMailBody({ bodyText, mailboxId, userId });
      await expect(
        isAiGeneratedMailBody({ bodyText, mailboxId })
      ).resolves.toBeTruthy();
      await db
        .update(aiGeneratedMailBody)
        .set({ expiresAt: new Date(0) })
        .where(eq(aiGeneratedMailBody.mailboxId, mailboxId));
      await expect(
        isAiGeneratedMailBody({ bodyText, mailboxId })
      ).resolves.toBeFalsy();
      await purgeExpiredAiGeneratedMailBodies();
      const retained = await db
        .select({ bodyDigest: aiGeneratedMailBody.bodyDigest })
        .from(aiGeneratedMailBody)
        .where(eq(aiGeneratedMailBody.mailboxId, mailboxId));
      expect(retained).toHaveLength(0);
    });
  }
);
