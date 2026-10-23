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
import { isAiGeneratedMailBody } from "../src/ai-mail-authorship";
import type * as AiMemoryModule from "../src/ai-memory";
import { createAiChatResponse } from "../src/chat/service";
import type { hasConnectedConnector } from "../src/connectors/runtime";
import type { modifyMailForUser } from "../src/gmail-chat-search";
import type { composeMailOperations } from "../src/mail/compose";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  learn: vi.fn<typeof AiMemoryModule.learnAiMemoryFromChatMessage>(),
  mailboxId: crypto.randomUUID(),
  model: vi.fn<() => MockLanguageModelV4>(),
  modify: vi.fn<typeof modifyMailForUser>(),
  organizationId: crypto.randomUUID(),
  send: vi.fn<typeof composeMailOperations.sendMessage>(),
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
// oxlint-disable-next-line vitest/prefer-import-in-mock -- This fixture mocks only normal context calls, not the overview overload.
vi.mock("../src/ai-memory", async (original) => ({
  ...(await original<typeof AiMemoryModule>()),
  learnAiMemoryFromChatMessage: state.learn,
  loadAiAgentContext: vi
    .fn<typeof AiMemoryModule.loadAiAgentContext>()
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
vi.mock(import("../src/mail/compose"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    composeMailOperations: {
      ...actual.composeMailOperations,
      sendMessage: state.send,
    },
  };
});

const sendDraft = {
  attachments: [],
  bodyHtml: "<p>Hello Sam</p>",
  draftId: "draft-1",
  draftRevision: 1,
  inlineImages: [],
  subject: "Project update",
  to: "sam@example.test",
};

describe.skipIf(state.databaseUrl === undefined)(
  "chat approvals on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    let threadId: string;
    let assistantId: string;
    let userMessageId: string;
    let foreground: {
      capabilities: ["modify_mail"];
      exchangeId: string;
      expiresAt: number;
      generation: number;
      tabId: string;
    };
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
      userMessageId = crypto.randomUUID();
      foreground = {
        capabilities: ["modify_mail"],
        exchangeId: assistantId,
        expiresAt: Date.now() + 60_000,
        generation: 1,
        tabId: "tab-1",
      };
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
          id: userMessageId,
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
              foreground,
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
      state.learn
        .mockReset()
        .mockResolvedValue({ explicit: false, status: "recorded" });
      state.send.mockReset().mockResolvedValue({
        draftCleanupHandled: true,
        id: "sent-message",
        idempotent: false,
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

    const continueAnswer = async (
      requestForeground: typeof foreground = foreground,
      toolName: "modify_mail" | "send_mail" = "modify_mail"
    ) =>
      await createAiChatResponse({
        body: {
          category: "inbox",
          foreground: requestForeground,
          mailboxId: state.mailboxId,
          message: {
            id: assistantId,
            parts: [
              {
                approval: { approved: true, id: "approval" },
                state: "approval-responded",
                toolCallId: "action",
                type: `tool-${toolName}`,
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

    test("claims an approved stored send once and preserves it after generation failure", async () => {
      await db
        .update(chatMessage)
        .set({
          parts: [
            {
              foreground: { ...foreground, policy: "automatic" },
              input: {},
              output: {
                draft: sendDraft,
                generation: foreground.generation,
                mailboxId: state.mailboxId,
                view: "compose",
              },
              state: "output-available",
              toolCallId: "workspace",
              type: "tool-get_workspace",
            },
            {
              approval: { id: "approval" },
              foreground: { ...foreground, policy: "automatic" },
              input: { draft: sendDraft },
              state: "approval-requested",
              toolCallId: "action",
              type: "tool-send_mail",
            },
          ],
        })
        .where(eq(chatMessage.id, assistantId));
      const responses = await Promise.allSettled([
        continueAnswer(foreground, "send_mail"),
        continueAnswer(foreground, "send_mail"),
      ]);
      await Promise.all(
        responses.flatMap((response) =>
          response.status === "fulfilled" ? [response.value.text()] : []
        )
      );
      expect(state.send).toHaveBeenCalledOnce();
      expect(state.learn).not.toHaveBeenCalled();
      const [stored] = await db
        .select()
        .from(chatMessage)
        .where(eq(chatMessage.id, assistantId));
      expect(
        stored?.parts.find((part) => part.toolCallId === "action")
      ).toMatchObject({
        output: { status: "sent" },
        state: "output-available",
      });
      await expect(
        continueAnswer(foreground, "send_mail")
      ).rejects.toMatchObject({ status: 409 });
    });

    test("executes a new mailbox change immediately and keeps its outcome after generation fails", async () => {
      await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
      state.model.mockReturnValue(
        new MockLanguageModelV4({
          doStream: [
            {
              stream: convertArrayToReadableStream([
                { type: "stream-start", warnings: [] },
                {
                  input: JSON.stringify({
                    action: "archive",
                    id: "email",
                    target: "message",
                  }),
                  toolCallId: "automatic-action",
                  toolName: "modify_mail",
                  type: "tool-call",
                },
                {
                  finishReason: { raw: undefined, unified: "tool-calls" },
                  type: "finish",
                  usage: {
                    inputTokens: {
                      cacheRead: 0,
                      cacheWrite: 0,
                      noCache: 1,
                      total: 1,
                    },
                    outputTokens: { reasoning: 0, text: 1, total: 1 },
                  },
                },
              ]),
            },
            {
              stream: convertArrayToReadableStream([
                { type: "stream-start", warnings: [] },
                {
                  error: new Error("Model failed after the automatic action"),
                  type: "error",
                },
              ]),
            },
          ],
        })
      );
      const response = await createAiChatResponse({
        body: {
          category: "inbox",
          foreground,
          mailboxId: state.mailboxId,
          message: {
            id: userMessageId,
            parts: [{ text: "Archive this email", type: "text" }],
            role: "user",
          },
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId,
      });
      const stream = await response.text();
      expect(stream).not.toContain("tool-approval-request");
      expect(state.modify).toHaveBeenCalledOnce();
      expect(state.learn).toHaveBeenCalledExactlyOnceWith({
        bodyText: "Archive this email",
        mailboxId: state.mailboxId,
        messageId: userMessageId,
        userId,
      });
      const [stored] = await db
        .select()
        .from(chatMessage)
        .where(eq(chatMessage.id, assistantId));
      expect(
        stored?.parts.find((part) => part.toolCallId === "automatic-action")
      ).toMatchObject({
        output: { status: "success" },
        state: "output-available",
      });
    });

    test.each(["open_compose", "edit_compose"] as const)(
      "records generated %s text before the browser receives the action",
      async (toolName) => {
        await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
        const bodyText = `Hey Jo,\n\nHere is the ${toolName} reply.`;
        state.model.mockReturnValue(
          new MockLanguageModelV4({
            doStream: {
              stream: convertArrayToReadableStream([
                { type: "stream-start", warnings: [] },
                {
                  input: JSON.stringify({
                    bodyText,
                    ...(toolName === "edit_compose"
                      ? { draftId: "visible-draft", expectedDraftRevision: 1 }
                      : {}),
                  }),
                  toolCallId: "compose-action",
                  toolName,
                  type: "tool-call",
                },
                {
                  finishReason: { raw: undefined, unified: "tool-calls" },
                  type: "finish",
                  usage: {
                    inputTokens: {
                      cacheRead: 0,
                      cacheWrite: 0,
                      noCache: 1,
                      total: 1,
                    },
                    outputTokens: { reasoning: 0, text: 1, total: 1 },
                  },
                },
              ]),
            },
          })
        );
        const response = await createAiChatResponse({
          body: {
            category: "inbox",
            foreground,
            mailboxId: state.mailboxId,
            message: {
              id: userMessageId,
              parts: [{ text: "Draft a brief response", type: "text" }],
              role: "user",
            },
            threadId,
            trigger: "submit-message",
          },
          request: new Request("https://example.test/api/chat"),
          userId,
        });
        const stream = await response.text();
        expect(stream).toContain(toolName);
        await expect(
          isAiGeneratedMailBody({ bodyText, mailboxId: state.mailboxId })
        ).resolves.toBeTruthy();
      }
    );

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
    });

    test("matches a foreground lease independent of client key order", async () => {
      const response = await continueAnswer({
        capabilities: foreground.capabilities,
        exchangeId: foreground.exchangeId,
        expiresAt: foreground.expiresAt,
        generation: foreground.generation,
        tabId: foreground.tabId,
      });
      await response.text();

      expect(state.modify).toHaveBeenCalledOnce();
    });

    test("rejects an exchange id already used by an assistant before model or tool effects", async () => {
      const nextUserMessageId = crypto.randomUUID();
      state.model.mockClear();

      await expect(
        createAiChatResponse({
          body: {
            category: "inbox",
            foreground,
            mailboxId: state.mailboxId,
            message: {
              id: nextUserMessageId,
              parts: [{ text: "Try this exchange again", type: "text" }],
              role: "user",
            },
            model: "openai/gpt-5.6-luna",
            threadId,
            trigger: "submit-message",
          },
          request: new Request("https://example.test/api/chat"),
          userId,
        })
      ).rejects.toMatchObject({ status: 409 });

      expect(state.model).not.toHaveBeenCalled();
      const [storedUserMessage] = await db
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.id, nextUserMessageId));
      expect(storedUserMessage).toBeUndefined();
    });

    test("rejects an exchange id already used by a user before model or tool effects", async () => {
      const nextUserMessageId = crypto.randomUUID();
      state.model.mockClear();

      await expect(
        createAiChatResponse({
          body: {
            category: "inbox",
            foreground: { ...foreground, exchangeId: userMessageId },
            mailboxId: state.mailboxId,
            message: {
              id: nextUserMessageId,
              parts: [
                { text: "Reuse a user id as the exchange", type: "text" },
              ],
              role: "user",
            },
            model: "openai/gpt-5.6-luna",
            threadId,
            trigger: "submit-message",
          },
          request: new Request("https://example.test/api/chat"),
          userId,
        })
      ).rejects.toMatchObject({ status: 409 });

      expect(state.model).not.toHaveBeenCalled();
      const [storedUserMessage] = await db
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.id, nextUserMessageId));
      expect(storedUserMessage).toBeUndefined();
    });

    test("retries a failed turn by dropping its marked reservation", async () => {
      const retryForeground = {
        ...foreground,
        exchangeId: crypto.randomUUID(),
      };
      await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
      const now = new Date();
      await db.insert(chatMessage).values([
        {
          chatId: threadId,
          createdAt: now,
          id: userMessageId,
          parts: [{ text: "Archive this email", type: "text" }],
          position: 0,
          role: "user",
          userId,
        },
        {
          chatId: threadId,
          createdAt: now,
          id: assistantId,
          parts: [{ type: "data-foreground-failed" }],
          position: 1,
          role: "assistant",
          userId,
        },
      ]);
      state.model.mockClear();

      const response = await createAiChatResponse({
        body: {
          category: "inbox",
          foreground: retryForeground,
          mailboxId: state.mailboxId,
          message: {
            id: userMessageId,
            parts: [{ text: "Archive this email", type: "text" }],
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

      expect(state.model).toHaveBeenCalledOnce();
      const rows = await db
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, threadId));
      expect(rows.map(({ id }) => id).toSorted()).toStrictEqual(
        [retryForeground.exchangeId, userMessageId].toSorted()
      );
    });

    test("refuses to drop an active reservation on retry", async () => {
      const retryForeground = {
        ...foreground,
        exchangeId: crypto.randomUUID(),
      };
      await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
      const now = new Date();
      await db.insert(chatMessage).values([
        {
          chatId: threadId,
          createdAt: now,
          id: userMessageId,
          parts: [{ text: "Archive this email", type: "text" }],
          position: 0,
          role: "user",
          userId,
        },
        {
          chatId: threadId,
          createdAt: now,
          id: assistantId,
          parts: [{ foreground, type: "data-foreground" }],
          position: 1,
          role: "assistant",
          userId,
        },
      ]);
      state.model.mockClear();

      await expect(
        createAiChatResponse({
          body: {
            category: "inbox",
            foreground: retryForeground,
            mailboxId: state.mailboxId,
            message: {
              id: userMessageId,
              parts: [{ text: "Archive this email", type: "text" }],
              role: "user",
            },
            model: "openai/gpt-5.6-luna",
            threadId,
            trigger: "submit-message",
          },
          request: new Request("https://example.test/api/chat"),
          userId,
        })
      ).rejects.toMatchObject({ status: 409 });

      expect(state.model).not.toHaveBeenCalled();
      const rows = await db
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, threadId));
      expect(rows.map(({ id }) => id).toSorted()).toStrictEqual(
        [assistantId, userMessageId].toSorted()
      );
    });

    test("concurrent chats claim the same exchange once", async () => {
      const chatIds = [crypto.randomUUID(), crypto.randomUUID()];
      const exchangeId = crypto.randomUUID();
      const now = new Date();
      await db.insert(chat).values(
        chatIds.map((id) => ({
          createdAt: now,
          id,
          mailboxId: state.mailboxId,
          updatedAt: now,
          userId,
        }))
      );
      state.model.mockClear();

      const responses = await Promise.allSettled(
        chatIds.map(
          async (chatId) =>
            await createAiChatResponse({
              body: {
                category: "inbox",
                foreground: { ...foreground, exchangeId },
                mailboxId: state.mailboxId,
                message: {
                  id: crypto.randomUUID(),
                  parts: [{ text: "Start the shared exchange", type: "text" }],
                  role: "user",
                },
                model: "openai/gpt-5.6-luna",
                threadId: chatId,
                trigger: "submit-message",
              },
              request: new Request("https://example.test/api/chat"),
              userId,
            })
        )
      );
      await Promise.all(
        responses.flatMap((response) =>
          response.status === "fulfilled" ? [response.value.text()] : []
        )
      );

      expect(
        responses.filter((response) => response.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        responses.filter(
          (response) =>
            response.status === "rejected" &&
            response.reason instanceof Error &&
            "status" in response.reason &&
            response.reason.status === 409
        )
      ).toHaveLength(1);
      expect(state.model).toHaveBeenCalledOnce();
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
      const nextForeground = {
        ...foreground,
        exchangeId: crypto.randomUUID(),
      };
      const response = await createAiChatResponse({
        body: {
          category: "inbox",
          foreground: nextForeground,
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

    test("does not start a request after cancellation claimed the empty chat", async () => {
      await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
      await db.insert(chatMessage).values({
        chatId: threadId,
        createdAt: new Date(),
        id: foreground.exchangeId,
        parts: [{ type: "data-foreground-cancelled" }],
        position: 0,
        role: "assistant",
        userId,
      });

      await expect(
        createAiChatResponse({
          body: {
            category: "inbox",
            foreground,
            mailboxId: state.mailboxId,
            message: {
              id: crypto.randomUUID(),
              parts: [{ text: "Summarize my inbox", type: "text" }],
              role: "user",
            },
            model: "openai/gpt-5.6-luna",
            threadId,
            trigger: "submit-message",
          },
          request: new Request("https://example.test/api/chat"),
          userId,
        })
      ).rejects.toMatchObject({ status: 409 });
    });
  }
);
