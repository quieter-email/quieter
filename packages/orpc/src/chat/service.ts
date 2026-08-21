import { ORPCError } from "@orpc/server";
import {
  createAiMemoryChatTool,
  createComposeEmailChatTool,
  createGmailChatTools,
  createGoogleCalendarChatTool,
  gmailToolsPrompt,
  googleCalendarToolsPrompt,
  linearToolsPrompt,
} from "@quieter/ai/chat-agent";
import type {
  AiMemoryToolsContext,
  GmailToolsContext,
} from "@quieter/ai/chat-agent";
import { CHAT_TITLE_MODEL } from "@quieter/ai/chat-models";
import { summarizeAiUsage } from "@quieter/ai/chat-usage";
import { createChatModel } from "@quieter/ai/openrouter";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { chat as chatTable, chatMessage } from "@quieter/database/schema";
import type {
  ChatMessagePart,
  ChatMessageStatus,
} from "@quieter/database/schema";
import type { MailboxCategory } from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import type { UIMessage } from "ai";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ZodError } from "zod";

import {
  loadAiAgentContext,
  requestAiMemoryUpdate,
  serializeAiAgentContext,
} from "../ai-memory";
import {
  createGoogleCalendarEventForUser,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  hasConnectedConnector,
} from "../connectors/runtime";
import {
  getMailboxOverviewForUser,
  listGmailLabelsForUser,
  modifyMailForUser,
  readGmailAttachmentForUser,
  readGmailMessageForUser,
  readGmailMessagesForUser,
  readGmailThreadForUser,
  searchGmailForUser,
} from "../gmail-chat-search";
import { assertAccessibleMailbox } from "../mailbox/service";
import { assertAiChatCredits } from "./access";
import { createLinearChatTools } from "./linear-tools";
import {
  createChatTitle,
  toCanonicalTranscript,
  validateChatRequest,
} from "./request";
import type { ValidatedChatRequest } from "./request";

const CHAT_HISTORY_WINDOW_MESSAGES = 30;
const CHAT_MAX_STEPS = 6;
const CHAT_MAX_COMPLETION_TOKENS = 2048;
const MAIL_TOOL_TIMEOUT_MS = 25_000;
const STALE_CHAT_TURN_MS = 10 * 60 * 1000;

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

const getPostgresErrorField = (
  error: unknown,
  field: "code" | "constraint"
): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(error, field);
  if (typeof value === "string") {
    return value;
  }
  return getPostgresErrorField(Reflect.get(error, "cause"), field);
};

const isUniqueConflict = (error: unknown) =>
  getPostgresErrorField(error, "code") === "23505";

const toConflict = (error: unknown): never => {
  if (isUniqueConflict(error)) {
    const constraint = getPostgresErrorField(error, "constraint");
    let message =
      "The chat changed while this message was being saved. Retry the request.";
    if (constraint === "chat_message_one_streaming_per_chat") {
      message = "An answer is already in progress for this chat.";
    } else if (
      constraint === "chat_message_id_chat_id_unique" ||
      constraint === "chatMessage_pkey"
    ) {
      message = "This chat message has already been submitted.";
    }
    throw new ChatRequestError(409, message, { cause: error });
  }
  throw error;
};

