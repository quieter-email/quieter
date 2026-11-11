"use client";

import { useChat } from "@ai-sdk/react";
import {
  modifyMailBatchResultSchema,
  modifyMailResultSchema,
} from "@quieter/ai/chat-agent";
import type { ChatMailContext } from "@quieter/ai/chat-context";
import type { ChatModel } from "@quieter/ai/chat-models";
import {
  requiresChatToolApproval,
  resolveLinearToolReview,
  resolveConnectorWriteReview,
  foregroundSnapshotSchema,
  isForegroundClientToolName,
  isCalendarWriteToolName,
  calendarWriteInputSchemas,
  resolveCalendarWriteReview,
  saveComposeDraftInputSchema,
  saveComposeDraftOutputSchema,
  sendMailOutputSchema,
} from "@quieter/ai/chat-tools";
import type { ForegroundSnapshot } from "@quieter/ai/chat-tools";
import { toCanonicalTranscript } from "@quieter/ai/chat-transcript";
import {
  hasOrganizationAiAccess,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "@quieter/app/features/settings/domain/billing";
import { authClient } from "@quieter/app/lib/auth";
import { applyCalendarMutationReceipt } from "@quieter/app/lib/calendar-cache-lifecycle";
import {
  chatQueryOptions,
  getChatsQueryKey,
} from "@quieter/app/lib/chat-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/index";
import {
  getMailboxThreadQueriesKey,
  getThreadQueryKey,
} from "@quieter/app/lib/mail/thread-query-keys";
import { rpc } from "@quieter/app/lib/orpc";
import { inboxRouteApi } from "@quieter/app/lib/route-apis";
import { appFetch, getApiUrl } from "@quieter/app/runtime";
import { calendarMutationResultSchema } from "@quieter/calendar";
import { reminderSchema } from "@quieter/mail/reminders";
import type { RouterOutputs } from "@quieter/orpc";
import { decodeChatStreamError } from "@quieter/orpc/chat-errors";
import { Button } from "@quieter/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { DefaultChatTransport, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { emptyChatQueue, updateChatQueue } from "../domain/chat-queue";
import type {
  ChatQueues,
  ChatQueueStore,
  QueuedChatMessage,
} from "../domain/chat-queue";
import {
  cancelForegroundMessages,
  needsForegroundContinuation,
} from "../domain/foreground-messages";
import { useChatDictation } from "../domain/use-chat-dictation";
import { useChatMailContext } from "../domain/use-chat-mail-context";
import { useAgentWorkspace } from "../domain/workspace-context";
import { executeWorkspaceTool } from "../domain/workspace-tools";
import type { ChatViewProps } from "../types";
import { ChatComposer } from "./chat-composer";
import { ChatContextPicker } from "./chat-context-picker";
import { ChatTranscript } from "./chat-transcript";

type ChatData = RouterOutputs["chat"]["get"];
type ChatEdit = {
  chatId: string;
  messageId: string;
  originalMessages: UIMessage[];
  source: { chatId: string; messageId: string };
};

const ChatSession = ({
  chatData,
  canUseAiChat,
  queues,
  ...props
}: ChatViewProps & {
  chatData?: ChatData;
  canUseAiChat: boolean;
  queues: ChatQueueStore;
}) => {
  const workspace = useAgentWorkspace();
  if (!workspace) {
    throw new Error("The assistant needs a mail workspace.");
  }
  const queryClient = useQueryClient();
  const userId = authClient.useSession().data?.user.id;
  const activeWorkspace = inboxRouteApi.useSearch({
    select: (search) => search.workspace,
  });
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ChatModel | "auto">("auto");
  const mailContext = useChatMailContext(
    workspace.mailboxId,
    activeWorkspace === "calendar" ? undefined : props.mailContext
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useChatDictation({
    chatId: props.chatId,
    enabled: canUseAiChat && props.visible !== false,
    mailboxId: workspace.mailboxId,
    onTranscript: (text) => {
      setInput((current) =>
        current.trim() ? `${current.trimEnd()} ${text}` : text
      );
      inputRef.current?.focus();
    },
  });
  // oxlint-disable-next-line react/hook-use-state -- The session identity is fixed until this keyed component unmounts.
  const [tabId] = useState(() => crypto.randomUUID());
  const threadId = props.chatId ?? props.draftChatKey;
  const queueKey = `${workspace.mailboxId}:${threadId}`;
  const [busy, setBusy] = useState(false);
  const [editSession, setEditSession] = useState<{
    chatId: string;
    opening: boolean;
  } | null>(null);
  const openingEdit = editSession?.opening === true;
  const activeQueueKey =
    editSession === null
      ? queueKey
      : `${workspace.mailboxId}:${editSession.chatId}`;
  const queue = useSelector(
    queues,
    (state) => state.get(activeQueueKey) ?? emptyChatQueue
  );
  const canceling = queue.phase === "canceling";
  const foregroundActive = useSelector(
    workspace.control.state,
    (state) => state.active
  );
  const [completedAssistantMessageId, setCompletedAssistantMessageId] =
    useState<string | null>(null);
  const [interruptionMessage, setInterruptionMessage] = useState("");
  const foregroundRef = useRef<ForegroundSnapshot | null>(null);
  const editRef = useRef<ChatEdit | null>(null);
  const requestContextRef = useRef<{
    category?: QueuedChatMessage["category"];
    context: ChatMailContext;
    model?: ChatModel;
  } | null>(null);
  const mountedRef = useRef(true);
  const appliedReceipts = useRef(new Set<string>());
  const latestRef = useRef({ props });
  useLayoutEffect(() => {
    latestRef.current = { props };
  });
  const synchronizeHistory = async () => {
    try {
      await queryClient.query(chatQueryOptions(workspace.mailboxId, threadId));
      if (mountedRef.current) {
        props.onChatIdChange(threadId);
      }
    } catch (error) {
      toastError(error, { boundary: "assistant-history" });
    }
  };
  const openEditedChat = async (
    edit: ChatEdit,
    setMessages: (messages: UIMessage[]) => void
  ) => {
    setEditSession({ chatId: edit.chatId, opening: true });
    let opened = false;
    try {
      const saved = await queryClient.query({
        ...chatQueryOptions(workspace.mailboxId, edit.chatId),
        retry: false,
      });
      if (mountedRef.current && editRef.current === edit) {
        if (saved.messages.some((message) => message.id === edit.messageId)) {
          opened = true;
          props.onChatIdChange(edit.chatId);
        } else {
          setMessages(edit.originalMessages);
        }
      }
    } catch (error) {
      if (mountedRef.current && editRef.current === edit) {
        setMessages(edit.originalMessages);
        if (
          !(error instanceof Error && "status" in error && error.status === 404)
        ) {
          toastError(error, { boundary: "assistant-history" });
        }
      }
    } finally {
      if (mountedRef.current && editRef.current === edit) {
        editRef.current = null;
        if (!opened) {
          updateChatQueue(queues, queueKey, {
            sourceKey: `${workspace.mailboxId}:${edit.chatId}`,
            type: "return-edit",
          });
          setEditSession(null);
        }
      }
    }
  };
  const refreshMailQueries = async (
    queryKeys: readonly (readonly unknown[])[]
  ) => {
    try {
      await Promise.all(
        queryKeys.map(async (queryKey) => {
          await queryClient.invalidateQueries({ queryKey });
        })
      );
    } catch (error) {
      toastError(error, { boundary: "assistant-mail-refresh" });
    }
  };
  // oxlint-disable-next-line react/hook-use-state -- useChat keeps one transport per session.
  const [transport] = useState(
    // oxlint-disable-next-line react/react-compiler, react/refs -- The transport reads refs only when a request starts, never during render.
    () =>
      new DefaultChatTransport({
        api: getApiUrl("/api/chat"),
        fetch: async (url, init) => {
          const response = await appFetch(url, init);
          if (!response.ok) {
            throw Object.assign(new Error(await response.text()), {
              status: response.status,
            });
          }
          return response;
        },
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const foreground = foregroundRef.current;
          if (
            !foreground ||
            !workspace.control.isCurrent(foreground.generation)
          ) {
            throw new Error("Start a new request to continue.");
          }
          const edit = editRef.current;
          const message = messages.at(-1);
          return {
            body: {
              category: latestRef.current.props.activeMailbox,
              ...requestContextRef.current,
              ...(edit !== null && message?.id === edit.messageId
                ? { editSource: edit.source }
                : {}),
              foreground: { ...foreground, expiresAt: Date.now() + 120_000 },
              mailboxId: workspace.mailboxId,
              message,
              threadId: edit?.chatId ?? threadId,
              trigger,
            },
          };
        },
      })
  );
  const chat = useChat({
    id: threadId,
    messages: cancelForegroundMessages(
      toCanonicalTranscript(chatData?.messages ?? [])
    ),
    onError: (error) => {
      const foreground = foregroundRef.current;
      if (
        !mountedRef.current ||
        foreground === null ||
        !workspace.control.isCurrent(foreground.generation)
      ) {
        return;
      }
      setCompletedAssistantMessageId(null);
      toastError(decodeChatStreamError(error), { boundary: "assistant-chat" });
    },
    onFinish: ({
      message,
      messages,
      isAbort,
      isDisconnect,
      isError,
      finishReason,
    }) => {
      const foreground = foregroundRef.current;
      const edit = editRef.current;
      const currentRun =
        mountedRef.current &&
        foreground !== null &&
        workspace.control.isCurrent(foreground.generation);
      let mailboxChanged = false;
      for (const part of message.parts) {
        if (
          !isToolUIPart(part) ||
          part.state !== "output-available" ||
          appliedReceipts.current.has(part.toolCallId)
        ) {
          continue;
        }
        const toolName = part.type.replace("tool-", "");
        if (toolName === "modify_mail" || toolName === "modify_mail_batch") {
          const changed =
            toolName === "modify_mail_batch"
              ? modifyMailBatchResultSchema
                  .safeParse(part.output)
                  .data?.results.some((result) => result.status === "success")
              : modifyMailResultSchema.safeParse(part.output).data?.status ===
                "success";
          if (changed === true) {
            appliedReceipts.current.add(part.toolCallId);
            mailboxChanged = true;
          }
          continue;
        }
        if (toolName === "create_reminder" || toolName === "change_reminder") {
          const receipt = reminderSchema.safeParse(part.output);
          if (
            receipt.success &&
            receipt.data.mailboxId === workspace.mailboxId
          ) {
            appliedReceipts.current.add(part.toolCallId);
            void queryClient.invalidateQueries({
              queryKey: ["reminders", workspace.mailboxId, "remote"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["reminder-suggestion", workspace.mailboxId],
            });
          }
          continue;
        }
        if (isCalendarWriteToolName(toolName)) {
          const receipt = calendarMutationResultSchema.safeParse(part.output);
          const command = calendarWriteInputSchemas[toolName].safeParse(
            part.input
          );
          const expectedAction = {
            create_calendar_event: "created",
            delete_calendar_event: "deleted",
            respond_to_calendar_event: "responded",
            update_calendar_event: "updated",
          }[toolName];
          if (
            userId !== undefined &&
            receipt.success &&
            command.success &&
            receipt.data.action === expectedAction &&
            receipt.data.connectionId === command.data.connectionId &&
            receipt.data.calendarId === command.data.calendarId &&
            (!("eventId" in command.data) ||
              receipt.data.eventId === command.data.eventId)
          ) {
            appliedReceipts.current.add(part.toolCallId);
            void (async () => {
              try {
                await applyCalendarMutationReceipt(
                  queryClient,
                  userId,
                  receipt.data
                );
              } catch (error) {
                toastError(error, { boundary: "assistant-calendar-refresh" });
              }
            })();
          }
          continue;
        }
        if (
          part.type !== "tool-save_compose_draft" &&
          part.type !== "tool-send_mail"
        ) {
          continue;
        }
        const receipt =
          part.type === "tool-send_mail"
            ? sendMailOutputSchema.safeParse(part.output)
            : saveComposeDraftOutputSchema.safeParse(part.output);
        if (receipt.success) {
          appliedReceipts.current.add(part.toolCallId);
          if (currentRun) {
            workspace.getCompose()?.applyReceipt(receipt.data);
          }
          const draftInput = saveComposeDraftInputSchema.safeParse(part.input);
          const affectedThreadId =
            "threadId" in receipt.data ? receipt.data.threadId : undefined;
          const replyThreadId = draftInput.success
            ? draftInput.data.draft.replyContext?.threadId
            : undefined;
          const affectedKeys = [
            getMessagesQueryKey(workspace.mailboxId, "drafts").slice(0, 3),
            ...(receipt.data.status === "sent"
              ? [getMessagesQueryKey(workspace.mailboxId, "sent").slice(0, 3)]
              : []),
            ...[...new Set([affectedThreadId, replyThreadId])].flatMap((id) =>
              id ? [getThreadQueryKey(workspace.mailboxId, id)] : []
            ),
          ];
          void refreshMailQueries(affectedKeys);
        }
      }
      if (mailboxChanged) {
        void refreshMailQueries([
          getMessagesQueryKey(workspace.mailboxId, "inbox").slice(0, 2),
          getMailboxThreadQueriesKey(workspace.mailboxId),
        ]);
      }
      if (!currentRun) {
        if (edit !== null && isAbort && mountedRef.current) {
          void openEditedChat(edit, chat.setMessages);
        }
        return;
      }
      const interrupted =
        !isAbort && (finishReason === undefined || finishReason === "error");
      if (isDisconnect || (interrupted && !isError)) {
        setInterruptionMessage("The reply was interrupted.");
      } else if (finishReason === "length") {
        setInterruptionMessage("The response was cut short.");
      }
      if (isError || interrupted) {
        chat.setMessages(cancelForegroundMessages(messages));
      }
      const last = messages.at(-1);
      const pending = last?.parts.some(
        (part) =>
          isToolUIPart(part) &&
          (part.state === "input-available" ||
            part.state === "approval-requested")
      );
      const terminal =
        isAbort ||
        isError ||
        interrupted ||
        (pending !== true && !needsForegroundContinuation(messages));
      if (terminal) {
        updateChatQueue(
          queues,
          edit === null ? queueKey : `${workspace.mailboxId}:${edit.chatId}`,
          {
            type:
              isAbort ||
              isError ||
              interrupted ||
              isDisconnect ||
              finishReason === "length" ||
              finishReason === "content-filter"
                ? "pause"
                : "finish",
          }
        );
        setCompletedAssistantMessageId(
          !isAbort && !isError && !interrupted && last?.role === "assistant"
            ? last.id
            : null
        );
        foregroundRef.current = null;
        workspace.control.finish();
      }
      void queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(workspace.mailboxId),
      });
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      if (terminal) {
        if (edit !== null) {
          void openEditedChat(edit, chat.setMessages);
        } else if (!isError && !interrupted && props.chatId === null) {
          void synchronizeHistory();
        }
      }
    },
    onToolCall: async ({ toolCall }) => {
      if (!isForegroundClientToolName(toolCall.toolName)) {
        return;
      }
      const generation = foregroundRef.current?.generation;
      if (
        generation === undefined ||
        !workspace.control.isCurrent(generation)
      ) {
        return;
      }
      try {
        const output = await executeWorkspaceTool(
          workspace,
          toolCall.toolName,
          toolCall.input,
          generation
        );
        if (workspace.control.isCurrent(generation)) {
          void chat.addToolOutput({
            output,
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          });
        }
      } catch (error) {
        if (workspace.control.isCurrent(generation)) {
          void chat.addToolOutput({
            errorText:
              error instanceof Error
                ? error.message
                : "The action could not be completed.",
            state: "output-error",
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          });
        }
      }
    },
    sendAutomaticallyWhen: ({ messages }) => {
      const generation = foregroundRef.current?.generation;
      return (
        generation !== undefined &&
        workspace.control.isCurrent(generation) &&
        needsForegroundContinuation(messages)
      );
    },
    throttle: 50,
    transport,
  });
  const chatRef = useRef(chat);
  useLayoutEffect(() => {
    chatRef.current = chat;
  });

  useEffect(() => {
    mountedRef.current = true;
    const cancelServer = async (assistantMessageId: string, chatId: string) => {
      try {
        await rpc.chat.cancel({
          assistantMessageId,
          chatId,
          mailboxId: workspace.mailboxId,
        });
      } catch (error) {
        toastError(error, { boundary: "assistant-cancel" });
      }
    };
    const cancel = () => {
      const foreground = foregroundRef.current;
      if (!foreground || workspace.control.isCurrent(foreground.generation)) {
        return;
      }
      foregroundRef.current = null;
      setCompletedAssistantMessageId(null);
      const activeChatId = editRef.current?.chatId ?? threadId;
      const canceledQueueKey = `${workspace.mailboxId}:${activeChatId}`;
      updateChatQueue(queues, canceledQueueKey, { type: "cancel" });
      const stopped = chatRef.current.stop();
      chatRef.current.setMessages(
        cancelForegroundMessages(chatRef.current.messages)
      );
      void (async () => {
        await Promise.allSettled([
          stopped,
          cancelServer(foreground.exchangeId, activeChatId),
        ]);
        updateChatQueue(queues, canceledQueueKey, { type: "canceled" });
      })();
    };
    const subscription = workspace.control.state.subscribe(() => {
      if (
        workspace.control.state.get().generation !==
        foregroundRef.current?.generation
      ) {
        cancel();
      }
    });
    return () => {
      mountedRef.current = false;
      const foreground = foregroundRef.current;
      if (
        foreground !== null &&
        workspace.control.isCurrent(foreground.generation)
      ) {
        workspace.control.cancel();
      }
      subscription.unsubscribe();
    };
  }, [queues, threadId, workspace]);

  const streaming = chat.status === "streaming" || chat.status === "submitted";
  const approvals = chat.messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (
        !isToolUIPart(part) ||
        !requiresChatToolApproval({
          input: part.input,
          toolName: part.type.replace("tool-", ""),
        }) ||
        part.state !== "approval-requested"
      ) {
        return [];
      }
      const toolName = part.type.replace("tool-", "");
      return [
        {
          approve: () => {
            if (
              foregroundRef.current &&
              workspace.control.isCurrent(foregroundRef.current.generation)
            ) {
              if (isCalendarWriteToolName(toolName)) {
                if (
                  resolveCalendarWriteReview({
                    input: part.input,
                    toolName,
                    transcript: [message],
                  }) === undefined
                ) {
                  void chat.addToolApprovalResponse({
                    approved: false,
                    id: part.approval.id,
                    reason:
                      "Read the destination calendar and current event before requesting approval again.",
                  });
                  return;
                }
                void chat.addToolApprovalResponse({
                  approved: true,
                  id: part.approval.id,
                });
                return;
              }
              if (
                (toolName === "linear_write" ||
                  toolName === "connector_write") &&
                (toolName === "linear_write"
                  ? resolveLinearToolReview
                  : resolveConnectorWriteReview)({
                  input: part.input,
                  transcript: [message],
                }) === undefined
              ) {
                void chat.addToolApprovalResponse({
                  approved: false,
                  id: part.approval.id,
                });
                return;
              }
              void chat.addToolApprovalResponse({
                approved: true,
                id: part.approval.id,
              });
            }
          },
          calendarReview: isCalendarWriteToolName(toolName)
            ? resolveCalendarWriteReview({
                input: part.input,
                toolName,
                transcript: [message],
              })
            : undefined,
          connectorReview:
            toolName === "connector_write"
              ? resolveConnectorWriteReview({
                  input: part.input,
                  transcript: [message],
                })
              : undefined,
          deny: () => {
            if (
              foregroundRef.current &&
              workspace.control.isCurrent(foregroundRef.current.generation)
            ) {
              void chat.addToolApprovalResponse({
                approved: false,
                id: part.approval.id,
              });
            }
          },
          id: part.approval.id,
          linearReview:
            toolName === "linear_write"
              ? resolveLinearToolReview({
                  input: part.input,
                  transcript: [message],
                })
              : undefined,
          toolCallId: part.toolCallId,
          toolName: part.type.replace("tool-", ""),
        },
      ];
    })
  );
  const errorMessage = streaming
    ? ""
    : interruptionMessage ||
      (chat.error ? decodeChatStreamError(chat.error).message : "");
  const lastUserIndex = chat.messages.findLastIndex(
    (message) => message.role === "user"
  );
  const lastUserMessage =
    lastUserIndex === -1 ? undefined : chat.messages[lastUserIndex];
  const lastUserText =
    lastUserMessage?.parts
      .flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [part.text] : []
      )
      .join(" ") ?? "";
  const retriedTurnOpen =
    lastUserMessage !== undefined &&
    !chat.messages
      .slice(lastUserIndex + 1)
      .some(
        (message) =>
          message.role === "assistant" &&
          message.parts.some(
            (part) =>
              isToolUIPart(part) ||
              (part.type === "text" && part.text.trim() !== "")
          )
      );
  const canRetry =
    errorMessage !== "" &&
    lastUserText.trim() !== "" &&
    retriedTurnOpen &&
    !streaming &&
    approvals.length === 0 &&
    canUseAiChat;
  const turnActive = foregroundActive || streaming || approvals.length > 0;
  const composerDisabled = !canUseAiChat || openingEdit;
  const audioActive =
    dictation.isRecording || dictation.isStarting || dictation.isTranscribing;
  const submissionBlocked =
    composerDisabled || audioActive || turnActive || busy || canceling;
  const queueing = turnActive || busy || canceling || queue.items.length > 0;
  const submit = async (
    resubmit?:
      | { kind: "edit" | "retry"; messageId: string; text: string }
      | { kind: "queued"; message: QueuedChatMessage },
    suggestion?: string
  ) => {
    const text = (
      resubmit?.kind === "queued"
        ? resubmit.message.text
        : (resubmit?.text ?? suggestion ?? input)
    ).trim();
    if (
      !text ||
      submissionBlocked ||
      workspace.control.state.get().active ||
      editRef.current !== null
    ) {
      return;
    }
    let edit: ChatEdit | null = null;
    let editIndex = -1;
    if (resubmit?.kind === "edit") {
      editIndex = chat.messages.findIndex(
        (message) =>
          message.id === resubmit.messageId && message.role === "user"
      );
      if (props.chatId === null || editIndex === -1) {
        return;
      }
      edit = {
        chatId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        originalMessages: chat.messages,
        source: { chatId: props.chatId, messageId: resubmit.messageId },
      };
    }
    const runQueueKey =
      edit === null ? queueKey : `${workspace.mailboxId}:${edit.chatId}`;
    updateChatQueue(queues, runQueueKey, { type: "start" });
    setBusy(true);
    setCompletedAssistantMessageId(null);
    setInterruptionMessage("");
    const generation = workspace.control.begin();
    try {
      const snapshot = workspace.read();
      const context =
        resubmit?.kind === "queued"
          ? resubmit.message.context
          : mailContext.context;
      requestContextRef.current =
        resubmit?.kind === "queued"
          ? {
              category: resubmit.message.category,
              context,
              model: resubmit.message.model,
            }
          : { context, ...(model === "auto" ? {} : { model }) };
      foregroundRef.current = foregroundSnapshotSchema.parse({
        calendar: snapshot.calendar,
        capabilities:
          snapshot.workspace === "calendar"
            ? ["navigate", "modify_calendar"]
            : [
                "navigate",
                "compose",
                "edit_compose",
                "save_draft",
                "send_mail",
                "modify_mail",
                "modify_calendar",
              ],
        draftId: snapshot.draftId,
        draftRevision: snapshot.draftRevision,
        exchangeId: crypto.randomUUID(),
        expiresAt: Date.now() + 120_000,
        generation,
        query: context.query,
        selectedMessageId:
          context.messageIds?.includes(snapshot.selectedMessageId ?? "") ===
          true
            ? snapshot.selectedMessageId
            : undefined,
        selectedThreadId: context.threadId,
        tabId,
        view: snapshot.view,
        workspace: snapshot.workspace,
      });
      if (resubmit === undefined && suggestion === undefined) {
        setInput("");
      }
      chat.clearError();
      if (edit === null) {
        await chat.sendMessage(
          resubmit === undefined || resubmit.kind === "queued"
            ? { text }
            : { messageId: resubmit.messageId, text }
        );
      } else {
        editRef.current = edit;
        setEditSession({ chatId: edit.chatId, opening: false });
        chat.setMessages(edit.originalMessages.slice(0, editIndex));
        await chat.sendMessage({
          id: edit.messageId,
          parts: [{ text, type: "text" }],
          role: "user",
        });
      }
    } catch (error) {
      if (edit !== null && editRef.current === edit) {
        editRef.current = null;
        setEditSession(null);
        chat.setMessages(edit.originalMessages);
      }
      if (resubmit === undefined && suggestion === undefined) {
        setInput(text);
      }
      if (resubmit?.kind === "queued") {
        updateChatQueue(queues, runQueueKey, {
          message: resubmit.message,
          type: "restore",
        });
      } else {
        updateChatQueue(queues, runQueueKey, { type: "pause" });
      }
      if (workspace.control.isCurrent(generation)) {
        foregroundRef.current = null;
        workspace.control.finish();
      }
      toastError(error, { boundary: "assistant-submit" });
    } finally {
      setBusy(false);
    }
  };
  const sendOrQueue = (suggestion?: string) => {
    const text = (suggestion ?? input).trim();
    if (!text || composerDisabled || audioActive) {
      return;
    }
    if (!queueing && !workspace.control.state.get().active) {
      void submit(undefined, suggestion);
      return;
    }
    updateChatQueue(queues, activeQueueKey, {
      message: {
        category: props.activeMailbox,
        context: mailContext.context,
        id: crypto.randomUUID(),
        ...(model === "auto" ? {} : { model }),
        text,
      },
      type: "add",
    });
    if (suggestion === undefined) {
      setInput("");
    }
  };
  const drainQueue = useEffectEvent(() => {
    const next = queues.get().get(queueKey);
    const message = next?.items[0];
    if (
      submissionBlocked ||
      editRef.current !== null ||
      editSession !== null ||
      workspace.control.state.get().active ||
      next?.phase !== "ready" ||
      message === undefined
    ) {
      return;
    }
    updateChatQueue(queues, queueKey, { id: message.id, type: "take" });
    void submit({ kind: "queued", message });
  });
  useEffect((): (() => void) | undefined => {
    if (
      !submissionBlocked &&
      queue.phase === "ready" &&
      queue.items.length > 0
    ) {
      const scheduled = window.setTimeout(() => {
        drainQueue();
      }, 0);
      return () => {
        window.clearTimeout(scheduled);
      };
    }
    return undefined;
  }, [queue, submissionBlocked]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-assistant-loading={streaming || busy || openingEdit ? "" : undefined}
    >
      {chat.messages.length > 0 || errorMessage !== "" ? (
        <ChatTranscript
          completedAssistantMessageId={completedAssistantMessageId}
          docked={props.docked}
          edit={
            props.chatId !== null && canUseAiChat
              ? {
                  disabled: submissionBlocked,
                  onSubmit: (messageId, text) => {
                    void submit({ kind: "edit", messageId, text });
                  },
                }
              : undefined
          }
          messages={chat.messages}
          isStreaming={streaming}
          approvals={approvals}
          errorMessage={errorMessage}
          onSuggestion={sendOrQueue}
          onRetry={
            canRetry && lastUserMessage !== undefined
              ? () => {
                  void submit({
                    kind: "retry",
                    messageId: lastUserMessage.id,
                    text: lastUserText,
                  });
                }
              : undefined
          }
        />
      ) : null}
      {canUseAiChat ? null : (
        <p className="px-4 py-4 text-body-sm text-muted-fg">
          Choose a plan with AI credits in settings to use quieter.
        </p>
      )}
      <ChatComposer
        mailboxId={workspace.mailboxId}
        placeholder={
          activeWorkspace === "calendar"
            ? "Ask about your calendar…"
            : undefined
        }
        input={input}
        inputRef={inputRef}
        model={model}
        onModelChange={setModel}
        recording={dictation.isRecording}
        recordingAnalyser={dictation.analyser}
        recordingSupported={dictation.isSupported}
        startingRecording={dictation.isStarting}
        transcribing={dictation.isTranscribing}
        onToggleDictation={() => {
          void dictation.toggle();
        }}
        onCancelDictation={() => {
          dictation.cancel();
        }}
        disabled={composerDisabled}
        streaming={turnActive}
        queueing={queueing}
        queue={{
          canResume: !submissionBlocked,
          items: queue.items,
          onRemove: (id) => {
            updateChatQueue(queues, activeQueueKey, { id, type: "remove" });
          },
          onResume: () => {
            updateChatQueue(queues, activeQueueKey, { type: "resume" });
          },
          paused: queue.phase === "paused" || canceling,
        }}
        contextItems={mailContext.contextItems}
        contextPicker={
          <ChatContextPicker
            attachedMessageIds={mailContext.attachedMessageIds}
            disabled={composerDisabled}
            mailboxId={workspace.mailboxId}
            initialCategory={props.activeMailbox}
            onSelect={mailContext.handleAttach}
          />
        }
        onRemoveContext={mailContext.handleRemove}
        onInputChange={setInput}
        onInputKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            sendOrQueue();
          }
        }}
        onStop={() => {
          setCompletedAssistantMessageId(null);
          workspace.control.cancel();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          sendOrQueue();
        }}
      />
    </div>
  );
};

export const ChatView = (props: ChatViewProps) => {
  const queues = useCreateStore<ChatQueues>(new Map());
  const { data: billing, isPending } = useQuery(userBillingQueryOptions());
  const {
    data: chatData,
    isError: isChatError,
    isPending: isChatPending,
    refetch: refetchChat,
  } = useQuery(chatQueryOptions(props.mailboxId, props.chatId));
  if (isPending || (props.chatId !== null && isChatPending)) {
    return (
      <p className="p-4 text-body-sm text-muted-fg" data-assistant-loading>
        Loading assistant…
      </p>
    );
  }
  if (props.chatId !== null && isChatError) {
    return (
      <div className="p-4 text-body-sm text-muted-fg">
        Could not load this conversation.
        <Button
          variant="ghost"
          onClick={() => {
            void refetchChat();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  return (
    <ChatSession
      key={`${props.mailboxId}:${props.chatId ?? props.draftChatKey}`}
      {...props}
      chatData={chatData}
      queues={queues}
      canUseAiChat={
        !isPending &&
        !!billing &&
        hasOrganizationAiAccess(billing, props.mailboxOrganizationId)
      }
    />
  );
};
