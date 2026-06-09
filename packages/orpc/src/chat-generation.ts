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
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { publishChatRunEvent } from "./chat-run-stream";
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
const CHAT_RUN_ACTIVE_CONFLICT_INDEX = "chat_run_one_active_per_chat";
const ENQUEUE_CHAT_RUN_TIMEOUT_MS = 10_000;

export class ActiveChatRunConflictError extends Error {
  constructor() {
    super("This chat already has a generation in progress.");
    this.name = "ActiveChatRunConflictError";
  }
}

const getPostgresErrorField = (error: unknown, field: "code" | "constraint") => {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  if (field in error && typeof error[field as keyof typeof error] === "string") {
    return error[field as keyof typeof error] as string;
  }

  if ("cause" in error && error.cause && typeof error.cause === "object" && field in error.cause) {
    const value = error.cause[field as keyof typeof error.cause];
    return typeof value === "string" ? value : undefined;
  }

  return undefined;
};

const isActiveChatRunConflict = (error: unknown) => {
  if (getPostgresErrorField(error, "code") !== "23505") {
    return false;
  }

  const constraint = getPostgresErrorField(error, "constraint");
  return !constraint || constraint === CHAT_RUN_ACTIVE_CONFLICT_INDEX;
};

const throwIfActiveChatRunConflict = (error: unknown) => {
  if (isActiveChatRunConflict(error)) {
    throw new ActiveChatRunConflictError();
  }

  throw error;
};
const DRAFT_PERSIST_INTERVAL_MS = 750;
const CANCEL_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_ITERATIONS = 20;
const STALE_CHAT_RUN_MS = 3 * 60 * 1_000;
const STALE_CHAT_RUN_ERROR = "Generation stopped unexpectedly. Send your message again.";
const HEARTBEAT_TOUCH_INTERVAL_MS = 5_000;

const inFlightGenerations = new Map<string, Promise<void>>();

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

/** StreamProcessor appends a new assistant message; use the latest one for draft persistence. */
const getStreamingAssistantParts = (messages: UIMessage[]): ChatMessagePart[] | null => {
  const assistants = messages.filter((message) => message.role === "assistant");
  const streaming = [...assistants].reverse().find((message) =>
    message.parts.some((part) => {
      if (part.type !== "text") {
        return true;
      }

      return "content" in part && typeof part.content === "string" && part.content.length > 0;
    }),
  );

  const parts = (streaming ?? assistants.at(-1))?.parts;

  return parts ? (parts as ChatMessagePart[]) : null;
};

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

export const getAuthorizedChatRun = async (runId: string, userId: string) => {
  const [run] = await db.select().from(chatRun).where(eq(chatRun.id, runId)).limit(1);

  if (!run || run.userId !== userId) {
    return null;
  }

  return run;
};

const hasVisibleAssistantContent = (parts: ChatMessagePart[]) =>
  parts.some((part) => {
    if (part.type !== "text") {
      return true;
    }

    return typeof part.content === "string" && part.content.length > 0;
  });

export const ensureChatRunGeneration = (runId: string) => {
  const existing = inFlightGenerations.get(runId);

  if (existing) {
    return existing;
  }

  const generation = runChatGeneration(runId)
    .catch((error) => {
      console.error("Chat generation failed.", error);
    })
    .finally(() => {
      inFlightGenerations.delete(runId);
    });

  inFlightGenerations.set(runId, generation);
  return generation;
};

export const handoffChatRunToBackground = (runId: string) => {
  if (inFlightGenerations.has(runId)) {
    return;
  }

  void enqueueChatRun(runId).catch((error) => {
    console.error("Could not hand off chat generation to the background worker.", error);
  });
};

