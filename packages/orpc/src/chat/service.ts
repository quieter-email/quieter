import { ORPCError } from "@orpc/server";
import {
  createAiMemoryServerTool,
  createComposeEmailServerTool,
  createGoogleCalendarEventServerTool,
  createGmailAttachmentServerTool,
  createGmailLabelListServerTool,
  createGmailMessageServerTool,
  createGmailMessagesServerTool,
  createGmailSearchServerTool,
  createGmailThreadServerTool,
  createMailboxOverviewServerTool,
  createModifyMailServerTool,
  gmailToolsPrompt,
  googleCalendarToolsPrompt,
  linearToolsPrompt,
} from "@quieter/ai/chat-agent";
import type {
  AiMemoryToolsContext,
  ComposeEmailToolsContext,
  GmailToolsContext,
  GoogleCalendarToolsContext,
} from "@quieter/ai/chat-agent";
import { CHAT_TITLE_MODEL } from "@quieter/ai/chat-models";
import { createOpenRouterAdapter } from "@quieter/ai/openrouter";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { chat as chatTable, chatMessage } from "@quieter/database/schema";
import type {
  ChatMessagePart,
  ChatMessageResume,
  ChatMessageStatus,
} from "@quieter/database/schema";
import type { MailboxCategory } from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import {
  chat,
  EventType,
  maxIterations,
  modelMessagesToUIMessages,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import type {
  ChatMiddleware,
  Interrupt,
  MessagePart,
  ModelMessage,
  StreamChunk,
} from "@tanstack/ai";
import { and, desc, eq } from "drizzle-orm";
import { ZodError } from "zod";

import {
  learnAiMemoryFromSentMessage,
  loadAiAgentContext,
  requestAiMemoryUpdate,
  serializeAiAgentContext,
} from "../ai-memory";
import { createLinearMcpToolSource } from "../connectors/linear-mcp";
import {
  createGoogleCalendarEventForUser,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  hasConnectedConnector,
  LINEAR_CONNECTOR_PROVIDER,
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
  runAuthorizedGmailChatRequest,
} from "../gmail-chat-search";
import {
  saveGmailDraft,
  sendGmailMessage,
  toChatComposeInput,
} from "../gmail-compose";
import { assertAccessibleMailbox } from "../mailbox/service";
import { assertAiChatCredits } from "./access";
import {
  createChatTitle,
  toCanonicalTranscript,
  validateChatRequest,
} from "./request";
import type { ValidatedChatRequest } from "./request";

const CHAT_HISTORY_WINDOW_MESSAGES = 30;
const CHAT_MAX_ITERATIONS = 6;
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
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>
) => {
  const timeoutSignal = AbortSignal.timeout(MAIL_TOOL_TIMEOUT_MS);
  const signal = AbortSignal.any([requestSignal, timeoutSignal]);
  try {
    return await operation(signal);
  } catch (error) {
    if (!requestSignal.aborted && timeoutSignal.aborted) {
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

const createGmailTools = (input: {
  category: MailboxCategory;
  mailboxId: string;
  signal: AbortSignal;
  userId: string;
}) => {
  const run = async <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    await runMailTool(input.signal, operation);
  const context: GmailToolsContext = {
    category: input.category,
    getMailboxOverview: async () =>
      await run(
        async (signal) =>
          await getMailboxOverviewForUser({
            category: input.category,
            mailboxId: input.mailboxId,
            signal,
            userId: input.userId,
          })
      ),
    listGmailLabels: async () =>
      await run(
        async (signal) =>
          await listGmailLabelsForUser({
            category: input.category,
            mailboxId: input.mailboxId,
            signal,
            userId: input.userId,
          })
      ),
    modifyMail: async ({ action, id, target }) =>
      await run(
        async (signal) =>
          await modifyMailForUser({
            action,
            category: input.category,
            id,
            mailboxId: input.mailboxId,
            signal,
            target,
            userId: input.userId,
          })
      ),
    readGmailAttachment: async ({ attachmentId, messageId }) =>
      await run(
        async (signal) =>
          await readGmailAttachmentForUser({
            attachmentId,
            category: input.category,
            mailboxId: input.mailboxId,
            messageId,
            signal,
            userId: input.userId,
          })
      ),
    readGmailMessage: async ({ messageId }) =>
      await run(
        async (signal) =>
          await readGmailMessageForUser({
            category: input.category,
            mailboxId: input.mailboxId,
            messageId,
            signal,
            userId: input.userId,
          })
      ),
    readGmailMessages: async ({ messageIds }) =>
      await run(
        async (signal) =>
          await readGmailMessagesForUser({
            category: input.category,
            mailboxId: input.mailboxId,
            messageIds,
            signal,
            userId: input.userId,
          })
      ),
    readGmailThread: async ({ threadId }) =>
      await run(
        async (signal) =>
          await readGmailThreadForUser({
            category: input.category,
            mailboxId: input.mailboxId,
            signal,
            threadId,
            userId: input.userId,
          })
      ),
    searchGmail: async ({ maxResults, pageToken, query }) =>
      await run(
        async (signal) =>
          await searchGmailForUser({
            category: input.category,
            mailboxId: input.mailboxId,
            maxResults,
            pageToken,
            query,
            signal,
            userId: input.userId,
          })
      ),
  };

  return [
    createGmailAttachmentServerTool(context),
    createGmailLabelListServerTool(context),
    createGmailMessageServerTool(context),
    createGmailMessagesServerTool(context),
    createGmailSearchServerTool(context),
    createGmailThreadServerTool(context),
    createMailboxOverviewServerTool(context),
    createModifyMailServerTool(context),
  ];
};

const createComposeEmailTool = (input: {
  mailboxId: string;
  signal: AbortSignal;
  userId: string;
}) => {
  const context: ComposeEmailToolsContext = {
    composeEmail: async ({ action, ...message }) => {
      const composeInput = toChatComposeInput(message);
      return await runMailTool(
        input.signal,
        async (signal) =>
          await runAuthorizedGmailChatRequest(
            {
              mailboxId: input.mailboxId,
              signal,
              userId: input.userId,
            },
            async (accessToken) => {
              if (action === "save_draft") {
                const draft = await saveGmailDraft(
                  accessToken,
                  composeInput,
                  signal
                );
                return {
                  draftId: draft.draftId,
                  messageId: draft.messageId ?? undefined,
                  status: "draft_saved" as const,
                  subject: draft.subject,
                  to: draft.recipients.to,
                };
              }

              const sent = await sendGmailMessage(
                accessToken,
                composeInput,
                signal
              );
              await learnAiMemoryFromSentMessage({
                bodyText: message.bodyText,
                isReply: false,
                mailboxId: input.mailboxId,
                recipients: [message.to, message.cc, message.bcc].join(","),
                userId: input.userId,
              }).catch((error: unknown) => {
                reportError(error, {
                  operation: "chat:learn-from-sent-message",
                });
              });
              return {
                messageId: sent.id,
                status: "sent" as const,
                subject: message.subject,
                threadId: sent.threadId,
                to: message.to,
              };
            }
          )
      );
    },
  };
  return createComposeEmailServerTool(context);
};

const getLatestUserRequest = (
  messages: readonly { parts: MessagePart[]; role: string }[]
) =>
  messages
    .findLast((message) => message.role === "user")
    ?.parts.flatMap((part) =>
      part.type === "text" && typeof part.content === "string"
        ? [part.content]
        : []
    )
    .join(" ")
    .slice(0, 4000) ?? "";

const createMemoryTool = (input: {
  latestUserRequest: string;
  mailboxId: string;
  userId: string;
}) => {
  const context: AiMemoryToolsContext = {
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
  };
  return createAiMemoryServerTool(context);
};

const createCalendarTool = (input: { signal: AbortSignal; userId: string }) => {
  const context: GoogleCalendarToolsContext = {
    createGoogleCalendarEvent: async (event) =>
      await createGoogleCalendarEventForUser({
        event,
        signal: input.signal,
        userId: input.userId,
      }),
  };
  return createGoogleCalendarEventServerTool(context);
};

const getStoredMessageText = (parts: ChatMessagePart[]) =>
  parts
    .flatMap((part) =>
      part.type === "text" && typeof part.content === "string"
        ? [part.content]
        : []
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

const isRetryableAssistantMessage = (
  assistantMessage:
    | { createdAt: Date; id: string; status: ChatMessageStatus }
    | undefined,
  lastMessageId: string | undefined,
  now: Date
) =>
  assistantMessage !== undefined &&
  lastMessageId === assistantMessage.id &&
  (assistantMessage.status === "cancelled" ||
    assistantMessage.status === "failed" ||
    (assistantMessage.status === "streaming" &&
      now.getTime() - assistantMessage.createdAt.getTime() >=
        STALE_CHAT_TURN_MS));

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
            isRetryableAssistantMessage(assistantMessage, lastMessage?.id, now)
          ) {
            await tx
              .update(chatMessage)
              .set({
                createdAt: now,
                error: null,
                generationId,
                parts: [],
                resume: null,
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
            resume: null,
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
        parts: [{ content: input.text, type: "text" }],
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
        middleware: [
          {
            name: "polar-ai-chat-title-usage",
            onUsage: (usageContext, usage) => {
              usageContext.defer(
                reportAiUsage({
                  chatId: input.chatId,
                  completionTokens: usage.completionTokens,
                  costUsd: usage.cost,
                  externalId: `chat-title:${input.chatId}`,
                  mailboxId: input.mailboxId,
                  model: CHAT_TITLE_MODEL,
                  promptTokens: usage.promptTokens,
                  promptTokensDetails: usage.promptTokensDetails,
                  usageKind: "aiChat",
                  userId: input.userId,
                }).catch((error: unknown) => {
                  reportError(error, { operation: "chat:report-title-usage" });
                })
              );
            },
          },
        ],
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

const resumeChatTurn = async (input: {
  chatId: string;
  mailboxId: string;
  parentRunId: string;
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
      const [assistantMessage] = await tx
        .select({
          createdAt: chatMessage.createdAt,
          id: chatMessage.id,
          parts: chatMessage.parts,
          resume: chatMessage.resume,
          role: chatMessage.role,
          status: chatMessage.status,
        })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, input.chatId))
        .orderBy(desc(chatMessage.position))
        .limit(1);
      if (
        assistantMessage?.role !== "assistant" ||
        assistantMessage.status !== "complete" ||
        assistantMessage.resume?.resumeState.runId !== input.parentRunId
      ) {
        throw new ChatRequestError(
          409,
          "This approval is no longer waiting for a response."
        );
      }
      const generationId = crypto.randomUUID();
      const [updated] = await tx
        .update(chatMessage)
        .set({
          error: null,
          generationId,
          status: "streaming",
        })
        .where(
          and(
            eq(chatMessage.id, assistantMessage.id),
            eq(chatMessage.status, "complete")
          )
        )
        .returning({ id: chatMessage.id });
      if (updated === undefined) {
        throw new ChatRequestError(409, "The active chat answer changed.");
      }
      return {
        assistantMessageId: assistantMessage.id,
        generationId,
        resume: assistantMessage.resume,
        resumedAssistant: {
          createdAt: assistantMessage.createdAt,
          id: assistantMessage.id,
          parts: assistantMessage.parts,
          role: "assistant" as const,
        },
      };
    })
    .catch(toConflict);

const beginChatTurn = async (input: {
  request: ValidatedChatRequest;
  userId: string;
}) => {
  const { forwardedProps, threadId } = input.request;
  if (input.request.kind === "message") {
    const started = await startChatTurn({
      chatId: threadId,
      mailboxId: forwardedProps.mailboxId,
      messageId: input.request.userMessage.id,
      text: input.request.userMessage.text,
      userId: input.userId,
    });
    return {
      ...started,
      previousResume: null,
      resumedAssistant: undefined,
    };
  }
  const resumed = await resumeChatTurn({
    chatId: threadId,
    mailboxId: forwardedProps.mailboxId,
    parentRunId: input.request.parentRunId,
    userId: input.userId,
  });
  return {
    assistantMessageId: resumed.assistantMessageId,
    createdChat: false,
    generationId: resumed.generationId,
    previousResume: resumed.resume,
    resumedAssistant: resumed.resumedAssistant,
  };
};

const settleAssistantMessage = async (input: {
  assistantMessageId: string;
  chatId: string;
  error: string | null;
  generationId: string;
  mailboxId: string;
  parts: ChatMessagePart[];
  resume?: ChatMessageResume | null;
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
          resume: input.resume ?? null,
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

const toStoredParts = (parts: MessagePart[]): ChatMessagePart[] =>
  parts.map((part) => ({ ...part }));

const getCurrentTurnParts = (
  messages: readonly ModelMessage[],
  interrupts: readonly Interrupt[] = []
) => {
  const uiMessages = modelMessagesToUIMessages([...messages]);
  const lastUserIndex = uiMessages.findLastIndex(
    (message) => message.role === "user"
  );
  const parts = toStoredParts(
    uiMessages
      .slice(lastUserIndex + 1)
      .flatMap((message) => (message.role === "assistant" ? message.parts : []))
  );
  if (interrupts.length === 0) {
    return parts;
  }
  const approvals = new Map(
    interrupts.flatMap((interrupt) =>
      interrupt.toolCallId === undefined
        ? []
        : [[interrupt.toolCallId, interrupt.id] as const]
    )
  );
  return parts.map((part) => {
    if (part.type !== "tool-call" || typeof part.id !== "string") {
      return part;
    }
    const approvalId = approvals.get(part.id);
    return approvalId === undefined
      ? part
      : {
          ...part,
          approval: {
            id: approvalId,
            needsApproval: true,
          },
          state: "approval-requested",
        };
  });
};

const getResumeSnapshot = (
  chunk: StreamChunk,
  threadId: string
): ChatMessageResume | null => {
  if (
    chunk.type !== EventType.RUN_FINISHED ||
    chunk.outcome?.type !== "interrupt"
  ) {
    return null;
  }
  return {
    pendingInterrupts: chunk.outcome.interrupts,
    resumeState: { runId: chunk.runId, threadId },
  };
};
export const settleChatStreamBeforeTerminal =
  async function* settleChatStreamBeforeTerminal(
    stream: AsyncIterable<StreamChunk>
  ): AsyncGenerator<StreamChunk> {
    let terminalChunk: StreamChunk | undefined;
    for await (const chunk of stream) {
      if (terminalChunk !== undefined) {
        yield terminalChunk;
        terminalChunk = undefined;
      }
      if (
        chunk.type === EventType.RUN_FINISHED ||
        chunk.type === EventType.RUN_ERROR
      ) {
        terminalChunk = chunk;
      } else {
        yield chunk;
      }
    }
    if (terminalChunk !== undefined) {
      yield terminalChunk;
    }
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
  resumedAssistant?: {
    createdAt: Date;
    id: string;
    parts: ChatMessagePart[];
    role: "assistant";
  };
  threadId: string;
  userId: string;
}) => {
  const storedMessages = await loadCanonicalTranscript(input.threadId);
  const messages =
    input.resumedAssistant === undefined
      ? storedMessages
      : [...storedMessages, ...toCanonicalTranscript([input.resumedAssistant])];
  const memoryQuery = messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" ? [part.content] : []
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
    messages,
    serializedAiContext: serializeAiAgentContext(aiContext),
  };
};

const createUsageMiddleware = (input: {
  chatId: string;
  mailboxId: string;
  model: string;
  userId: string;
}): ChatMiddleware => {
  const usageId = crypto.randomUUID();
  let usageIndex = 0;
  return {
    name: "polar-ai-chat-usage",
    onUsage: (context, usage) => {
      const index = usageIndex;
      usageIndex += 1;
      context.defer(
        (async () => {
          try {
            await reportAiUsage({
              chatId: input.chatId,
              completionTokens: usage.completionTokens,
              costUsd: usage.cost,
              externalId: `${usageId}:${index}`,
              mailboxId: input.mailboxId,
              model: input.model,
              promptTokens: usage.promptTokens,
              promptTokensDetails: usage.promptTokensDetails,
              usageKind: "aiChat",
              userId: input.userId,
            });
          } catch (error: unknown) {
            reportError(error, { operation: "chat:report-ai-usage" });
          }
        })()
      );
    },
  };
};

// The request coordinates authorization, persistence, tool availability, and streaming in one boundary.
export const createAiChatResponse = async (input: {
  params: {
    forwardedProps: Record<string, unknown>;
    messages: readonly unknown[];
    parentRunId?: string;
    resume?: readonly unknown[];
    runId: string;
    threadId: string;
  };
  request: Request;
  userId: string;
}) => {
  let validated: ReturnType<typeof validateChatRequest>;
  try {
    validated = validateChatRequest(input.params);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ChatRequestError(400, "Invalid chat request.", {
        cause: error,
      });
    }
    throw error;
  }
  const { forwardedProps, runId, threadId } = validated;
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
  const adapter = createOpenRouterAdapter(forwardedProps.model);
  const {
    assistantMessageId,
    createdChat,
    generationId,
    previousResume,
    resumedAssistant,
  } = await beginChatTurn({ request: validated, userId: input.userId });
  if (validated.kind === "message" && createdChat) {
    generateChatTitleInBackground({
      chatId: threadId,
      fallbackTitle: createChatTitle(validated.userMessage.text),
      mailboxId: forwardedProps.mailboxId,
      prompt: validated.userMessage.text,
      userId: input.userId,
    });
  }
  let currentParts = resumedAssistant?.parts ?? [];
  let preparedContext: Awaited<ReturnType<typeof prepareChatContext>>;
  try {
    preparedContext = await prepareChatContext({
      context: forwardedProps.context ?? {},
      mailboxId: forwardedProps.mailboxId,
      ...(resumedAssistant === undefined ? {} : { resumedAssistant }),
      threadId,
      userId: input.userId,
    });
  } catch (error) {
    await settleAssistantMessage({
      assistantMessageId,
      chatId: threadId,
      error: "The answer could not be started.",
      generationId,
      mailboxId: forwardedProps.mailboxId,
      parts: currentParts,
      ...(previousResume === null ? {} : { resume: previousResume }),
      status: previousResume === null ? "failed" : "complete",
      userId: input.userId,
    });
    throw error;
  }
  const { mailboxContextPrompt, messages, serializedAiContext } =
    preparedContext;
  const checkConnector = async (
    provider:
      | typeof GOOGLE_CALENDAR_CONNECTOR_PROVIDER
      | typeof LINEAR_CONNECTOR_PROVIDER
  ) => {
    try {
      return await hasConnectedConnector({ provider, userId: input.userId });
    } catch (error) {
      reportError(error, { operation: `chat:inspect-${provider}-connector` });
      return false;
    }
  };
  const [hasGoogleCalendarConnector, hasLinearConnector] = await Promise.all([
    checkConnector(GOOGLE_CALENDAR_CONNECTOR_PROVIDER),
    checkConnector(LINEAR_CONNECTOR_PROVIDER),
  ]);
  const abortController = new AbortController();
  const abortRequest = () => {
    abortController.abort(input.request.signal.reason);
  };
  input.request.signal.addEventListener("abort", abortRequest, { once: true });
  if (input.request.signal.aborted) {
    abortRequest();
  }
  const persistenceMiddleware: ChatMiddleware = {
    name: "chat-message-persistence",
    onAbort: async (context) => {
      input.request.signal.removeEventListener("abort", abortRequest);
      currentParts = getCurrentTurnParts(context.messages);
      await settleAssistantMessage({
        assistantMessageId,
        chatId: threadId,
        error: null,
        generationId,
        mailboxId: forwardedProps.mailboxId,
        parts: currentParts,
        ...(previousResume === null ? {} : { resume: previousResume }),
        status: previousResume === null ? "cancelled" : "complete",
        userId: input.userId,
      });
    },
    onChunk: async (context, chunk) => {
      const resumeSnapshot = getResumeSnapshot(chunk, threadId);
      const interrupts =
        chunk.type === EventType.RUN_FINISHED &&
        chunk.outcome?.type === "interrupt"
          ? chunk.outcome.interrupts
          : [];
      currentParts = getCurrentTurnParts(context.messages, interrupts);
      if (resumeSnapshot !== null) {
        input.request.signal.removeEventListener("abort", abortRequest);
        await settleAssistantMessage({
          assistantMessageId,
          chatId: threadId,
          error: null,
          generationId,
          mailboxId: forwardedProps.mailboxId,
          parts: currentParts,
          resume: resumeSnapshot,
          status: "complete",
          userId: input.userId,
        });
      }
      return chunk;
    },
    onError: async (context, info) => {
      input.request.signal.removeEventListener("abort", abortRequest);
      reportError(info.error, { operation: "chat:generation" });
      currentParts = getCurrentTurnParts(context.messages);
      await settleAssistantMessage({
        assistantMessageId,
        chatId: threadId,
        error: "The answer could not be completed.",
        generationId,
        mailboxId: forwardedProps.mailboxId,
        parts: currentParts,
        ...(previousResume === null ? {} : { resume: previousResume }),
        status: previousResume === null ? "failed" : "complete",
        userId: input.userId,
      });
    },
    onFinish: async (context) => {
      input.request.signal.removeEventListener("abort", abortRequest);
      currentParts = getCurrentTurnParts(context.messages);
      await settleAssistantMessage({
        assistantMessageId,
        chatId: threadId,
        error: null,
        generationId,
        mailboxId: forwardedProps.mailboxId,
        parts: currentParts,
        status: "complete",
        userId: input.userId,
      });
    },
  };
  const tools = [
    ...createGmailTools({
      category: forwardedProps.category,
      mailboxId: forwardedProps.mailboxId,
      signal: abortController.signal,
      userId: input.userId,
    }),
    createComposeEmailTool({
      mailboxId: forwardedProps.mailboxId,
      signal: abortController.signal,
      userId: input.userId,
    }),
    createMemoryTool({
      latestUserRequest: getLatestUserRequest(messages),
      mailboxId: forwardedProps.mailboxId,
      userId: input.userId,
    }),
  ];
  if (hasGoogleCalendarConnector) {
    tools.push(
      createCalendarTool({
        signal: abortController.signal,
        userId: input.userId,
      })
    );
  }
  let stream: AsyncIterable<StreamChunk>;
  try {
    stream = chat({
      abortController,
      adapter,
      agentLoopStrategy: maxIterations(CHAT_MAX_ITERATIONS),
      messages,
      ...(hasLinearConnector
        ? {
            mcp: {
              clients: [
                createLinearMcpToolSource({
                  signal: abortController.signal,
                  userId: input.userId,
                }),
              ],
            },
          }
        : {}),
      middleware: [
        createUsageMiddleware({
          chatId: threadId,
          mailboxId: forwardedProps.mailboxId,
          model: forwardedProps.model,
          userId: input.userId,
        }),
        persistenceMiddleware,
      ],
      modelOptions: {
        maxCompletionTokens: CHAT_MAX_COMPLETION_TOKENS,
        parallelToolCalls: true,
        reasoning: { effort: "medium" },
      },
      ...(validated.kind === "resume"
        ? {
            parentRunId: validated.parentRunId,
            resume: validated.resume,
          }
        : {}),
      runId,
      systemPrompts: [
        gmailToolsPrompt,
        ...(mailboxContextPrompt === null ? [] : [mailboxContextPrompt]),
        ...(serializedAiContext === null
          ? []
          : [
              `The following user-authored instructions and learned memory were loaded through Quieter's authorized AI context. Follow them unless they conflict with the current request, safety rules, or verified mailbox data.\n\n${serializedAiContext}`,
            ]),
        ...(hasGoogleCalendarConnector ? [googleCalendarToolsPrompt] : []),
        ...(hasLinearConnector ? [linearToolsPrompt] : []),
      ],
      threadId,
      tools,
    });
  } catch (error) {
    // The turn is already persisted as streaming; a synchronous setup failure
    // (for example an invalid interrupt resume payload) must terminalize it or
    // the chat stays locked behind the one-streaming-per-chat constraint.
    await settleAssistantMessage({
      assistantMessageId,
      chatId: threadId,
      error: "The answer could not be started.",
      generationId,
      mailboxId: forwardedProps.mailboxId,
      parts: currentParts,
      ...(previousResume === null ? {} : { resume: previousResume }),
      status: previousResume === null ? "failed" : "complete",
      userId: input.userId,
    });
    throw error;
  }

  return toServerSentEventsResponse(settleChatStreamBeforeTerminal(stream), {
    abortController,
  });
};
