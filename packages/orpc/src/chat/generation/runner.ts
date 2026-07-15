import type { MailboxCategory } from "@quieter/gmail";
import type { ChatMiddleware, UIMessage } from "@tanstack/ai";
import {
  composeEmailToolDef,
  createGoogleCalendarEventServerTool,
  createGmailAttachmentServerTool,
  createGmailLabelListServerTool,
  createGmailMessageServerTool,
  createGmailMessagesServerTool,
  createGmailSearchServerTool,
  createGmailThreadServerTool,
  createLinearIssueMetadataServerTool,
  createLinearIssueServerTool,
  createMailboxOverviewServerTool,
  createModifyMailServerTool,
  createUserAiContextMemoryServerTool,
  googleCalendarToolsPrompt,
  gmailToolsPrompt,
  linearToolsPrompt,
  type GoogleCalendarToolsContext,
  type GmailToolsContext,
  type LinearToolsContext,
  type UserAiContextToolsContext,
} from "@quieter/ai/chat-agent";
import { chatModelSchema } from "@quieter/ai/chat-models";
import { runChatStream } from "@quieter/ai/run-chat-stream";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { chatMessage, chatRun, type ChatMessagePart } from "@quieter/database/schema";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  isCancelRequested,
  persistChatRunDraft,
  terminalizeChatRun,
  touchChatRunHeartbeat,
  updateRunStatus,
} from "../../chat-run-store";
import { isActiveChatRunStatus, publishChatRunEvent } from "../../chat-run-stream";
import {
  createGoogleCalendarEventForUser,
  createLinearIssueForUser,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  hasConnectedConnector,
  LINEAR_CONNECTOR_PROVIDER,
  listLinearIssueMetadataForUser,
} from "../../connectors/runtime";
import {
  getMailboxOverviewForUser,
  listGmailLabelsForUser,
  modifyMailForUser,
  readGmailAttachmentForUser,
  readGmailMessageForUser,
  readGmailMessagesForUser,
  readGmailThreadForUser,
  searchGmailForUser,
} from "../../gmail-chat-search";
import {
  loadUserAiContextPrompt,
  recordUserAiContextEvent,
  refreshUserAiContext,
} from "../../user-ai-context";
import { getChatRunFailureMessage, terminalizeFailedChatRun } from "./failure";
import { registerChatRunController } from "./runtime";

const DRAFT_PERSIST_INTERVAL_MS = 250;
const CANCEL_POLL_INTERVAL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 5_000;
const STALE_RUN_CLAIM_MS = 30_000;
const MAIL_TOOL_TIMEOUT_MS = 25_000;