const assertCanUseAiCredits = async (input: {
  organizationId: string;
  userId: string;
}) => {
  try {
    await assertAiChatCredits({
      organizationId: input.organizationId,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      throw new ChatRequestError(error.status, error.message, { cause: error });
    }
    throw error;
  }
};

const runMailTool = async <T>(
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
) => {
  const timeoutSignal = AbortSignal.timeout(MAIL_TOOL_TIMEOUT_MS);
  const combined =
    signal === undefined
      ? timeoutSignal
      : AbortSignal.any([signal, timeoutSignal]);
  try {
    return await operation(combined);
  } catch (error) {
    if (signal?.aborted !== true && timeoutSignal.aborted) {
      throw new Error(
        "The mail lookup timed out. Retry with a narrower search.",
        { cause: error }
      );
    }
    throw error;
  }
};

const buildMailboxContextPrompt = (context: {
  messageId?: string;
  query?: string;
  threadId?: string;
}) => {
  const entries = [
    context.messageId === undefined
      ? null
      : `Selected message id: ${context.messageId}`,
    context.threadId === undefined
      ? null
      : `Selected thread id: ${context.threadId}`,
    context.query === undefined
      ? null
      : `Open mailbox search: ${context.query}`,
  ].filter((entry): entry is string => entry !== null);
  if (entries.length === 0) {
    return null;
  }
  return `The user opened chat from this mailbox context:\n${entries
    .map((entry) => `- ${entry}`)
    .join(
      "\n"
    )}\nTreat these identifiers only as navigation hints. Retrieve live data before answering about them.`;
};

const createGmailToolsContext = (input: {
  category: MailboxCategory;
  mailboxId: string;
  userId: string;
}): GmailToolsContext => ({
  category: input.category,
  getMailboxOverview: async (signal) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await getMailboxOverviewForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  listGmailLabels: async (signal) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await listGmailLabelsForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  modifyMail: async ({ action, id, signal, target }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await modifyMailForUser({
          action,
          category: input.category,
          id,
          mailboxId: input.mailboxId,
          signal: runSignal,
          target,
          userId: input.userId,
        })
    ),
  readGmailAttachment: async ({ attachmentId, messageId, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailAttachmentForUser({
          attachmentId,
          category: input.category,
          mailboxId: input.mailboxId,
          messageId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  readGmailMessage: async ({ messageId, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailMessageForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          messageId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  readGmailMessages: async ({ messageIds, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailMessagesForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          messageIds,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  readGmailThread: async ({ signal, threadId }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailThreadForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          signal: runSignal,
          threadId,
          userId: input.userId,
        })
    ),
  searchGmail: async ({ maxResults, pageToken, query, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await searchGmailForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          maxResults,
          pageToken,
          query,
          signal: runSignal,
          userId: input.userId,
        })
    ),
});

const getLatestUserRequest = (transcript: readonly UIMessage[]) =>
  transcript
    .findLast((message) => message.role === "user")
    ?.parts.flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : []
    )
    .join(" ")
    .slice(0, 4000) ?? "";

const createMemoryToolContext = (input: {
  latestUserRequest: string;
  mailboxId: string;
  userId: string;
}): AiMemoryToolsContext => ({
  useMemory: async ({ request, scope }) => {
    if (input.latestUserRequest.trim() === "") {
      return { status: "skipped" };
    }
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });
    const requestedScopes =
      scope === "both"
        ? (["user", "mailbox"] as const)
        : ([scope === "personal" ? "user" : "mailbox"] as const);
    const answers = await Promise.all(
      requestedScopes.map(async (requestedScope) => {
        const canMutate =
          scope !== "both" &&
          (requestedScope === "user" ||
            selectedMailbox.capabilities.canManageKnowledge);
        const result = await requestAiMemoryUpdate({
          allowMutations: canMutate,
          changeSetSource: "chat",
          mailboxId: input.mailboxId,
          request,
          scope: requestedScope,
          userId: input.userId,
          userMessage: input.latestUserRequest,
        });
        return {
          answer: result.answer,
          changed: result.status === "applied",
          scope: requestedScope,
        };
      })
    );
    return {
      answer: answers
        .map(({ answer, scope: answerScope }) =>
          answers.length === 1
            ? answer
            : `${answerScope === "user" ? "Personal" : "This mailbox"}: ${answer}`
        )
        .join("\n\n"),
      status: answers.some(({ changed }) => changed)
        ? ("updated" as const)
        : ("answered" as const),
    };
  },
});

const getStoredMessageText = (parts: ChatMessagePart[]) =>
  parts
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : []
    )
    .join("");

const isMatchingUserMessage = (
  message: {
    chatId: string;
    parts: ChatMessagePart[];
    role: "assistant" | "system" | "user";
    userId: string;
  },
  input: { chatId: string; text: string; userId: string }
) =>
  message.chatId === input.chatId &&
  message.userId === input.userId &&
  message.role === "user" &&
  getStoredMessageText(message.parts) === input.text;

const isStaleStreamingMessage = (
  message: { createdAt: Date; status: ChatMessageStatus },
  now: Date
) =>
  message.status === "streaming" &&
  now.getTime() - message.createdAt.getTime() >= STALE_CHAT_TURN_MS;

const startChatTurn = async (input: {
  chatId: string;
  mailboxId: string;
  messageId: string;
  text: string;
  userId: string;
}) =>
  await db
    .transaction(async (tx) => {
      const generationId = crypto.randomUUID();
      const [existingChat] = await tx
        .select({
          id: chatTable.id,
          mailboxId: chatTable.mailboxId,
          title: chatTable.title,
          userId: chatTable.userId,
        })
        .from(chatTable)
        .where(eq(chatTable.id, input.chatId))
        .limit(1)
        .for("update");
      const now = new Date();
      if (existingChat === undefined) {
        await tx.insert(chatTable).values({
          createdAt: now,
          id: input.chatId,
          mailboxId: input.mailboxId,
          title: createChatTitle(input.text),
          updatedAt: now,
          userId: input.userId,
        });
      } else if (
        existingChat.mailboxId !== input.mailboxId ||
        existingChat.userId !== input.userId
      ) {
        throw new ChatRequestError(404, "Chat not found.");
      }
      const [lastMessage] = await tx
        .select({
          createdAt: chatMessage.createdAt,
          id: chatMessage.id,
          position: chatMessage.position,
          role: chatMessage.role,
          status: chatMessage.status,
        })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, input.chatId))
        .orderBy(desc(chatMessage.position))
        .limit(1);
      const [persistedMessage] = await tx
        .select({
          chatId: chatMessage.chatId,
          parts: chatMessage.parts,
          position: chatMessage.position,
          role: chatMessage.role,
          userId: chatMessage.userId,
        })
        .from(chatMessage)
        .where(eq(chatMessage.id, input.messageId))
        .limit(1);
      if (persistedMessage !== undefined) {
        if (isMatchingUserMessage(persistedMessage, input)) {
          const [assistantMessage] = await tx
            .select({
              createdAt: chatMessage.createdAt,
              id: chatMessage.id,
              status: chatMessage.status,
            })
            .from(chatMessage)
            .where(
              and(
                eq(chatMessage.chatId, input.chatId),
                eq(chatMessage.position, persistedMessage.position + 1),
                eq(chatMessage.role, "assistant")
              )
            )
            .limit(1);
          if (
            assistantMessage !== undefined &&
            lastMessage?.id === assistantMessage.id &&
            (assistantMessage.status === "cancelled" ||
              assistantMessage.status === "failed" ||
              (assistantMessage.status === "streaming" &&
                now.getTime() - assistantMessage.createdAt.getTime() >=
                  STALE_CHAT_TURN_MS))
          ) {
            await tx
              .update(chatMessage)
              .set({
                createdAt: now,
                error: null,
                generationId,
                parts: [],
                status: "streaming",
              })
              .where(eq(chatMessage.id, assistantMessage.id));
            await tx
              .update(chatTable)
              .set({ updatedAt: now })
              .where(eq(chatTable.id, input.chatId));
            return {
              assistantMessageId: assistantMessage.id,
              createdChat: false,
              generationId,
            };
          }
          if (assistantMessage?.status === "streaming") {
            throw new ChatRequestError(
              409,
              "An answer is already in progress for this chat."
            );
          }
          throw new ChatRequestError(
            409,
            "This chat message already has an answer."
          );
        }
        throw new ChatRequestError(
          409,
          "This chat message id has already been used."
        );
      }
      if (lastMessage?.status === "streaming") {
        if (!isStaleStreamingMessage(lastMessage, now)) {
          throw new ChatRequestError(
            409,
            "An answer is already in progress for this chat."
          );
        }
        await tx
          .update(chatMessage)
          .set({
            error: "The answer was interrupted.",
            generationId: null,
            status: "failed",
          })
          .where(eq(chatMessage.id, lastMessage.id));
      }
      if (lastMessage?.role === "user") {
        throw new ChatRequestError(
          409,
          "The previous chat turn is incomplete. Retry it before sending another message."
        );
      }
      const assistantMessageId = crypto.randomUUID();
      const userPosition = (lastMessage?.position ?? -1) + 1;
      await tx.insert(chatMessage).values({
        chatId: input.chatId,
        createdAt: now,
        error: null,
        id: input.messageId,
        parts: [{ text: input.text, type: "text" }],
        position: userPosition,
        role: "user",
        status: "complete",
        userId: input.userId,
      });
      await tx.insert(chatMessage).values({
        chatId: input.chatId,
        createdAt: now,
        error: null,
        generationId,
        id: assistantMessageId,
        parts: [],
        position: userPosition + 1,
        role: "assistant",
        status: "streaming",
        userId: input.userId,
      });
      await tx
        .update(chatTable)
        .set({
          title: existingChat?.title ?? createChatTitle(input.text),
          updatedAt: now,
        })
        .where(
          and(
            eq(chatTable.id, input.chatId),
            eq(chatTable.mailboxId, input.mailboxId),
            eq(chatTable.userId, input.userId)
          )
        );
      return {
        assistantMessageId,
        createdChat: existingChat === undefined,
        generationId,
      };
    })
    .catch(toConflict);