export const enqueueChatRun = async (runId: string) => {
  const startUrl = process.env.CHAT_GENERATION_START_URL?.trim();

  if (!startUrl) {
    void ensureChatRunGeneration(runId);
    return;
  }

  const token = process.env.CHAT_GENERATION_START_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "CHAT_GENERATION_START_TOKEN is required when CHAT_GENERATION_START_URL is set.",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENQUEUE_CHAT_RUN_TIMEOUT_MS);

  try {
    const response = await fetch(startUrl, {
      body: JSON.stringify({ runId }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to enqueue chat generation (${response.status}): ${body}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Timed out enqueueing chat generation after ${ENQUEUE_CHAT_RUN_TIMEOUT_MS}ms.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
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

  const now = new Date();
  const [claimed] = await db
    .update(chatRun)
    .set({
      lastHeartbeatAt: now,
      status: "running",
      updatedAt: now,
    })
    .where(and(eq(chatRun.id, runId), eq(chatRun.status, "queued")))
    .returning({ id: chatRun.id });

  if (!claimed) {
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
  let hasPersistedStreamingDraft = false;
  let lastHeartbeatTouchAt = 0;

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

  const persistStreamingDraft = () => {
    void updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      parts: pendingParts,
      status: "streaming",
    });
    void updateRunStatus(runId, "running");
  };

  const touchRunHeartbeat = () => {
    const now = Date.now();

    if (now - lastHeartbeatTouchAt < HEARTBEAT_TOUCH_INTERVAL_MS) {
      return;
    }

    lastHeartbeatTouchAt = now;
    void updateRunStatus(runId, "running");
  };

  const emitDraft = (parts: ChatMessagePart[]) => {
    pendingParts = parts;
    publishChatRunEvent(runId, {
      assistantMessageId: run.assistantMessageId,
      parts,
      type: "draft",
    });
    touchRunHeartbeat();
    scheduleAssistantDraftPersist(parts);
  };

  const scheduleAssistantDraftPersist = (parts: ChatMessagePart[]) => {
    pendingParts = parts;

    const hasVisibleContent = parts.some((part) => {
      if (part.type === "tool-call" || part.type === "tool-result") {
        return true;
      }

      if (part.type === "text" || part.type === "thinking") {
        return typeof part.content === "string" && part.content.length > 0;
      }

      return false;
    });

    if (hasVisibleContent && !hasPersistedStreamingDraft) {
      hasPersistedStreamingDraft = true;
      persistStreamingDraft();
    }

    if (persistTimeout) {
      return;
    }

    persistTimeout = setTimeout(() => {
      persistTimeout = undefined;
      persistStreamingDraft();
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
    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      parts: pendingParts,
      status: "streaming",
    });

    const { messages: finalMessages } = await runChatStream({
      abortController,
      initialMessages: toUiMessages(
        visibleMessages.filter((message) => message.id !== run.assistantMessageId),
      ),
      middleware: [usageMiddleware],
      onMessagesChange: (nextMessages) => {
        const parts = getStreamingAssistantParts(nextMessages);

        if (!parts) {
          return;
        }

        emitDraft(parts);
      },
      onToolCall: () => {
        void updateRunStatus(runId, "waiting_on_tool");
        publishChatRunEvent(runId, { status: "waiting_on_tool", type: "status" });
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

    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = undefined;
    }

    const finalParts = (getStreamingAssistantParts(finalMessages) ??
      pendingParts) as ChatMessagePart[];
    const fallbackTitle = getTextContent(
      visibleMessages.find((message) => message.role === "user")?.parts ?? [],
    );

    const terminalStatus = cancelled ? "cancelled" : "complete";

    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      error: cancelled ? "Generation cancelled." : null,
      parts: finalParts,
      status: cancelled ? "failed" : "complete",
    });
    await updateRunStatus(runId, terminalStatus);
    publishChatRunEvent(runId, {
      assistantMessageId: run.assistantMessageId,
      error: cancelled ? "Generation cancelled." : null,
      parts: finalParts,
      status: terminalStatus,
      type: "done",
    });
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
      publishChatRunEvent(runId, {
        assistantMessageId: run.assistantMessageId,
        error: "Generation cancelled.",
        parts: pendingParts,
        status: "cancelled",
        type: "done",
      });
      return;
    }

    await flushAssistantDraft("failed", message);
    await updateRunStatus(runId, "failed", { error: message });
    publishChatRunEvent(runId, {
      assistantMessageId: run.assistantMessageId,
      error: message,
      parts: pendingParts,
      status: "failed",
      type: "done",
    });
  } finally {
    clearInterval(cancelPoll);

    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
  }
};

const failStaleChatRun = async (run: { assistantMessageId: string; id: string }) => {
  const [assistantMessage] = await db
    .select({ parts: chatMessage.parts })
    .from(chatMessage)
    .where(eq(chatMessage.id, run.assistantMessageId))
    .limit(1);

  await updateAssistantMessage({
    assistantMessageId: run.assistantMessageId,
    error: STALE_CHAT_RUN_ERROR,
    parts: (assistantMessage?.parts ?? [{ content: "", type: "text" }]) as ChatMessagePart[],
    status: "failed",
  });
  await updateRunStatus(run.id, "failed", { error: STALE_CHAT_RUN_ERROR });
};

export const hasActiveChatRun = async (chatId: string) => !!(await getActiveChatRunSummary(chatId));

export const getActiveChatRunSummary = async (chatId: string) => {
  const [activeRun] = await db
    .select({
      assistantMessageId: chatRun.assistantMessageId,
      cancelRequestedAt: chatRun.cancelRequestedAt,
      createdAt: chatRun.createdAt,
      error: chatRun.error,
      id: chatRun.id,
      lastHeartbeatAt: chatRun.lastHeartbeatAt,
      status: chatRun.status,
      updatedAt: chatRun.updatedAt,
    })
    .from(chatRun)
    .where(and(eq(chatRun.chatId, chatId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])))
    .orderBy(desc(chatRun.createdAt))
    .limit(1);

  if (!activeRun) {
    return null;
  }

  const [assistantMessage] = await db
    .select({ parts: chatMessage.parts })
    .from(chatMessage)
    .where(eq(chatMessage.id, activeRun.assistantMessageId))
    .limit(1);
  const hasAssistantContent = hasVisibleAssistantContent(
    (assistantMessage?.parts ?? []) as ChatMessagePart[],
  );
  const lastActivity = activeRun.lastHeartbeatAt ?? activeRun.updatedAt ?? activeRun.createdAt;
  const isHeartbeatStale = Date.now() - lastActivity.getTime() > STALE_CHAT_RUN_MS;
  const isOrphanedEmptyRun =
    Date.now() - activeRun.createdAt.getTime() > STALE_CHAT_RUN_MS && !hasAssistantContent;

  if (isHeartbeatStale || isOrphanedEmptyRun) {
    await failStaleChatRun(activeRun);
    return null;
  }

  return {
    assistantMessageId: activeRun.assistantMessageId,
    cancelRequestedAt: activeRun.cancelRequestedAt,
    error: activeRun.error,
    id: activeRun.id,
    status: activeRun.status,
  };
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

  // Neon HTTP driver does not support db.transaction(); keep writes ordered by FK deps.
  await db.insert(chatMessage).values({
    chatId: input.chatId,
    createdAt: now,
    id: input.userMessage.id,
    parts: input.userMessage.parts,
    position: input.userMessage.position,
    role: "user",
    status: "complete",
    userId: input.userId,
  });

  await db.insert(chatMessage).values({
    chatId: input.chatId,
    createdAt: now,
    id: input.assistantMessageId,
    parts: [{ content: "", type: "text" }] as ChatMessagePart[],
    position: input.userMessage.position + 1,
    role: "assistant",
    status: "draft",
    userId: input.userId,
  });

  try {
    await db.insert(chatRun).values({
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
  } catch (error) {
    if (isActiveChatRunConflict(error)) {
      await db
        .delete(chatMessage)
        .where(inArray(chatMessage.id, [input.userMessage.id, input.assistantMessageId]));
      throw new ActiveChatRunConflictError();
    }

    throw error;
  }

  await db.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId));
};