const runMailTool = async <T>(
  runSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
) => {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), MAIL_TOOL_TIMEOUT_MS);
  const signal = AbortSignal.any([runSignal, timeoutController.signal]);

  try {
    return await operation(signal);
  } catch (error) {
    if (!runSignal.aborted && timeoutController.signal.aborted) {
      throw new Error("The mail lookup timed out. Retry with a narrower search.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

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
    await terminalizeFailedChatRun(
      runId,
      "This response could not be resumed. Retry it to continue.",
    );
    return;
  }

  const abortController = new AbortController();
  const unregisterController = registerChatRunController(runId, abortController);
  let persistTimeout: ReturnType<typeof setTimeout> | undefined;
  let pendingParts: ChatMessagePart[] = assistantDraft.parts;
  let pendingPersist = Promise.resolve();
  let cancelled = false;
  let hasPersistedStreamingDraft = false;
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
  const heartbeat = setInterval(() => {
    void touchChatRunHeartbeat(runId).catch((error) => {
      console.error("Could not update the chat generation heartbeat.", error);
    });
  }, HEARTBEAT_INTERVAL_MS);

  const drainAssistantDraftPersist = async () => {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = undefined;
    }

    await pendingPersist.catch(() => undefined);
  };

  const persistStreamingDraft = () => {
    const parts = pendingParts;
    pendingPersist = pendingPersist
      .catch(() => undefined)
      .then(async () => {
        await persistChatRunDraft({
          assistantMessageId: run.assistantMessageId,
          parts,
          runId,
        });
      });

    void pendingPersist.catch((error) => {
      console.error("Could not persist the chat generation draft.", error);
    });
  };

  const emitDraft = (parts: ChatMessagePart[]) => {
    pendingParts = parts;
    publishChatRunEvent(runId, {
      assistantMessageId: run.assistantMessageId,
      parts,
      type: "draft",
    });
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
          costUsd: usage.cost,
          completionTokens: usage.completionTokens,
          externalId: `${run.id}:${usageReports.length}`,
          mailboxId: run.mailboxId,
          model,
          promptTokens: usage.promptTokens,
          promptTokensDetails: usage.promptTokensDetails,
          usageKind: "aiChat",
          userId: run.userId,
        }).catch((error) => {
          console.error("Could not report AI usage.", error);
        }),
      );
    },
  };

  const settleUsageReports = async () => {
    await Promise.all(usageReports);
  };

  try {
    if (
      !(await persistChatRunDraft({
        assistantMessageId: run.assistantMessageId,
        parts: pendingParts,
        runId,
      }))
    ) {
      return;
    }

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
    const hasLinearConnector = await hasConnectedConnector({
      provider: LINEAR_CONNECTOR_PROVIDER,
      userId: run.userId,
    }).catch((error) => {
      console.error("Could not inspect Linear connector state.", error);
      return false;
    });
    const userAiContext = await loadUserAiContextPrompt({ userId: run.userId });
    const mailboxContext = run.context
      ? [
          run.context.messageId ? `Selected message id: ${run.context.messageId}` : null,
          run.context.threadId ? `Selected thread id: ${run.context.threadId}` : null,
          run.context.query ? `Open mailbox search: ${run.context.query}` : null,
        ].filter((value): value is string => !!value)
      : [];
    const systemPrompts = [
      gmailToolsPrompt,
      ...(mailboxContext.length
        ? [
            `## Current mailbox context

The user opened this chat from the following mailbox context:
${mailboxContext.map((value) => `- ${value}`).join("\n")}

These identifiers are navigation hints, not message content. When the user refers to "this email",
"this thread", or the current results, retrieve the relevant live data with a mailbox tool before
answering.`,
          ]
        : []),
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
      ...(hasLinearConnector ? [linearToolsPrompt] : []),
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
            runMailTool(abortController.signal, (signal) =>
              getMailboxOverviewForUser({
                category,
                mailboxId: run.mailboxId,
                signal,
                userId: run.userId,
              }),
            ),
          listGmailLabels: () =>
            runMailTool(abortController.signal, (signal) =>
              listGmailLabelsForUser({
                category,
                mailboxId: run.mailboxId,
                signal,
                userId: run.userId,
              }),
            ),
          modifyMail: ({ action, id, target }) =>
            runMailTool(abortController.signal, (signal) =>
              modifyMailForUser({
                action,
                category,
                id,
                mailboxId: run.mailboxId,
                signal,
                target,
                userId: run.userId,
              }),
            ),
          readGmailAttachment: ({ attachmentId, messageId }) =>
            runMailTool(abortController.signal, (signal) =>
              readGmailAttachmentForUser({
                attachmentId,
                category,
                mailboxId: run.mailboxId,
                messageId,
                signal,
                userId: run.userId,
              }),
            ),
          readGmailMessage: ({ messageId }) =>
            runMailTool(abortController.signal, (signal) =>
              readGmailMessageForUser({
                category,
                mailboxId: run.mailboxId,
                messageId,
                signal,
                userId: run.userId,
              }),
            ),
          readGmailMessages: ({ messageIds }) =>
            runMailTool(abortController.signal, (signal) =>
              readGmailMessagesForUser({
                category,
                mailboxId: run.mailboxId,
                messageIds,
                signal,
                userId: run.userId,
              }),
            ),
          readGmailThread: ({ threadId }: { threadId: string }) =>
            runMailTool(abortController.signal, (signal) =>
              readGmailThreadForUser({
                category,
                mailboxId: run.mailboxId,
                signal,
                threadId,
                userId: run.userId,
              }),
            ),
          searchGmail: ({ maxResults, pageToken, query }) =>
            runMailTool(abortController.signal, (signal) =>
              searchGmailForUser({
                category,
                mailboxId: run.mailboxId,
                maxResults,
                pageToken,
                query,
                signal,
                userId: run.userId,
              }),
            ),
        };
        const tools = [
          composeEmailToolDef,
          createGmailAttachmentServerTool(context),
          createGmailLabelListServerTool(context),
          createGmailMessageServerTool(context),
          createGmailMessagesServerTool(context),
          createGmailSearchServerTool(context),
          createGmailThreadServerTool(context),
          createMailboxOverviewServerTool(context),
          createModifyMailServerTool(context),
        ];
        const memoryContext: UserAiContextToolsContext = {
          rememberUserPreference: async ({ preference, reason }) => {
            const event = await recordUserAiContextEvent({
              kind: "explicit_preference",
              mailboxId: run.mailboxId,
              metadata: {
                preference,
                reason: reason ?? null,
                source: "chat",
              },
              userId: run.userId,
            });

            if (!event) return { status: "skipped" };

            if (!abortController.signal.aborted) {
              void refreshUserAiContext({
                mailboxId: run.mailboxId,
                triggerEventId: event.id,
                userId: run.userId,
              }).catch((error) => {
                console.error("Could not refresh user AI context from chat preference.", error);
              });
            }

            return { status: "recorded" };
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

        if (hasLinearConnector) {
          const linearContext: LinearToolsContext = {
            createLinearIssue: (issue) =>
              createLinearIssueForUser({
                issue,
                signal: abortController.signal,
                userId: run.userId,
              }),
            listLinearIssueMetadata: () =>
              listLinearIssueMetadataForUser({
                signal: abortController.signal,
                userId: run.userId,
              }),
          };
          tools.push(createLinearIssueMetadataServerTool(linearContext));
          tools.push(createLinearIssueServerTool(linearContext));
        }

        return tools;
      })(),
    });

    const finalParts = (getStreamingAssistantParts(finalMessages, streamStartMessageCount) ??
      pendingParts) as ChatMessagePart[];
    pendingParts = finalParts;
    await settleUsageReports();
    await drainAssistantDraftPersist();
    const terminal = await terminalizeChatRun({
      parts: finalParts,
      runId,
      status: cancelled || abortController.signal.aborted ? "cancelled" : "complete",
    });

    if (terminal) {
      publishChatRunEvent(runId, { ...terminal, type: "done" });
    }
  } catch (error) {
    await settleUsageReports();

    if (cancelled || abortController.signal.aborted) {
      await drainAssistantDraftPersist();
      const terminal = await terminalizeChatRun({
        parts: pendingParts,
        runId,
        status: "cancelled",
      });

      if (terminal) {
        publishChatRunEvent(runId, { ...terminal, type: "done" });
      }
      return;
    }

    console.error(`Chat generation ${runId} failed.`, error);
    await drainAssistantDraftPersist();
    await terminalizeFailedChatRun(runId, getChatRunFailureMessage(error), {
      id: run.assistantMessageId,
      parts: pendingParts,
    });
  } finally {
    clearInterval(cancelPoll);
    clearInterval(heartbeat);
    unregisterController();

    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
  }
};
