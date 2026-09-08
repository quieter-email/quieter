import type { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import {
  chat,
  chatMessage,
  mailbox,
  organization,
  user,
} from "@quieter/database/schema";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { assertCanUseAi } from "../src/ai-access";
import type { loadAiAgentContext } from "../src/ai-memory";
import { createAiChatResponse } from "../src/chat/service";
import type { hasConnectedConnector } from "../src/connectors/runtime";
import type { modifyMailForUser } from "../src/gmail-chat-search";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  mailboxId: crypto.randomUUID(),
  model: vi.fn<() => MockLanguageModelV4>(),
  modify: vi.fn<typeof modifyMailForUser>(),
  organizationId: crypto.randomUUID(),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});
// The model boundary is replaced with the SDK's supported test model.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/ai/openrouter", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createChatModel: state.model,
}));
vi.mock(import("@quieter/billing"), async (original) => ({
  ...(await original()),
  reportAiUsage: vi.fn<typeof reportAiUsage>(),
}));
vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<typeof assertCanUseAi>(),
}));
vi.mock(import("../src/ai-memory"), async (original) => ({
  ...(await original()),
  loadAiAgentContext: vi
    .fn<typeof loadAiAgentContext>()
    .mockResolvedValue({ instructions: null, memory: null }),
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: vi
    .fn<typeof assertAccessibleMailbox>()
    .mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: state.mailboxId,
      organizationId: state.organizationId,
      provider: "gmail",
    }),
}));
vi.mock(import("../src/connectors/runtime"), async (original) => ({
  ...(await original()),
  hasConnectedConnector: vi
    .fn<typeof hasConnectedConnector>()
    .mockResolvedValue(false),
}));
vi.mock(import("../src/gmail-chat-search"), async (original) => ({
  ...(await original()),
  modifyMailForUser: state.modify,
}));

describe.skipIf(state.databaseUrl === undefined)(
  "chat approvals on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    let threadId: string;
    let assistantId: string;
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Chat integration tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.com`,
        emailVerified: true,
        id: userId,
        name: "Chat test",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: state.organizationId,
        name: "Chat test",
        slug: state.organizationId,
      });
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: "fixture@example.com",
        id: state.mailboxId,
        organizationId: state.organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
    });
    beforeEach(async () => {
      threadId = crypto.randomUUID();
      assistantId = crypto.randomUUID();
      const now = new Date();
      await db.insert(chat).values({
        createdAt: now,
        id: threadId,
        mailboxId: state.mailboxId,
        updatedAt: now,
        userId,
      });
      await db.insert(chatMessage).values([
        {
          chatId: threadId,
          createdAt: now,
          id: crypto.randomUUID(),
          parts: [{ text: "Archive this email", type: "text" }],
          position: 0,
          role: "user",
          userId,
        },
        {
          chatId: threadId,
          createdAt: now,
          id: assistantId,
          parts: [
            {
              approval: { id: "approval" },
              input: { action: "archive", id: "email", target: "message" },
              state: "approval-requested",
              toolCallId: "action",
              type: "tool-modify_mail",
            },
          ],
          position: 1,
          role: "assistant",
          userId,
        },
      ]);
      state.modify.mockReset().mockResolvedValue({
        action: "archive",
        category: "inbox",
        id: "email",
        status: "success",
        target: "message",
      });
      state.model.mockReturnValue(
        new MockLanguageModelV4({
          doStream: {
            stream: convertArrayToReadableStream([
              { type: "stream-start", warnings: [] },
              {
                error: new Error("Model failed after the tool completed"),
                type: "error",
              },
            ]),
          },
        })
      );
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(eq(organization.id, state.organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await db.$client.end();
    });

    const continueAnswer = async () =>
      await createAiChatResponse({
        body: {
          category: "inbox",
          mailboxId: state.mailboxId,
          message: {
            id: assistantId,
            parts: [
              {
                approval: { approved: true, id: "approval" },
                state: "approval-responded",
                toolCallId: "action",
                type: "tool-modify_mail",
              },
            ],
            role: "assistant",
          },
          model: "openai/gpt-5.6-luna",
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId,
      });

    test("concurrent approvals execute once and keep the result after model failure", async () => {
      const responses = await Promise.allSettled([
        continueAnswer(),
        continueAnswer(),
      ]);
      await Promise.all(
        responses.flatMap((response) =>
          response.status === "fulfilled" ? [response.value.text()] : []
        )
      );
      expect(
        responses.filter((response) => response.status === "fulfilled")
      ).toHaveLength(1);
      expect(state.modify).toHaveBeenCalledOnce();
      const [stored] = await db
        .select()
        .from(chatMessage)
        .where(eq(chatMessage.id, assistantId));
      expect(stored?.parts).toMatchObject([
        { output: { status: "success" }, state: "output-available" },
      ]);
      await expect(continueAnswer()).rejects.toMatchObject({ status: 409 });
      await expect(
        createAiChatResponse({
          body: {
            category: "inbox",
            mailboxId: state.mailboxId,
            message: null,
            model: "openai/gpt-5.6-luna",
            threadId,
            trigger: "regenerate-message",
          },
          request: new Request("https://example.test/api/chat"),
          userId,
        })
      ).rejects.toMatchObject({ status: 409 });
    });

    test("an interrupted approval is not executed again when a new message loads its history", async () => {
      const [stored] = await db
        .select()
        .from(chatMessage)
        .where(eq(chatMessage.id, assistantId));
      await db
        .update(chatMessage)
        .set({
          parts: (stored?.parts ?? []).map((part) => ({
            ...part,
            approval: { approved: true, id: "approval" },
            state: "approval-responded",
          })),
        })
        .where(eq(chatMessage.id, assistantId));
      await expect(continueAnswer()).rejects.toMatchObject({ status: 409 });
      const response = await createAiChatResponse({
        body: {
          category: "inbox",
          mailboxId: state.mailboxId,
          message: {
            id: crypto.randomUUID(),
            parts: [{ text: "Explain what happened", type: "text" }],
            role: "user",
          },
          model: "openai/gpt-5.6-luna",
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId,
      });
      await response.text();
      expect(state.modify).not.toHaveBeenCalled();
    });
  }
);