export const startAssistantRun = async (input: {
  chatId: string;
  mailboxCategory: string;
  mailboxId: string;
  runId?: string;
  userId: string;
  userMessagePosition: number;
}) => {
  const runId = input.runId ?? crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const now = new Date();

  await db
    .delete(chatMessage)
    .where(
      and(
        eq(chatMessage.chatId, input.chatId),
        gt(chatMessage.position, input.userMessagePosition),
      ),
    );

  await db.insert(chatMessage).values({
    chatId: input.chatId,
    createdAt: now,
    id: assistantMessageId,
    parts: [{ content: "", type: "text" }] as ChatMessagePart[],
    position: input.userMessagePosition + 1,
    role: "assistant",
    status: "draft",
    userId: input.userId,
  });

  try {
    await db.insert(chatRun).values({
      assistantMessageId,
      chatId: input.chatId,
      createdAt: now,
      executionName: runId,
      id: runId,
      lastHeartbeatAt: now,
      mailboxCategory: input.mailboxCategory,
      mailboxId: input.mailboxId,
      maxIterations: DEFAULT_MAX_ITERATIONS,
      status: "queued",
      updatedAt: now,
      userId: input.userId,
    });
  } catch (error) {
    throwIfActiveChatRunConflict(error);
  }

  await db.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId));

  return { assistantMessageId, runId };
};