// The model title replaces the truncated fallback only while the user has not
// renamed the chat, and runs in the background so it never delays streaming.
const generateChatTitleInBackground = (input: {
  chatId: string;
  fallbackTitle: string;
  mailboxId: string;
  prompt: string;
  userId: string;
}) => {
  void (async () => {
    try {
      const { generateChatTitle } =
        await import("@quieter/ai/generate-chat-title");
      const title = await generateChatTitle({
        onUsage: (usage) => {
          void reportAiUsage({
            chatId: input.chatId,
            completionTokens: usage.completionTokens,
            costUsd: usage.costUsd,
            externalId: `chat-title:${input.chatId}`,
            mailboxId: input.mailboxId,
            model: CHAT_TITLE_MODEL,
            promptTokens: usage.promptTokens,
            promptTokensDetails: {
              cacheWriteTokens: usage.cacheWriteTokens,
              cachedTokens: usage.cachedTokens,
            },
            usageKind: "aiChat",
            userId: input.userId,
          }).catch((error: unknown) => {
            reportError(error, { operation: "chat:report-title-usage" });
          });
        },
        prompt: input.prompt,
      });
      if (title === "") {
        return;
      }
      // Only replace the fallback while the user has not renamed the chat.
      await db
        .update(chatTable)
        .set({ title })
        .where(
          and(
            eq(chatTable.id, input.chatId),
            eq(chatTable.title, input.fallbackTitle),
            eq(chatTable.userId, input.userId)
          )
        );
    } catch (error: unknown) {
      reportError(error, { operation: "chat:generate-title" });
    }
  })();
};

