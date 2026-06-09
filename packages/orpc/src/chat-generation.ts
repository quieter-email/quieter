import {
  createGmailSearchServerTool,
  gmailSearchPrompt,
  runChatStream,
  type ChatMiddleware,
  type UIMessage,
} from "@quieter/ai";
import { reportAiUsage } from "@quieter/billing";
import {
  chat,
  chatMessage,
  chatRun,
  db,
  type ChatMessagePart,
  type ChatMessageStatus,
  type ChatRunStatus,
} from "@quieter/database";
import { isGmailServiceError, listMessagesWithDetails, type MailboxCategory } from "@quieter/gmail";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  getAuthorizedGmailMailbox,
  markGmailMailboxNeedsReconnect,
  refreshAuthorizedGmailAccessToken,
} from "./mailbox";

const ACTIVE_CHAT_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_on_tool",
] as const satisfies ChatRunStatus[];
const DRAFT_PERSIST_INTERVAL_MS = 400;
const CANCEL_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_ITERATIONS = 20;

const isGmailAuthError = (error: unknown) =>
  isGmailServiceError(error) &&
  error.status === 401 &&
  ((typeof error.googleReason === "string" && error.googleReason.toLowerCase() === "autherror") ||
    (typeof error.googleStatus === "string" &&
      error.googleStatus.toUpperCase() === "UNAUTHENTICATED"));

const searchGmailForUser = async (input: {
  category: MailboxCategory;
  mailboxId: string;
  maxResults: number;
  query: string;
  signal?: AbortSignal;
  userId: string;
}) => {
  const runSearch = async (accessToken: string) => {
    const result = await listMessagesWithDetails(accessToken, {
      mailbox: input.category,
      maxResults: input.maxResults,
      query: input.query,
      signal: input.signal,
    });

    return {
      category: input.category,
      messages: result.messages.map((message) => ({
        date: message.date ?? message.internalDate,
        from: message.from,
        id: message.id,
        isUnread: message.isUnread,
        labelIds: message.labelIds,
        snippet: message.snippet,
        subject: message.subject,
        threadId: message.threadId,
      })),
      query: input.query,
      resultSizeEstimate: result.resultSizeEstimate,
    };
  };

  const { accessToken, mailbox } = await getAuthorizedGmailMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });

  try {
    return await runSearch(accessToken);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      throw error;
    }

    const refreshedAccessToken = await refreshAuthorizedGmailAccessToken({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });

    try {
      return await runSearch(refreshedAccessToken);
    } catch (retryError) {
      if (isGmailAuthError(retryError)) {
        await markGmailMailboxNeedsReconnect(mailbox.id);
      }

      throw retryError;
    }
  }
};

