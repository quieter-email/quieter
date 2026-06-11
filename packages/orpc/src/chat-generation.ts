import type { MailboxCategory } from "@quieter/gmail";
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
} from "@quieter/database";
import { and, eq, sql } from "drizzle-orm";
import { isCancelRequested, updateAssistantMessage, updateRunStatus } from "./chat-run-store";
import { isActiveChatRunStatus, publishChatRunEvent } from "./chat-run-stream";
import { searchGmailForUser } from "./gmail-chat-search";

const DRAFT_PERSIST_INTERVAL_MS = 750;
const CANCEL_POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_TOUCH_INTERVAL_MS = 5_000;
const ENQUEUE_CHAT_RUN_TIMEOUT_MS = 10_000;

const inFlightGenerations = new Map<string, Promise<void>>();

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
  let latestAssistant: UIMessage | undefined;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    latestAssistant ??= message;
    if (message.parts.some((part) => part.type !== "text" || Boolean(part.content))) {
      return message.parts as ChatMessagePart[];
    }
  }

  return latestAssistant ? (latestAssistant.parts as ChatMessagePart[]) : null;
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

  if (!isActiveChatRunStatus(run.status)) {
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
  let pendingPersist = Promise.resolve();
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

    await pendingPersist;
    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      error,
      parts: pendingParts,
      status,
    });
  };

  const persistStreamingDraft = () => {
    const parts = pendingParts;
    pendingPersist = pendingPersist.then(async () => {
      await Promise.all([
        updateAssistantMessage({
          assistantMessageId: run.assistantMessageId,
          parts,
          status: "streaming",
        }),
        updateRunStatus(runId, "running"),
      ]);
    });

    void pendingPersist.catch((error) => {
      console.error("Could not persist the chat generation draft.", error);
    });
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
        console.error(
          "Could not report AI usage to Polar.",
          error instanceof Error ? error.message : "Unknown error.",
        );
      });
    },
  };

  try {
    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      parts: pendingParts,
      status: "streaming",
    });

    const finalMessages = await runChatStream({
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

    const finalParts = (getStreamingAssistantParts(finalMessages) ??
      pendingParts) as ChatMessagePart[];
    const fallbackTitle = getTextContent(
      visibleMessages.find((message) => message.role === "user")?.parts ?? [],
    );
    const terminalStatus = cancelled ? "cancelled" : "complete";

    pendingParts = finalParts;
    await flushAssistantDraft(
      cancelled ? "failed" : "complete",
      cancelled ? "Generation cancelled." : null,
    );
    await updateRunStatus(runId, terminalStatus);
    await db
      .update(chat)
      .set({
        title: sql<
          string | null
        >`coalesce(${chat.title}, ${fallbackTitle ? fallbackTitle.slice(0, 80) : null})`,
        updatedAt: new Date(),
      })
      .where(eq(chat.id, run.chatId))
      .catch((error) => {
        console.error("Could not update the generated chat title.", error);
      });
    publishChatRunEvent(runId, {
      assistantMessageId: run.assistantMessageId,
      error: cancelled ? "Generation cancelled." : null,
      parts: finalParts,
      status: terminalStatus,
      type: "done",
    });
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
