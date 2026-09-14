"use client";

import { useChat } from "@ai-sdk/react";
import {
  foregroundSnapshotSchema,
  isForegroundClientToolName,
  saveComposeDraftInputSchema,
  saveComposeDraftOutputSchema,
  sendMailOutputSchema,
} from "@quieter/ai/chat-tools";
import type { ForegroundSnapshot } from "@quieter/ai/chat-tools";
import { toCanonicalTranscript } from "@quieter/ai/chat-transcript";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  hasOrganizationAiAccess,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "#/features/settings/domain/billing";
import { chatQueryOptions, getChatsQueryKey } from "#/lib/chat-query";
import { toastError } from "#/lib/error-toast";
import { getMessagesQueryKey } from "#/lib/mail/inbox-query";
import { getThreadQueryKey } from "#/lib/mail/thread-query-keys";
import { rpc } from "#/lib/orpc";

import {
  cancelForegroundMessages,
  needsForegroundContinuation,
} from "../domain/foreground-messages";
import { useAgentWorkspace } from "../domain/workspace-context";
import { executeWorkspaceTool } from "../domain/workspace-tools";
import type { ChatViewProps } from "../types";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

type ChatData = RouterOutputs["chat"]["get"];

const ChatSession = ({
  chatData,
  canUseAiChat,
  ...props
}: ChatViewProps & { chatData?: ChatData; canUseAiChat: boolean }) => {
  const workspace = useAgentWorkspace();
  if (!workspace) {
    throw new Error("The assistant needs a mail workspace.");
  }
  const queryClient = useQueryClient();
  const policy = useSelector(workspace.control.state, (state) => state.policy);
  const [input, setInput] = useState("");
  const contextKey = JSON.stringify([
    props.mailContext?.messageId,
    props.mailContext?.query,
    props.mailContext?.threadId,
  ]);
  const [dismissedContext, setDismissedContext] = useState<string | null>(null);
  const contextDismissed = dismissedContext === contextKey;
  // oxlint-disable-next-line react/hook-use-state -- The session identity is fixed until this keyed component unmounts.
  const [tabId] = useState(() => crypto.randomUUID());
  const threadId = props.chatId ?? props.draftChatKey;
  const [busy, setBusy] = useState(false);
  const foregroundRef = useRef<ForegroundSnapshot | null>(null);
  const mountedRef = useRef(true);
  const appliedReceipts = useRef(new Set<string>());
  const latestRef = useRef({ props });
  useLayoutEffect(() => {
    latestRef.current = { props };
  });
  const synchronizeHistory = async () => {
    try {
      await queryClient.fetchQuery(
        chatQueryOptions(workspace.mailboxId, threadId)
      );
      if (mountedRef.current) {
        props.onChatIdChange(threadId);
      }
    } catch (error) {
      toastError(error, { boundary: "assistant-history" });
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
    // oxlint-disable-next-line react/react-compiler -- The transport reads refs only when a request starts, never during render.
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const foreground = foregroundRef.current;
          if (!foreground) {
            throw new Error("Start a new request to continue.");
          }
          workspace.control.claimLeg(foreground.generation);
          return {
            body: {
              category: latestRef.current.props.activeMailbox,
              foreground,
              mailboxId: workspace.mailboxId,
              message: messages.at(-1),
              threadId,
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
    onError: () => {
      workspace.control.finish();
    },
    onFinish: ({ messages, isAbort, isError }) => {
      for (const message of messages) {
        for (const part of message.parts) {
          if (
            !isToolUIPart(part) ||
            part.state !== "output-available" ||
            appliedReceipts.current.has(part.toolCallId)
          ) {
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
            workspace.getCompose()?.applyReceipt(receipt.data);
            const draftInput = saveComposeDraftInputSchema.safeParse(
              part.input
            );
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
              ...[...new Set([affectedThreadId, replyThreadId])].flatMap(
                (id) => (id ? [getThreadQueryKey(workspace.mailboxId, id)] : [])
              ),
            ];
            void refreshMailQueries(affectedKeys);
          }
        }
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
        (pending !== true && !needsForegroundContinuation(messages));
      if (terminal) {
        foregroundRef.current = null;
        workspace.control.finish();
      }
      void queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(workspace.mailboxId),
      });
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      if (terminal && props.chatId === null && mountedRef.current) {
        void synchronizeHistory();
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
    const cancelServer = async (assistantMessageId: string) => {
      try {
        await rpc.chat.cancel({
          assistantMessageId,
          chatId: threadId,
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
      void chatRef.current.stop();
      chatRef.current.setMessages(
        cancelForegroundMessages(chatRef.current.messages)
      );
      void cancelServer(foreground.exchangeId);
    };
    const subscription = workspace.control.state.subscribe(() => {
      if (
        workspace.control.state.get().generation !==
        foregroundRef.current?.generation
      ) {
        cancel();
      }
    });
    const timeout = window.setInterval(() => {
      const foreground = foregroundRef.current;
      if (
        foreground &&
        !workspace.control.isCurrent(foreground.generation) &&
        workspace.control.state.get().active
      ) {
        workspace.control.cancel();
      }
    }, 1000);
    return () => {
      mountedRef.current = false;
      workspace.control.cancel();
      subscription.unsubscribe();
      window.clearInterval(timeout);
    };
  }, [threadId, workspace]);

  const streaming = chat.status === "streaming" || chat.status === "submitted";
  const approvals = chat.messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (!isToolUIPart(part) || part.state !== "approval-requested") {
        return [];
      }
      return [
        {
          approve: () => {
            if (
              foregroundRef.current &&
              workspace.control.isCurrent(foregroundRef.current.generation)
            ) {
              if (
                part.type === "tool-send_mail" ||
                part.type === "tool-save_compose_draft"
              ) {
                const proposed = saveComposeDraftInputSchema.safeParse(
                  part.input
                );
                const currentDraft = saveComposeDraftInputSchema.safeParse({
                  draft: workspace.read().draft,
                });
                const matches =
                  proposed.success &&
                  currentDraft.success &&
                  JSON.stringify(proposed.data) ===
                    JSON.stringify(currentDraft.data);
                if (!matches) {
                  void chat.addToolApprovalResponse({
                    approved: false,
                    id: part.approval.id,
                    reason:
                      "The visible draft changed. Read the current draft and request approval again.",
                  });
                  return;
                }
              }
              void chat.addToolApprovalResponse({
                approved: true,
                id: part.approval.id,
              });
            }
          },
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
          toolCallId: part.toolCallId,
          toolName: part.type.replace("tool-", ""),
        },
      ];
    })
  );
  const errorMessage = streaming ? "" : (chat.error?.message ?? "");
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
          message.parts.some((part) => part.type !== "step-start")
      );
  const canRetry =
    errorMessage !== "" &&
    lastUserText.trim() !== "" &&
    retriedTurnOpen &&
    !streaming &&
    approvals.length === 0 &&
    canUseAiChat;
  const submit = async (resubmit?: { messageId: string; text: string }) => {
    const text = (resubmit?.text ?? input).trim();
    if (!text || streaming || busy || approvals.length > 0 || !canUseAiChat) {
      return;
    }
    setBusy(true);
    const generation = workspace.control.begin();
    const snapshot = workspace.read();
    try {
      foregroundRef.current = foregroundSnapshotSchema.parse({
        capabilities: [
          "navigate",
          "compose",
          "edit_compose",
          "save_draft",
          "send_mail",
          "modify_mail",
        ],
        draftId: snapshot.draftId,
        draftRevision: snapshot.draftRevision,
        exchangeId: crypto.randomUUID(),
        expiresAt: Date.now() + 120_000,
        generation,
        policy,
        query: snapshot.query,
        selectedMessageId: snapshot.selectedMessageId,
        selectedThreadId: snapshot.selectedThreadId,
        tabId,
        view: snapshot.view,
        ...(contextDismissed
          ? {
              query: undefined,
              selectedMessageId: undefined,
              selectedThreadId: undefined,
            }
          : {}),
      });
      if (resubmit === undefined) {
        setInput("");
      }
      chat.clearError();
      await chat.sendMessage(
        resubmit === undefined
          ? { text }
          : { messageId: resubmit.messageId, text }
      );
    } catch (error) {
      if (resubmit === undefined) {
        setInput(text);
      }
      workspace.control.finish();
      toastError(error, { boundary: "assistant-submit" });
    } finally {
      setBusy(false);
    }
  };

  let contextLabel: string | undefined;
  if (!contextDismissed) {
    if (props.mailContext?.threadId) {
      contextLabel = "Current conversation";
    } else if (props.mailContext?.query) {
      contextLabel = `Search: ${props.mailContext.query}`;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chat.messages.length > 0 || errorMessage !== "" ? (
        <ChatTranscript
          messages={chat.messages}
          isStreaming={streaming}
          approvals={approvals}
          errorMessage={errorMessage}
          onRetry={
            canRetry && lastUserMessage !== undefined
              ? () => {
                  void submit({
                    messageId: lastUserMessage.id,
                    text: lastUserText,
                  });
                }
              : undefined
          }
        />
      ) : null}
      {canUseAiChat ? null : (
        <p className="px-4 py-2 text-body-sm text-muted-fg">
          Choose a plan with AI credits in settings to use Quieter.
        </p>
      )}
      <ChatComposer
        input={input}
        disabled={!canUseAiChat || busy || streaming || approvals.length > 0}
        streaming={streaming || approvals.length > 0}
        submitting={chat.status === "submitted"}
        policy={policy}
        onPolicyChange={(nextPolicy) => {
          workspace.control.cancel();
          workspace.control.state.setState((state) => ({
            ...state,
            policy: nextPolicy,
          }));
        }}
        contextLabel={contextLabel}
        onDismissContext={() => {
          setDismissedContext(contextKey);
        }}
        onInputChange={setInput}
        onInputKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void submit();
          }
        }}
        onStop={() => {
          workspace.control.cancel();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      />
    </div>
  );
};

export const ChatView = (props: ChatViewProps) => {
  const { data: billing, isPending } = useQuery(userBillingQueryOptions());
  const {
    data: chatData,
    isError: isChatError,
    isPending: isChatPending,
    refetch: refetchChat,
  } = useQuery(chatQueryOptions(props.mailboxId, props.chatId));
  if (isPending || (props.chatId !== null && isChatPending)) {
    return <p className="p-4 text-body-sm text-muted-fg">Loading assistant…</p>;
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
      canUseAiChat={
        !isPending &&
        !!billing &&
        hasOrganizationAiAccess(billing, props.mailboxOrganizationId)
      }
    />
  );
};