const isPendingToolPart = (part: unknown): boolean => {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const type: unknown = Reflect.get(part, "type");
  if (typeof type !== "string" || !type.startsWith("tool-")) {
    return false;
  }
  const toolCallId: unknown = Reflect.get(part, "toolCallId");
  if (typeof toolCallId !== "string") {
    return false;
  }
  const state: unknown = Reflect.get(part, "state");
  return state === "approval-requested" || state === "input-available";
};

const readApprovalId = (part: UIMessage["parts"][number]): string => {
  const approval: unknown = Reflect.get(part, "approval");
  if (
    typeof approval !== "object" ||
    approval === null ||
    !("id" in approval)
  ) {
    return crypto.randomUUID();
  }
  const id: unknown = Reflect.get(approval, "id");
  return typeof id === "string" ? id : crypto.randomUUID();
};

/**
 * Applies the client's approval decisions and compose outcomes onto the
 * canonical copy of the paused assistant message. The database stays the
 * source of truth; the client only contributes which pending item resolved
 * and how.
 */
const applyClientResolutions = (
  message: UIMessage,
  resolutions: {
    toolDecisions: Map<string, boolean>;
    toolOutputs: Map<string, unknown>;
  }
) => ({
  ...message,
  parts: message.parts.map((part): UIMessage["parts"][number] => {
    const type: unknown = Reflect.get(part, "type");
    if (typeof type !== "string" || !type.startsWith("tool-")) {
      return part;
    }
    const toolCallId: unknown = Reflect.get(part, "toolCallId");
    if (typeof toolCallId !== "string") {
      return part;
    }
    const state: unknown = Reflect.get(part, "state");
    const decision = resolutions.toolDecisions.get(toolCallId);
    if (decision !== undefined && state === "approval-requested") {
      // Part unions make this override awkward to express directly.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ...part,
        approval: {
          approved: decision,
          id: readApprovalId(part),
        },
        state: "approval-responded",
      } as unknown as UIMessage["parts"][number];
    }
    if (
      resolutions.toolOutputs.has(toolCallId) &&
      state === "input-available"
    ) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ...part,
        output: resolutions.toolOutputs.get(toolCallId),
        state: "output-available",
      } as unknown as UIMessage["parts"][number];
    }
    return part;
  }),
});

