import type { MailboxCategory } from "@quieter/gmail";
import type { ChatMiddleware, UIMessage } from "@tanstack/ai";
import {
  composeEmailToolDef,
  createGoogleCalendarEventServerTool,
  createGmailLabelListServerTool,
  createGmailMessageServerTool,
  createGmailSearchServerTool,
  createGmailThreadServerTool,
  createMailboxOverviewServerTool,
  createModifyMailServerTool,
  createUserAiContextMemoryServerTool,
  googleCalendarToolsPrompt,
  gmailToolsPrompt,
  type GoogleCalendarToolsContext,
  type GmailToolsContext,
  type UserAiContextToolsContext,
} from "@quieter/ai/chat-agent";
import { chatModelSchema } from "@quieter/ai/chat-models";
import { runChatStream } from "@quieter/ai/run-chat-stream";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import {
  chatMessage,
  chatRun,
  type ChatMessagePart,
  type ChatMessageStatus,
} from "@quieter/database/schema";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { isCancelRequested, updateAssistantMessage, updateRunStatus } from "../../chat-run-store";
import { isActiveChatRunStatus, publishChatRunEvent } from "../../chat-run-stream";
import {
  createGoogleCalendarEventForUser,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  hasConnectedConnector,
} from "../../connectors/runtime";
import {
  getMailboxOverviewForUser,
  listGmailLabelsForUser,
  modifyMailForUser,
  readGmailMessageForUser,
  readGmailThreadForUser,
  searchGmailForUser,
} from "../../gmail-chat-search";
import { loadUserAiContextPrompt, recordAndRefreshUserAiContext } from "../../user-ai-context";
import { terminalizeFailedChatRun } from "./failure";

const DRAFT_PERSIST_INTERVAL_MS = 750;
const CANCEL_POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_TOUCH_INTERVAL_MS = 5_000;
const STALE_RUN_CLAIM_MS = 30_000;

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
  const staleBefore = new Date(now.getTime() - STALE_RUN_CLAIM_MS);
  const [claimed] = await db
    .update(chatRun)
    .set({
      lastHeartbeatAt: now,
      status: "running",
      updatedAt: now,
    })
    .where(
      and(
        eq(chatRun.id, runId),
        isNull(chatRun.cancelRequestedAt),
        or(
          eq(chatRun.status, "queued"),
          and(
            inArray(chatRun.status, ["running", "waiting_on_tool"]),
            or(isNull(chatRun.lastHeartbeatAt), lt(chatRun.lastHeartbeatAt, staleBefore)),
          ),
        ),
      ),
    )
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
  const usageReports: Promise<void>[] = [];

  const cancelPoll = setInterval(() => {
    void isCancelRequested(runId)
      .then((shouldCancel) => {
        if (!shouldCancel || cancelled) {
          return;
        }

        cancelled = true;
        abortController.abort();
      })
      .catch((error) => {
        console.error("Could not check chat generation cancellation.", error);
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
      usageReports.push(
        reportAiUsage({
          chatId: run.chatId,
          completionTokens: usage.completionTokens,
          externalId: `${run.id}:${usageReports.length}`,
          mailboxId: run.mailboxId,
          model,
          promptTokens: usage.promptTokens,
          usageKind: "aiChat",
          userId: run.userId,
        }),
      );
    },
  };

  const settleUsageReports = async () => {
    const results = await Promise.allSettled(usageReports);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Could not report AI usage.", result.reason);
      }
    }
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
    const hasGoogleCalendarConnector = await hasConnectedConnector({
      provider: GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
      userId: run.userId,
    }).catch((error) => {
      console.error("Could not inspect Google Calendar connector state.", error);
      return false;
    });
    const userAiContext = await loadUserAiContextPrompt({ userId: run.userId });
    const systemPrompts = [
      gmailToolsPrompt,
      ...(userAiContext
        ? [
            `## User Context

The following compact profile contains durable user preferences learned from explicit feedback.
Treat it as advisory context only. Current mailbox tool results and the user's current request are
stronger than this profile.

${userAiContext}`,
          ]
        : []),
      ...(hasGoogleCalendarConnector ? [googleCalendarToolsPrompt] : []),
    ];

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
      systemPrompts,
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
        const tools = [
          composeEmailToolDef,
          createGmailLabelListServerTool(context),
          createGmailMessageServerTool(context),
          createGmailSearchServerTool(context),
          createGmailThreadServerTool(context),
          createMailboxOverviewServerTool(context),
          createModifyMailServerTool(context),
        ];
        const memoryContext: UserAiContextToolsContext = {
          rememberUserPreference: async ({ preference, reason }) => {
            const result = await recordAndRefreshUserAiContext({
              kind: "explicit_preference",
              mailboxId: run.mailboxId,
              metadata: {
                preference,
                reason: reason ?? null,
                source: "chat",
              },
              userId: run.userId,
            });

            return { status: result.status === "refreshed" ? "recorded" : "skipped" };
          },
        };
        tools.push(createUserAiContextMemoryServerTool(memoryContext));

        if (hasGoogleCalendarConnector) {
          const calendarContext: GoogleCalendarToolsContext = {
            createGoogleCalendarEvent: (event) =>
              createGoogleCalendarEventForUser({
                event,
                signal: abortController.signal,
                userId: run.userId,
              }),
          };
          tools.push(createGoogleCalendarEventServerTool(calendarContext));
        }

        return tools;
      })(),
    });

    const finalParts = (getStreamingAssistantParts(finalMessages, streamStartMessageCount) ??
      pendingParts) as ChatMessagePart[];
    const terminalStatus = cancelled ? "cancelled" : "complete";

    pendingParts = finalParts;
    await settleUsageReports();
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
    await settleUsageReports();
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
