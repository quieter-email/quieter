import type { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import {
  chat,
  chatMessage,
  gmailCapturedMessage,
  mailbox,
  organization,
  user,
} from "@quieter/database/schema";
import { analyzeMailMessage } from "@quieter/mail/capture";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
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
import type {
  listLinearMcpToolsForUser,
  runLinearMcpToolCallsForUser,
} from "../src/connectors/linear-mcp";
import type {
  getLinearConnectionForUser,
  hasConnectedConnector,
} from "../src/connectors/runtime";
import type { modifyMailForUser } from "../src/gmail-chat-search";
import type { composeMailOperations } from "../src/mail/compose";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const state = vi.hoisted(() => ({
  context: vi.fn<typeof AiMemoryModule.loadAiAgentContext>(),
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  learn: vi.fn<typeof AiMemoryModule.learnAiMemoryFromChatMessage>(),
  linear: vi.fn<typeof runLinearMcpToolCallsForUser>(),
  linearList: vi.fn<typeof listLinearMcpToolsForUser>(),
  mailboxId: crypto.randomUUID(),
  model: vi.fn<() => MockLanguageModelV4>(),
  modify: vi.fn<typeof modifyMailForUser>(),
  organizationId: crypto.randomUUID(),
  otherMailboxId: crypto.randomUUID(),
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
  loadAiAgentContext: state.context,
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
  getLinearConnectionForUser: vi
    .fn<typeof getLinearConnectionForUser>()
    .mockResolvedValue({
      account: "user@example.test",
      connectionId: "connection-1",
      workspace: "Test workspace",
    }),
  hasConnectedConnector: vi
    .fn<typeof hasConnectedConnector>()
    .mockResolvedValue(false),
}));
vi.mock(import("../src/connectors/linear-mcp"), async (original) => ({
  ...(await original()),
  listLinearMcpToolsForUser: state.linearList,
  runLinearMcpToolCallsForUser: state.linear,
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
      await db.insert(mailbox).values(
        [state.mailboxId, state.otherMailboxId].map((id) => ({
          accessMode: "private" as const,
          createdAt: now,
          emailAddress: `${id}@example.com`,
          id,
          organizationId: state.organizationId,
          ownerUserId: userId,
          provider: "gmail" as const,
          updatedAt: now,
        }))
      );
    });
    beforeEach(async () => {
      state.context
        .mockReset()
        .mockResolvedValue({ instructions: null, memory: null });
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
          parts: [
            { text: "Archive this email", type: "text" },
            { foreground, type: "data-foreground" },
          ],
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
      state.linearList
        .mockReset()
        .mockResolvedValue([{ name: "create_issue" }]);
      state.linear.mockReset().mockResolvedValue([
        {
          durationMs: 1,
          output: { id: "issue-1" },
          status: "success",
          toolName: "create_issue",
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
      toolName: "modify_mail" | "send_mail" | "linear_write" = "modify_mail",
      approvalId = "approval",
      approved = true
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
                approval: { approved, id: approvalId },
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

    test.each([
      { attached: false, workspace: "mail" },
      { attached: true, workspace: "mail" },
      { attached: false, workspace: "calendar" },
      { attached: true, workspace: "calendar" },
    ] as const)(
      "$workspace recalls personal context with explicit mail attachment $attached",
      async ({ attached, workspace }) => {
        await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
        const selectedThreadId = `selected-${crypto.randomUUID()}`;
        const snapshot: CapturedMailSnapshot = {
          attachments: [],
          bodyHtml: null,
          bodyText: "Retained message body must not enter chat preparation.",
          headers: [
            {
              name: "fRoM",
              value: "=?UTF-8?Q?Sam_Sch=C3=B6ne?= <sam@example.test>",
            },
            { name: "To", value: "User <user@example.test>" },
            { name: "Date", value: new Date().toUTCString() },
          ],
          id: crypto.randomUUID(),
          internalDate: attached ? null : String(Date.now()),
          labelIds: ["INBOX"],
          providerRevision: "1",
          threadId: selectedThreadId,
          truncation: {
            attachments: false,
            bodyHtml: false,
            bodyText: false,
            headers: false,
          },
        };
        const now = new Date();
        await db.insert(gmailCapturedMessage).values(
          [state.mailboxId, state.otherMailboxId].map((mailboxId) => {
            const message = {
              ...snapshot,
              ...(mailboxId === state.otherMailboxId
                ? { headers: [{ name: "From", value: "other@example.test" }] }
                : {}),
            };
            return {
              analysis: analyzeMailMessage(message),
              capturedAt: now,
              mailboxId,
              messageId: message.id,
              providerRevision: message.providerRevision,
              snapshot: message,
              source: "history" as const,
              updatedAt: now,
            };
          })
        );
        const memory = "Use a formal tone with Sam.";
        const otherMemory = "Use a casual tone with the other inbox sender.";
        const personalMemory = "Leave a recovery break after long meetings.";
        // oxlint-disable-next-line eslint/require-await -- The async loader stub returns an in-memory fixture.
        state.context.mockImplementation(async ({ mailboxId, query }) => ({
          instructions: null,
          memory:
            [
              mailboxId === undefined ? personalMemory : null,
              query.includes("Sam Schöne <sam@example.test>") ? memory : null,
              query.includes("other@example.test") ? otherMemory : null,
            ]
              .filter(Boolean)
              .join("\n") || null,
        }));
        const model = new MockLanguageModelV4({
          doStream: {
            stream: convertArrayToReadableStream([
              { type: "stream-start", warnings: [] },
              { id: "answer", type: "text-start" },
              {
                delta: "I can help plan your day.",
                id: "answer",
                type: "text-delta",
              },
              { id: "answer", type: "text-end" },
              {
                finishReason: { raw: undefined, unified: "stop" },
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
        });
        state.model.mockReturnValue(model);
        const messageText =
          workspace === "calendar" && attached
            ? "Remember that I prefer meetings after lunch. Help me plan my day."
            : "Help me plan my day";
        const response = await createAiChatResponse({
          body: {
            category: "inbox",
            context: attached ? { threadId: selectedThreadId } : undefined,
            foreground: { ...foreground, selectedThreadId, workspace },
            mailboxId: state.mailboxId,
            message: {
              id: crypto.randomUUID(),
              parts: [{ text: messageText, type: "text" }],
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

        const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
        expect(prompt.includes(selectedThreadId)).toBe(attached);
        expect(prompt.includes(memory)).toBe(workspace === "mail" || attached);
        expect(prompt.includes(personalMemory)).toBe(workspace === "calendar");
        expect(prompt).not.toContain(otherMemory);
        expect(prompt).not.toContain(snapshot.bodyText);
        expect(state.learn).toHaveBeenCalledWith(
          expect.objectContaining({
            bodyText: messageText,
            mailboxId: state.mailboxId,
            userId,
          })
        );
        expect(
          state.context.mock.calls.some(([context]) =>
            context.query.includes("sam@example.test")
          )
        ).toBe(workspace === "mail" || attached);
      }
    );

    test("prefetches recent thread correspondents by message date across retained history", async () => {
      await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
      const selectedThreadId = `selected-${crypto.randomUUID()}`;
      const correspondents = [
        { address: "stale@example.test", date: "2026-01-01T12:00:00Z" },
        { address: "older@example.test", date: "2026-02-01T12:00:00Z" },
        { address: "prior@example.test", date: "2026-03-01T12:00:00Z" },
        { address: "april@example.test", date: "2026-04-01T12:00:00Z" },
        { address: "may@example.test", date: "2026-05-01T12:00:00Z" },
        { address: "recent@example.test", date: "2026-06-01T12:00:00Z" },
        {
          address: "header-date@example.test",
          date: "2026-07-01T12:00:00Z",
          internalDate: null,
        },
        {
          address: "malformed@example.test",
          date: "invalid date",
          internalDate: "9".repeat(256),
        },
        {
          address: "infinite@example.test",
          date: "infinity",
          internalDate: null,
        },
        {
          address: "undated@example.test",
          date: "invalid date",
          internalDate: null,
        },
      ];
      await db.insert(gmailCapturedMessage).values(
        correspondents.map((correspondent, position) => {
          const snapshot: CapturedMailSnapshot = {
            attachments: [],
            bodyHtml: null,
            bodyText: "Retained bodies stay outside correspondent context.",
            headers: [
              { name: "From", value: correspondent.address },
              {
                name: "Date",
                value: Number.isNaN(Date.parse(correspondent.date))
                  ? correspondent.date
                  : new Date(correspondent.date).toUTCString(),
              },
            ],
            id: crypto.randomUUID(),
            internalDate:
              correspondent.internalDate === undefined
                ? String(Date.parse(correspondent.date))
                : correspondent.internalDate,
            labelIds: ["SENT"],
            providerRevision: "1",
            threadId: selectedThreadId,
            truncation: {
              attachments: false,
              bodyHtml: false,
              bodyText: false,
              headers: false,
            },
          };
          const capturedAt = new Date(Date.UTC(2026, 9, 20 - position));
          return {
            analysis: analyzeMailMessage(snapshot),
            capturedAt,
            mailboxId: state.mailboxId,
            messageId: snapshot.id,
            providerRevision: snapshot.providerRevision,
            snapshot,
            source: "history" as const,
            updatedAt: capturedAt,
          };
        })
      );
      // oxlint-disable-next-line eslint/require-await -- The async loader stub returns an in-memory fixture.
      state.context.mockImplementation(async ({ query }) => ({
        instructions: null,
        memory: correspondents
          .filter(({ address }) => query.includes(address))
          .map(({ address }) => `Use a concise tone with ${address}.`)
          .join("\n"),
      }));
      const model = state.model();
      const response = await createAiChatResponse({
        body: {
          category: "inbox",
          foreground: { ...foreground, selectedThreadId },
          mailboxId: state.mailboxId,
          message: {
            id: crypto.randomUUID(),
            parts: [{ text: "Help me reply", type: "text" }],
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

      const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
      expect(prompt).toContain("recent@example.test");
      expect(prompt).toContain("header-date@example.test");
      expect(prompt).not.toContain(selectedThreadId);
      expect(prompt).not.toContain("Retained bodies");
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

    test("requests exact approval before a model-selected mailbox change", async () => {
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
      expect(stream).toContain("tool-approval-request");
      expect(state.modify).not.toHaveBeenCalled();
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
        input: { action: "archive", id: "email", target: "message" },
        state: "approval-requested",
      });
    });

    test("requires approval for an induced Linear write during a read-only request", async () => {
      await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
      state.model.mockReturnValue(
        new MockLanguageModelV4({
          doStream: {
            stream: convertArrayToReadableStream([
              { type: "stream-start", warnings: [] },
              {
                input: JSON.stringify({
                  arguments: {
                    teamId: "team-1",
                    title: "Untrusted requested change",
                  },
                  connectionId: "connection-1",
                  toolName: "create_issue",
                }),
                toolCallId: "induced-write",
                toolName: "linear_write",
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
            parts: [{ text: "Use @Linear to find my teams.", type: "text" }],
            role: "user",
          },
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId,
      });
      await expect(response.text()).resolves.toContain("tool-approval-request");
      expect(state.linear).not.toHaveBeenCalled();
    });

    test("preserves discovery through streamed approval and executes the reviewed Linear action", async () => {
      await db.delete(chatMessage).where(eq(chatMessage.chatId, threadId));
      const finish = {
        finishReason: { raw: undefined, unified: "tool-calls" as const },
        type: "finish" as const,
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
          outputTokens: { reasoning: 0, text: 1, total: 1 },
        },
      };
      state.model.mockReturnValue(
        new MockLanguageModelV4({
          doStream: [
            {
              stream: convertArrayToReadableStream([
                { type: "stream-start", warnings: [] },
                {
                  input: "{}",
                  toolCallId: "discovery",
                  toolName: "linear_list_tools",
                  type: "tool-call",
                },
                finish,
              ]),
            },
            {
              stream: convertArrayToReadableStream([
                { type: "stream-start", warnings: [] },
                {
                  input: JSON.stringify({
                    arguments: { teamId: "team-1", title: "Reviewed issue" },
                    connectionId: "connection-1",
                    toolName: "create_issue",
                  }),
                  toolCallId: "action",
                  toolName: "linear_write",
                  type: "tool-call",
                },
                finish,
              ]),
            },
            {
              stream: convertArrayToReadableStream([
                { type: "stream-start", warnings: [] },
                {
                  error: new Error("Model stopped after the approved tool"),
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
            parts: [{ text: "Use @Linear to create an issue.", type: "text" }],
            role: "user",
          },
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId,
      });
      await expect(response.text()).resolves.toContain("tool-approval-request");
      expect(state.linear).not.toHaveBeenCalled();
      const [stored] = await db
        .select()
        .from(chatMessage)
        .where(eq(chatMessage.id, assistantId));
      const decision = stored?.parts.find(
        (part) => part.toolCallId === "action"
      )?.approval;
      if (
        typeof decision !== "object" ||
        decision === null ||
        !("id" in decision) ||
        typeof decision.id !== "string"
      ) {
        throw new Error("Missing stored approval");
      }
      const continued = await continueAnswer(
        foreground,
        "linear_write",
        decision.id
      );
      await continued.text();
      expect(state.linear).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          connectionId: "connection-1",
          userId,
        })
      );
    });

    test("executes only the approved Linear operation against the reviewed connection once", async () => {
      const action = {
        arguments: { teamId: "team-1", title: "Reviewed issue" },
        connectionId: "connection-1",
        toolName: "create_issue",
      };
      await db
        .update(chatMessage)
        .set({
          parts: [
            { text: "Use @Linear to find my teams.", type: "text" },
            { foreground, type: "data-foreground" },
          ],
        })
        .where(eq(chatMessage.id, userMessageId));
      await db
        .update(chatMessage)
        .set({
          parts: [
            {
              foreground,
              input: {},
              output: {
                connection: {
                  account: "user@example.test",
                  connectionId: "connection-1",
                  workspace: "Test workspace",
                },
                status: "success",
                tools: [{ name: "create_issue" }],
              },
              state: "output-available",
              toolCallId: "discovery",
              type: "tool-linear_list_tools",
            },
            {
              approval: { id: "approval" },
              foreground,
              input: action,
              state: "approval-requested",
              toolCallId: "action",
              type: "tool-linear_write",
            },
          ],
        })
        .where(eq(chatMessage.id, assistantId));
      const response = await continueAnswer(foreground, "linear_write");
      await response.text();
      expect(state.linear).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          calls: [{ arguments: action.arguments, toolName: "create_issue" }],
          connectionId: "connection-1",
          userId,
        })
      );
      await expect(
        continueAnswer(foreground, "linear_write")
      ).rejects.toMatchObject({ status: 409 });
      expect(state.linear).toHaveBeenCalledOnce();
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

    test.each(["modify_mail", "linear_write"] as const)(
      "declining %s never calls its provider",
      async (toolName) => {
        if (toolName === "linear_write") {
          await db
            .update(chatMessage)
            .set({
              parts: [
                { text: "Use @Linear to find my teams.", type: "text" },
                { foreground, type: "data-foreground" },
              ],
            })
            .where(eq(chatMessage.id, userMessageId));
          await db
            .update(chatMessage)
            .set({
              parts: [
                {
                  approval: { id: "approval" },
                  foreground,
                  input: {
                    arguments: { teamId: "team-1", title: "Unapproved" },
                    connectionId: "connection-1",
                    toolName: "create_issue",
                  },
                  state: "approval-requested",
                  toolCallId: "action",
                  type: "tool-linear_write",
                },
              ],
            })
            .where(eq(chatMessage.id, assistantId));
        }
        const response = await continueAnswer(
          foreground,
          toolName,
          "approval",
          false
        );
        await response.text();
        expect(state.linear).not.toHaveBeenCalled();
        expect(state.modify).not.toHaveBeenCalled();
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