/**
 * Reopens a settled assistant message that ended waiting on the user. The
 * stored parts stay untouched until the continuation persists its outcome, so
 * an interrupted continuation simply returns to the paused state.
 */
const continueChatTurn = async (input: {
  assistantMessageId: string;
  chatId: string;
  mailboxId: string;
  toolDecisions: Map<string, boolean>;
  toolOutputs: Map<string, unknown>;
  userId: string;
}) => {
  const pendingParts = await db
    .select({ parts: chatMessage.parts, status: chatMessage.status })
    .from(chatMessage)
    .where(
      and(
        eq(chatMessage.id, input.assistantMessageId),
        eq(chatMessage.chatId, input.chatId)
      )
    )
    .limit(1);
  const [stored] = pendingParts;
  if (stored?.status !== "complete") {
    throw new ChatRequestError(
      409,
      "This approval is no longer waiting for a response."
    );
  }
  const pendingIds = new Set(
    stored.parts
      .filter(isPendingToolPart)
      .map((part) => String(Reflect.get(part, "toolCallId")))
  );
  const resolvesSomething =
    [...input.toolDecisions.keys()].some((toolCallId) =>
      pendingIds.has(toolCallId)
    ) ||
    [...input.toolOutputs.keys()].some((toolCallId) =>
      pendingIds.has(toolCallId)
    );
  if (!resolvesSomething) {
    throw new ChatRequestError(
      409,
      "This approval is no longer waiting for a response."
    );
  }

  const generationId = crypto.randomUUID();
  await db
    .transaction(async (tx) => {
      const [authorizedChat] = await tx
        .select({ id: chatTable.id })
        .from(chatTable)
        .where(
          and(
            eq(chatTable.id, input.chatId),
            eq(chatTable.mailboxId, input.mailboxId),
            eq(chatTable.userId, input.userId)
          )
        )
        .limit(1)
        .for("update");
      if (authorizedChat === undefined) {
        throw new ChatRequestError(404, "Chat not found.");
      }
      const [updated] = await tx
        .update(chatMessage)
        .set({
          error: null,
          generationId,
          status: "streaming",
        })
        .where(
          and(
            eq(chatMessage.id, input.assistantMessageId),
            eq(chatMessage.chatId, input.chatId),
            isNull(chatMessage.generationId),
            eq(chatMessage.status, "complete"),
            eq(chatMessage.userId, input.userId)
          )
        )
        .returning({ id: chatMessage.id });
      if (updated === undefined) {
        throw new ChatRequestError(409, "The active chat answer changed.");
      }
    })
    .catch(toConflict);
  return { assistantMessageId: input.assistantMessageId, generationId };
};

/**
 * Restarts a failed, cancelled, or stale answer. A completed answer is never
 * regenerated here; the client refetches instead of asking again.
 */
const regenerateChatTurn = async (input: {
  chatId: string;
  mailboxId: string;
  userId: string;
}) =>
  await db
    .transaction(async (tx) => {
      const [authorizedChat] = await tx
        .select({ id: chatTable.id })
        .from(chatTable)
        .where(
          and(
            eq(chatTable.id, input.chatId),
            eq(chatTable.mailboxId, input.mailboxId),
            eq(chatTable.userId, input.userId)
          )
        )
        .limit(1)
        .for("update");
      if (authorizedChat === undefined) {
        throw new ChatRequestError(404, "Chat not found.");
      }
      const now = new Date();
      const [lastMessage] = await tx
        .select({
          createdAt: chatMessage.createdAt,
          id: chatMessage.id,
          position: chatMessage.position,
          role: chatMessage.role,
          status: chatMessage.status,
        })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, input.chatId))
        .orderBy(desc(chatMessage.position))
        .limit(1);
      if (lastMessage === undefined) {
        throw new ChatRequestError(409, "There is no answer to retry yet.");
      }
      const generationId = crypto.randomUUID();
      if (lastMessage.role === "user") {
        const assistantMessageId = crypto.randomUUID();
        await tx.insert(chatMessage).values({
          chatId: input.chatId,
          createdAt: now,
          error: null,
          generationId,
          id: assistantMessageId,
          parts: [],
          position: lastMessage.position + 1,
          role: "assistant",
          status: "streaming",
          userId: input.userId,
        });
        return { assistantMessageId, generationId, removedAssistantId: null };
      }
      const retryable =
        lastMessage.status === "cancelled" ||
        lastMessage.status === "failed" ||
        isStaleStreamingMessage(lastMessage, now);
      if (!retryable) {
        throw new ChatRequestError(
          409,
          "This answer cannot be retried right now."
        );
      }
      await tx
        .update(chatMessage)
        .set({
          createdAt: now,
          error: null,
          generationId,
          parts: [],
          status: "streaming",
        })
        .where(eq(chatMessage.id, lastMessage.id));
      return {
        assistantMessageId: lastMessage.id,
        generationId,
        removedAssistantId: lastMessage.id,
      };
    })
    .catch(toConflict);