const getTextContent = (parts: ChatMessagePart[]) =>
  parts
    .flatMap((part) =>
      part.type === "text" && "content" in part && typeof part.content === "string"
        ? [part.content]
        : [],
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const toUiMessages = (
  messages: Array<{
    createdAt: Date;
    id: string;
    parts: ChatMessagePart[];
    role: "assistant" | "system" | "user";
  }>,
): UIMessage[] =>
  messages.map((message) => ({
    createdAt: message.createdAt,
    id: message.id,
    parts: message.parts as UIMessage["parts"],
    role: message.role,
  }));

const updateRunStatus = async (
  runId: string,
  status: ChatRunStatus,
  extra?: { error?: string | null; lastHeartbeatAt?: Date },
) => {
  await db
    .update(chatRun)
    .set({
      error: extra?.error,
      lastHeartbeatAt: extra?.lastHeartbeatAt ?? new Date(),
      status,
      updatedAt: new Date(),
    })
    .where(eq(chatRun.id, runId));
};

const updateAssistantMessage = async (input: {
  assistantMessageId: string;
  error?: string | null;
  parts: ChatMessagePart[];
  status: ChatMessageStatus;
}) => {
  await db
    .update(chatMessage)
    .set({
      error: input.error,
      parts: input.parts,
      status: input.status,
    })
    .where(eq(chatMessage.id, input.assistantMessageId));
};

const isCancelRequested = async (runId: string) => {
  const [row] = await db
    .select({ cancelRequestedAt: chatRun.cancelRequestedAt })
    .from(chatRun)
    .where(eq(chatRun.id, runId))
    .limit(1);

  return !!row?.cancelRequestedAt;
};

export const enqueueChatRun = async (runId: string) => {
  const startUrl = process.env.CHAT_GENERATION_START_URL?.trim();

  if (!startUrl) {
    void runChatGeneration(runId).catch((error) => {
      console.error("Inline chat generation failed.", error);
    });
    return;
  }

  const token = process.env.CHAT_GENERATION_START_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "CHAT_GENERATION_START_TOKEN is required when CHAT_GENERATION_START_URL is set.",
    );
  }

  const response = await fetch(startUrl, {
    body: JSON.stringify({ runId }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to enqueue chat generation (${response.status}): ${body}`);
  }
};

export const runChatGeneration = async (runId: string) => {
  const [run] = await db.select().from(chatRun).where(eq(chatRun.id, runId)).limit(1);

  if (!run) {
    throw new Error(`Chat run ${runId} was not found.`);
  }

  if (!ACTIVE_CHAT_RUN_STATUSES.includes(run.status as (typeof ACTIVE_CHAT_RUN_STATUSES)[number])) {
    return;
  }

  const messages = await db
    .select({
      createdAt: chatMessage.createdAt,
      id: chatMessage.id,
      parts: chatMessage.parts,
      role: chatMessage.role,
    })
    .from(chatMessage)
    .where(eq(chatMessage.chatId, run.chatId))
    .orderBy(chatMessage.position);

  const visibleMessages = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const assistantDraft = visibleMessages.find((message) => message.id === run.assistantMessageId);

  if (!assistantDraft) {
    await updateRunStatus(runId, "failed", { error: "Assistant draft message was not found." });
    return;
  }

  const abortController = new AbortController();
  let persistTimeout: ReturnType<typeof setTimeout> | undefined;
  let pendingParts: ChatMessagePart[] = assistantDraft.parts;
  let cancelled = false;

  const cancelPoll = setInterval(() => {
    void isCancelRequested(runId).then((shouldCancel) => {
      if (!shouldCancel || cancelled) {
        return;
      }

      cancelled = true;
      abortController.abort();
    });
  }, CANCEL_POLL_INTERVAL_MS);

  const flushAssistantDraft = async (status: ChatMessageStatus, error?: string | null) => {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = undefined;
    }

    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      error,
      parts: pendingParts,
      status,
    });
  };

  const scheduleAssistantDraftPersist = (parts: ChatMessagePart[]) => {
    pendingParts = parts;

    if (persistTimeout) {
      return;
    }

    persistTimeout = setTimeout(() => {
      persistTimeout = undefined;
      void updateAssistantMessage({
        assistantMessageId: run.assistantMessageId,
        parts: pendingParts,
        status: "streaming",
      });
      void updateRunStatus(runId, "running");
    }, DRAFT_PERSIST_INTERVAL_MS);
  };

  const usageMiddleware: ChatMiddleware = {
    name: "polar-ai-usage",
    onUsage: (context, usage) => {
      void reportAiUsage({
        chatId: run.chatId,
        completionTokens: usage.completionTokens,
        model: context.model,
        promptTokens: usage.promptTokens,
        userId: run.userId,
      }).catch((error) => {
        console.error("Could not report AI usage to Polar.", error);
      });
    },
  };

  try {
    await updateRunStatus(runId, "running");
    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      parts: pendingParts,
      status: "streaming",
    });

    const { messages: finalMessages } = await runChatStream({
      abortController,
      initialMessages: toUiMessages(visibleMessages),
      middleware: [usageMiddleware],
      onMessagesChange: (nextMessages) => {
        const assistantMessage =
          nextMessages.find((message) => message.id === run.assistantMessageId) ??
          [...nextMessages].reverse().find((message) => message.role === "assistant");

        if (!assistantMessage) {
          return;
        }

        scheduleAssistantDraftPersist(assistantMessage.parts as ChatMessagePart[]);
      },
      onToolCall: () => {
        void updateRunStatus(runId, "waiting_on_tool");
      },
      systemPrompts: [gmailSearchPrompt],
      tools: [
        createGmailSearchServerTool({
          category: run.mailboxCategory as MailboxCategory,
          mailboxId: run.mailboxId,
          searchGmail: ({ maxResults, query }) =>
            searchGmailForUser({
              category: run.mailboxCategory as MailboxCategory,
              mailboxId: run.mailboxId,
              maxResults,
              query,
              signal: abortController.signal,
              userId: run.userId,
            }),
        }),
      ],
    });

    const finalAssistant =
      finalMessages.find((message) => message.id === run.assistantMessageId) ??
      [...finalMessages].reverse().find((message) => message.role === "assistant");
    const finalParts = (finalAssistant?.parts ?? pendingParts) as ChatMessagePart[];
    const fallbackTitle = getTextContent(
      visibleMessages.find((message) => message.role === "user")?.parts ?? [],
    );

    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      error: cancelled ? "Generation cancelled." : null,
      parts: finalParts,
      status: cancelled ? "failed" : "complete",
    });
    await updateRunStatus(runId, cancelled ? "cancelled" : "complete");
    await db
      .update(chat)
      .set({
        title: sql<
          string | null
        >`coalesce(${chat.title}, ${fallbackTitle ? fallbackTitle.slice(0, 80) : null})`,
        updatedAt: new Date(),
      })
      .where(eq(chat.id, run.chatId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat generation failed.";

    if (cancelled || abortController.signal.aborted) {
      await flushAssistantDraft("failed", "Generation cancelled.");
      await updateRunStatus(runId, "cancelled", { error: "Generation cancelled." });
      return;
    }

    await flushAssistantDraft("failed", message);
    await updateRunStatus(runId, "failed", { error: message });
  } finally {
    clearInterval(cancelPoll);

    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
  }
};

export const hasActiveChatRun = async (chatId: string) => {
  const [activeRun] = await db
    .select({ id: chatRun.id })
    .from(chatRun)
    .where(and(eq(chatRun.chatId, chatId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])))
    .limit(1);

  return !!activeRun;
};

export const getActiveChatRunSummary = async (chatId: string) => {
  const [activeRun] = await db
    .select({
      assistantMessageId: chatRun.assistantMessageId,
      cancelRequestedAt: chatRun.cancelRequestedAt,
      error: chatRun.error,
      id: chatRun.id,
      status: chatRun.status,
    })
    .from(chatRun)
    .where(and(eq(chatRun.chatId, chatId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])))
    .orderBy(desc(chatRun.createdAt))
    .limit(1);

  return activeRun ?? null;
};

export const createChatRunRecords = async (input: {
  assistantMessageId: string;
  chatId: string;
  mailboxCategory: string;
  mailboxId: string;
  runId: string;
  userId: string;
  userMessage: {
    id: string;
    parts: ChatMessagePart[];
    position: number;
  };
}) => {
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(chatMessage).values({
      chatId: input.chatId,
      createdAt: now,
      id: input.userMessage.id,
      parts: input.userMessage.parts,
      position: input.userMessage.position,
      role: "user",
      status: "complete",
      userId: input.userId,
    });

    await tx.insert(chatMessage).values({
      chatId: input.chatId,
      createdAt: now,
      id: input.assistantMessageId,
      parts: [{ content: "", type: "text" }] as ChatMessagePart[],
      position: input.userMessage.position + 1,
      role: "assistant",
      status: "draft",
      userId: input.userId,
    });

    await tx.insert(chatRun).values({
      assistantMessageId: input.assistantMessageId,
      chatId: input.chatId,
      createdAt: now,
      executionName: input.runId,
      id: input.runId,
      lastHeartbeatAt: now,
      mailboxCategory: input.mailboxCategory,
      mailboxId: input.mailboxId,
      maxIterations: DEFAULT_MAX_ITERATIONS,
      status: "queued",
      updatedAt: now,
      userId: input.userId,
    });

    await tx.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId));
  });
};
