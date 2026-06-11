import type { MailboxCategory } from "@quieter/gmail";
import {
  chatModelSchema,
  composeEmailToolDef,
  createGmailLabelListServerTool,
  createGmailMessageServerTool,
  createGmailSearchServerTool,
  createGmailThreadServerTool,
  createMailboxOverviewServerTool,
  createModifyMailServerTool,
  gmailToolsPrompt,
  runChatStream,
  type ChatMiddleware,
  type GmailToolsContext,
  type UIMessage,
} from "@quieter/ai";
import { reportAiUsage } from "@quieter/billing";
import {
  chatMessage,
  chatRun,
  db,
  type ChatMessagePart,
  type ChatMessageStatus,
} from "@quieter/database";
import { and, eq } from "drizzle-orm";
import { isCancelRequested, updateAssistantMessage, updateRunStatus } from "./chat-run-store";
import { isActiveChatRunStatus, publishChatRunEvent } from "./chat-run-stream";
import {
  getMailboxOverviewForUser,
  listGmailLabelsForUser,
  modifyMailForUser,
  readGmailMessageForUser,
  readGmailThreadForUser,
  searchGmailForUser,
} from "./gmail-chat-search";

const DRAFT_PERSIST_INTERVAL_MS = 750;
const CANCEL_POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_TOUCH_INTERVAL_MS = 5_000;
const ENQUEUE_CHAT_RUN_TIMEOUT_MS = 10_000;

const inFlightGenerations = new Map<string, Promise<void>>();

/** StreamProcessor may append multiple assistant messages across tool continuations. */
const getStreamingAssistantParts = (
  messages: UIMessage[],
  streamStartMessageCount: number,
): ChatMessagePart[] | null => {
  const parts = messages
    .slice(streamStartMessageCount)
    .flatMap((message) =>
      message.role === "assistant" ? (message.parts as ChatMessagePart[]) : [],
    );

  return parts.length > 0 ? parts : null;
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

const terminalizeFailedChatRun = async (
  runId: string,
  error: string,
  assistant?: { id: string; parts: ChatMessagePart[] },
) => {
  let terminalAssistant = assistant;

  if (!terminalAssistant) {
    const [run] = await db
      .select({ assistantMessageId: chatRun.assistantMessageId })
      .from(chatRun)
      .where(eq(chatRun.id, runId))
      .limit(1);

    if (!run) {
      return;
    }

    const [message] = await db
      .select({ parts: chatMessage.parts })
      .from(chatMessage)
      .where(eq(chatMessage.id, run.assistantMessageId))
      .limit(1);

    terminalAssistant = {
      id: run.assistantMessageId,
      parts: message?.parts ?? [{ content: "", type: "text" }],
    };
  }

  await Promise.all([
    updateAssistantMessage({
      assistantMessageId: terminalAssistant.id,
      error,
      parts: terminalAssistant.parts,
      status: "failed",
    }),
    updateRunStatus(runId, "failed", { error }),
  ]);
  publishChatRunEvent(runId, {
    assistantMessageId: terminalAssistant.id,
    error,
    parts: terminalAssistant.parts,
    status: "failed",
    type: "done",
  });
};

export const ensureChatRunGeneration = (runId: string) => {
  const existing = inFlightGenerations.get(runId);

  if (existing) {
    return existing;
  }

  const generation = runChatGeneration(runId)
    .catch(async (error) => {
      console.error("Chat generation failed.", error);
      await terminalizeFailedChatRun(
        runId,
        error instanceof Error ? error.message : "Chat generation failed.",
      ).catch((updateError) => {
        console.error("Could not terminalize the failed chat generation.", updateError);
      });
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
    return ensureChatRunGeneration(runId);
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

  const model = chatModelSchema.parse(run.model);
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

  const drainAssistantDraftPersist = async () => {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = undefined;
    }

    await pendingPersist.catch(() => undefined);
  };

  const flushAssistantDraft = async (status: ChatMessageStatus, error?: string | null) => {
    await drainAssistantDraftPersist();
    await updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      error,
      parts: pendingParts,
      status,
    });
  };

  const persistStreamingDraft = () => {
    const parts = pendingParts;
    pendingPersist = pendingPersist
      .catch(() => undefined)
      .then(async () => {
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
    onUsage: (_context, usage) => {
      void reportAiUsage({
        chatId: run.chatId,
        completionTokens: usage.completionTokens,
        model,
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

    const streamInitialMessages = toUiMessages(
      visibleMessages.filter((message) => message.id !== run.assistantMessageId),
    );
    const streamStartMessageCount = streamInitialMessages.length;

    const finalMessages = await runChatStream({
      abortController,
      initialMessages: streamInitialMessages,
      middleware: [usageMiddleware],
      model,
      onMessagesChange: (nextMessages) => {
        const parts = getStreamingAssistantParts(nextMessages, streamStartMessageCount);

        if (!parts) {
          return;
        }

        emitDraft(parts);
      },
      onToolCall: () => {
        void updateRunStatus(runId, "waiting_on_tool");
        publishChatRunEvent(runId, { status: "waiting_on_tool", type: "status" });
      },
      systemPrompts: [gmailToolsPrompt],
      tools: (() => {
        const category = run.mailboxCategory as MailboxCategory;
        const context: GmailToolsContext = {
          category,
          getMailboxOverview: () =>
            getMailboxOverviewForUser({
              category,
              mailboxId: run.mailboxId,
              signal: abortController.signal,
              userId: run.userId,
            }),
          listGmailLabels: () =>
            listGmailLabelsForUser({
              category,
              mailboxId: run.mailboxId,
              signal: abortController.signal,
              userId: run.userId,
            }),
          modifyMail: ({ action, id, target }) =>
            modifyMailForUser({
              action,
              category,
              id,
              mailboxId: run.mailboxId,
              signal: abortController.signal,
              target,
              userId: run.userId,
            }),
          readGmailMessage: ({ messageId }) =>
            readGmailMessageForUser({
              category,
              mailboxId: run.mailboxId,
              messageId,
              signal: abortController.signal,
              userId: run.userId,
            }),
          readGmailThread: ({ threadId }: { threadId: string }) =>
            readGmailThreadForUser({
              category,
              mailboxId: run.mailboxId,
              signal: abortController.signal,
              threadId,
              userId: run.userId,
            }),
          searchGmail: ({ maxResults, query }) =>
            searchGmailForUser({
              category,
              mailboxId: run.mailboxId,
              maxResults,
              query,
              signal: abortController.signal,
              userId: run.userId,
            }),
        };

        return [
          composeEmailToolDef,
          createGmailLabelListServerTool(context),
          createGmailMessageServerTool(context),
          createGmailSearchServerTool(context),
          createGmailThreadServerTool(context),
          createMailboxOverviewServerTool(context),
          createModifyMailServerTool(context),
        ];
      })(),
    });

    const finalParts = (getStreamingAssistantParts(finalMessages, streamStartMessageCount) ??
      pendingParts) as ChatMessagePart[];
    const terminalStatus = cancelled ? "cancelled" : "complete";

    pendingParts = finalParts;
    await flushAssistantDraft(
      cancelled ? "failed" : "complete",
      cancelled ? "Generation cancelled." : null,
    );
    await updateRunStatus(runId, terminalStatus);
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

    await drainAssistantDraftPersist();
    await terminalizeFailedChatRun(runId, message, {
      id: run.assistantMessageId,
      parts: pendingParts,
    });
  } finally {
    clearInterval(cancelPoll);

    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
  }
};