const settleAssistantMessage = async (input: {
  assistantMessageId: string;
  chatId: string;
  error: string | null;
  generationId: string;
  mailboxId: string;
  parts: ChatMessagePart[];
  status: "cancelled" | "complete" | "failed";
  userId: string;
}) => {
  await db
    .transaction(async (tx) => {
      const [authorizedChat] = await tx
        .select({ id: chatTable.id })
        .from(chatTable)
        .where(
          and(
            eq(chatTable.id, input.chatId),
            eq(chatTable.mailboxId, input.mailboxId),
            eq(chatTable.userId, input.userId)
          )
        )
        .limit(1)
        .for("update");
      if (authorizedChat === undefined) {
        throw new ChatRequestError(404, "Chat not found.");
      }
      const now = new Date();
      const [updatedMessage] = await tx
        .update(chatMessage)
        .set({
          error: input.error,
          generationId: null,
          parts: input.parts,
          status: input.status,
        })
        .where(
          and(
            eq(chatMessage.id, input.assistantMessageId),
            eq(chatMessage.chatId, input.chatId),
            eq(chatMessage.generationId, input.generationId),
            eq(chatMessage.userId, input.userId),
            eq(chatMessage.role, "assistant"),
            eq(chatMessage.status, "streaming")
          )
        )
        .returning({ id: chatMessage.id });
      if (updatedMessage === undefined) {
        throw new ChatRequestError(409, "The active chat answer changed.");
      }
      await tx
        .update(chatTable)
        .set({ updatedAt: now })
        .where(eq(chatTable.id, input.chatId));
    })
    .catch(toConflict);
};

const loadCanonicalTranscript = async (chatId: string) => {
  const messages = await db
    .select({
      createdAt: chatMessage.createdAt,
      id: chatMessage.id,
      parts: chatMessage.parts,
      role: chatMessage.role,
    })
    .from(chatMessage)
    .where(
      and(eq(chatMessage.chatId, chatId), eq(chatMessage.status, "complete"))
    )
    .orderBy(desc(chatMessage.position))
    .limit(CHAT_HISTORY_WINDOW_MESSAGES);
  return toCanonicalTranscript(messages.toReversed());
};

const prepareChatContext = async (input: {
  context: { messageId?: string; query?: string; threadId?: string };
  mailboxId: string;
  threadId: string;
  transcript: readonly UIMessage[];
  userId: string;
}) => {
  const memoryQuery = input.transcript
    .filter((message) => message.role === "user")
    .slice(-3)
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [part.text] : []
      )
    )
    .join(" ")
    .slice(0, 4000);
  const aiContext = await loadAiAgentContext({
    agent: "chat",
    mailboxId: input.mailboxId,
    query: memoryQuery,
    userId: input.userId,
  });
  return {
    mailboxContextPrompt: buildMailboxContextPrompt(input.context),
    serializedAiContext: serializeAiAgentContext(aiContext),
  };
};

// The request coordinates authorization, persistence, tool availability, and streaming in one boundary.
export const createAiChatResponse = async (input: {
  body: unknown;
  request: Request;
  userId: string;
}) => {
  let validated: ValidatedChatRequest;
  try {
    validated = validateChatRequest(input.body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ChatRequestError(400, "Invalid chat request.", {
        cause: error,
      });
    }
    throw error;
  }
  const { forwardedProps, threadId } = validated;
  let accessibleMailbox: Awaited<ReturnType<typeof assertAccessibleMailbox>>;
  try {
    accessibleMailbox = await assertAccessibleMailbox({
      mailboxId: forwardedProps.mailboxId,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      throw new ChatRequestError(404, "Mailbox not found.", { cause: error });
    }
    throw error;
  }
  if (accessibleMailbox.provider !== "gmail") {
    throw new ChatRequestError(400, "AI chat supports Gmail mailboxes only.");
  }
  await assertCanUseAiCredits({
    organizationId: accessibleMailbox.organizationId,
    userId: input.userId,
  });

  const storedTranscript = await loadCanonicalTranscript(threadId);
  let transcript: UIMessage[];
  let assistantMessageId: string;
  let createdChat = false;
  let generationId: string;

  if (validated.kind === "message") {
    const started = await startChatTurn({
      chatId: threadId,
      mailboxId: forwardedProps.mailboxId,
      messageId: validated.userMessage.id,
      text: validated.userMessage.text,
      userId: input.userId,
    });
    ({ assistantMessageId, createdChat, generationId } = started);
    transcript = [
      ...storedTranscript,
      {
        id: validated.userMessage.id,
        parts: [{ text: validated.userMessage.text, type: "text" }],
        role: "user",
      } satisfies UIMessage,
    ];
    if (createdChat) {
      generateChatTitleInBackground({
        chatId: threadId,
        fallbackTitle: createChatTitle(validated.userMessage.text),
        mailboxId: forwardedProps.mailboxId,
        prompt: validated.userMessage.text,
        userId: input.userId,
      });
    }
  } else if (validated.kind === "continue") {
    const continued = await continueChatTurn({
      assistantMessageId: validated.assistantMessageId,
      chatId: threadId,
      mailboxId: forwardedProps.mailboxId,
      toolDecisions: validated.toolDecisions,
      toolOutputs: validated.toolOutputs,
      userId: input.userId,
    });
    ({ assistantMessageId, generationId } = continued);
    transcript = storedTranscript.map((message, index) =>
      index === storedTranscript.length - 1 &&
      message.role === "assistant" &&
      message.id === validated.assistantMessageId
        ? applyClientResolutions(message, validated)
        : message
    );
  } else {
    const regenerated = await regenerateChatTurn({
      chatId: threadId,
      mailboxId: forwardedProps.mailboxId,
      userId: input.userId,
    });
    ({ assistantMessageId, generationId } = regenerated);
    transcript =
      regenerated.removedAssistantId === null
        ? storedTranscript
        : storedTranscript.filter(
            (message) => message.id !== regenerated.removedAssistantId
          );
  }

  let preparedContext: Awaited<ReturnType<typeof prepareChatContext>>;
  try {
    preparedContext = await prepareChatContext({
      context: forwardedProps.context ?? {},
      mailboxId: forwardedProps.mailboxId,
      threadId,
      transcript,
      userId: input.userId,
    });
  } catch (error) {
    await settleAssistantMessage({
      assistantMessageId,
      chatId: threadId,
      error: "The answer could not be started.",
      generationId,
      mailboxId: forwardedProps.mailboxId,
      parts: [],
      status: "failed",
      userId: input.userId,
    });
    throw error;
  }
  const { mailboxContextPrompt, serializedAiContext } = preparedContext;

  const latestUserRequest = getLatestUserRequest(transcript);
  const checkConnector = async (
    provider: typeof GOOGLE_CALENDAR_CONNECTOR_PROVIDER
  ) => {
    try {
      return await hasConnectedConnector({ provider, userId: input.userId });
    } catch (error) {
      reportError(error, { operation: `chat:inspect-${provider}-connector` });
      return false;
    }
  };
  const hasGoogleCalendarConnector = await checkConnector(
    GOOGLE_CALENDAR_CONNECTOR_PROVIDER
  );

  const gmailContext = createGmailToolsContext({
    category: forwardedProps.category,
    mailboxId: forwardedProps.mailboxId,
    userId: input.userId,
  });
  const tools = {
    ...createGmailChatTools(gmailContext),
    ...createComposeEmailChatTool(),
    ...createAiMemoryChatTool(
      createMemoryToolContext({
        latestUserRequest,
        mailboxId: forwardedProps.mailboxId,
        userId: input.userId,
      })
    ),
    ...createLinearChatTools({
      latestUserRequest,
      userId: input.userId,
    }),
    ...(hasGoogleCalendarConnector
      ? createGoogleCalendarChatTool({
          createGoogleCalendarEvent: async (event, signal) =>
            await createGoogleCalendarEventForUser({
              event,
              signal,
              userId: input.userId,
            }),
        })
      : {}),
  };

  const systemPrompt = [
    gmailToolsPrompt,
    ...(mailboxContextPrompt === null ? [] : [mailboxContextPrompt]),
    ...(serializedAiContext === null
      ? []
      : [
          `The following user-authored instructions and learned memory were loaded through Quieter's authorized AI context. Follow them unless they conflict with the current request, safety rules, or verified mailbox data.\n\n${serializedAiContext}`,
        ]),
    ...(hasGoogleCalendarConnector ? [googleCalendarToolsPrompt] : []),
    linearToolsPrompt,
  ].join("\n\n");

  const usageId = crypto.randomUUID();
  let generationFailed = false;
  const modelMessages = await convertToModelMessages(transcript);
  const startGeneration = () =>
    streamText({
      abortSignal: input.request.signal,
      instructions: systemPrompt,
      maxOutputTokens: CHAT_MAX_COMPLETION_TOKENS,
      messages: modelMessages,
      model: createChatModel(forwardedProps.model),
      onEnd: ({ steps }) => {
        const usage = summarizeAiUsage({ steps });
        void (async () => {
          try {
            await reportAiUsage({
              chatId: threadId,
              completionTokens: usage.completionTokens,
              costUsd: usage.costUsd,
              externalId: `${usageId}:${assistantMessageId}`,
              mailboxId: forwardedProps.mailboxId,
              model: forwardedProps.model,
              promptTokens: usage.promptTokens,
              promptTokensDetails: {
                cacheWriteTokens: usage.cacheWriteTokens,
                cachedTokens: usage.cachedTokens,
              },
              usageKind: "aiChat",
              userId: input.userId,
            });
          } catch (error: unknown) {
            reportError(error, { operation: "chat:report-ai-usage" });
          }
        })();
      },
      onError: ({ error }) => {
        generationFailed = true;
        reportError(error, { operation: "chat:generation" });
      },
      providerOptions: {
        openrouter: {
          reasoning: {
            effort: "medium",
          },
        },
      },
      stopWhen: isStepCount(CHAT_MAX_STEPS),
      toolApproval: {
        ...(hasGoogleCalendarConnector
          ? { create_google_calendar_event: "user-approval" as const }
          : {}),
        linear_write: "user-approval" as const,
        memory: "user-approval" as const,
        modify_mail: "user-approval" as const,
      },
      tools,
    });
  let result: ReturnType<typeof startGeneration>;
  try {
    result = startGeneration();
  } catch (error) {
    // The turn is already persisted as streaming; a synchronous setup failure
    // must terminalize it or the chat stays locked behind the
    // one-streaming-per-chat constraint.
    await settleAssistantMessage({
      assistantMessageId,
      chatId: threadId,
      error: "The answer could not be started.",
      generationId,
      mailboxId: forwardedProps.mailboxId,
      parts: [],
      status: "failed",
      userId: input.userId,
    });
    throw error;
  }

  // Keep consuming after a client disconnect so the turn still settles in the
  // database and other devices see a consistent transcript.
  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      generateMessageId: () => assistantMessageId,
      onEnd: async ({ isAborted, messages }) => {
        const responseMessage = messages.at(-1);
        if (responseMessage?.role !== "assistant") {
          return;
        }
        const awaitsUserAction = responseMessage.parts.some(isPendingToolPart);
        let status: "cancelled" | "complete" | "failed" = "complete";
        if (isAborted) {
          status = "cancelled";
        } else if (generationFailed) {
          status = "failed";
        }
        try {
          await settleAssistantMessage({
            assistantMessageId,
            chatId: threadId,
            error:
              status === "failed" ? "The answer could not be completed." : null,
            generationId,
            mailboxId: forwardedProps.mailboxId,
            parts: responseMessage.parts,
            status:
              awaitsUserAction && status === "complete" ? "complete" : status,
            userId: input.userId,
          });
        } catch (error) {
          if (!(error instanceof ChatRequestError)) {
            reportError(error, { operation: "chat:settle-assistant-message" });
          }
        }
      },
      onError: () => "The answer could not be completed.",
      originalMessages: transcript,
      stream: result.stream,
    }),
  });
};
