"use client";

import {
  buildComposeDraftFromMessageAction,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "@quieter/app/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import {
  omitDisabledHotkeys,
  shouldIgnoreAppShortcut,
} from "@quieter/app/features/hotkeys/domain/hotkey-guards";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { ApiSourceAction } from "@quieter/app/features/message-thread/components/message-inspector-panel";
import type { MessageViewProps } from "@quieter/app/features/message-thread/components/message-view-types";
import { toastError } from "@quieter/app/lib/error-toast";
import { getThreadLabelIds } from "@quieter/app/lib/gmail/thread-list";
import {
  hasRenderableMessageBody,
  isMessageUnread,
  MAILBOX_LABELS,
} from "@quieter/app/lib/mail";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import {
  mergeMessagePreservingLoadedDetails,
  upsertMessageInThreadData,
} from "@quieter/app/lib/mail/inbox-query/data";
import { labelsQueryOptions } from "@quieter/app/lib/mail/labels-query";
import {
  getThreadWithDetailsOptions,
  shouldRefreshThreadContent,
} from "@quieter/app/lib/mail/thread-query";
import { verificationCodesQueryOptions } from "@quieter/app/lib/mail/verification-codes-query";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { toast } from "@quieter/ui/toast";
import { useHotkeys } from "@tanstack/react-hotkeys";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const isDraftMessage = (message: MessageListItem) =>
  (message.draftId?.trim() ?? "") !== "" ||
  message.labelIds?.includes(MAILBOX_LABELS.drafts) === true;

const getMessagesMissingLoadedBody = (messages: readonly MessageListItem[]) =>
  messages.filter(
    (threadMessage) =>
      (threadMessage.snippet?.trim() ?? "") !== "" &&
      !hasRenderableMessageBody(threadMessage)
  );

const resolveThreadSubject = (
  visibleMessages: MessageListItem[],
  threadDataSubject: string | undefined,
  messageSubject: string | undefined
): string => {
  for (const threadMessage of visibleMessages) {
    const trimmedSubject = threadMessage.subject?.trim() ?? "";
    if (trimmedSubject !== "") {
      return trimmedSubject;
    }
  }

  const trimmedThreadSubject = threadDataSubject?.trim() ?? "";
  if (trimmedThreadSubject !== "") {
    return trimmedThreadSubject;
  }

  const trimmedMessageSubject = messageSubject?.trim() ?? "";
  if (trimmedMessageSubject !== "") {
    return trimmedMessageSubject;
  }

  return "(No subject)";
};

const runHotkeyThreadAction = async (
  action: () => void | Promise<void>,
  successMessage: string
) => {
  try {
    await action();
    toast.success(successMessage);
  } catch (error) {
    toastError(error, {
      boundary: "message-actions",
      fallback: "Could not update message.",
    });
  }
};

export const useMessageViewData = ({
  onConversationOpened,
  mailboxId,
  mailboxProvider,
  message,
  pendingActions,
}: {
  onConversationOpened?: MessageViewProps["onConversationOpened"];
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  message: MessageListItem;
  pendingActions: MailboxPendingActions;
}) => {
  const queryClient = useQueryClient();
  const { data: gmailLabels = [] } = useQuery(
    labelsQueryOptions(mailboxId, mailboxProvider !== "api")
  );
  const includeDraftsInThreadCount =
    (mailboxProvider !== "gmail" && !isSandboxMailboxId(mailboxId)) ||
    isDraftMessage(message);
  const {
    data: threadData,
    isSuccess: isThreadSuccess,
    isPlaceholderData: isThreadPlaceholder,
    isFetching: isThreadFetching,
    isPending: isThreadPending,
  } = useQuery({
    // react-doctor-disable-next-line react-doctor/no-event-handler
    ...getThreadWithDetailsOptions(mailboxId, message.threadId, true, {
      id: message.id,
      includeDrafts: includeDraftsInThreadCount,
      threadMessageCount: message.threadMessageCount,
    }),
    placeholderData: {
      messages: [message],
      snippet: message.snippet,
      subject: message.subject,
      threadId: message.threadId,
    },
    refetchInterval: (query) => {
      const thread = query.state.data;
      const missingBodyCount =
        thread === undefined
          ? 0
          : getMessagesMissingLoadedBody(thread.messages).length;
      return thread !== undefined &&
        query.state.dataUpdateCount < 2 &&
        missingBodyCount > 0
        ? 250
        : false;
    },
  });
  useEffect(() => {
    let cancelled = false;
    const expectedMessage = {
      id: message.id,
      includeDrafts: includeDraftsInThreadCount,
      threadMessageCount: message.threadMessageCount,
    };
    const options = getThreadWithDetailsOptions(
      mailboxId,
      message.threadId,
      true,
      expectedMessage
    );
    if (
      shouldRefreshThreadContent(
        queryClient.getQueryData(options.queryKey),
        expectedMessage
      )
    ) {
      void Promise.allSettled([
        (async () => {
          const thread = await queryClient.query(options);
          if (
            !cancelled &&
            shouldRefreshThreadContent(thread, expectedMessage)
          ) {
            await queryClient.query({ ...options, staleTime: 0 });
          }
        })(),
      ]);
    }
    return () => {
      cancelled = true;
    };
  }, [
    includeDraftsInThreadCount,
    mailboxId,
    message.id,
    message.threadId,
    message.threadMessageCount,
    queryClient,
  ]);
  const createApiMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailboxForApiMessage.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "api-mailbox",
        fallback: "Could not create mailbox.",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: ["messages", mailboxId] }),
      ]);
      toast.success("Mailbox created.");
    },
  });
  const selectedThreadMessage = threadData?.messages.find(
    (entry) => entry.id === message.id
  );
  const threadMessages = upsertMessageInThreadData(
    threadData,
    selectedThreadMessage
      ? mergeMessagePreservingLoadedDetails(message, selectedThreadMessage)
      : message
  )?.messages ?? [message];
  const threadLabelIds = getThreadLabelIds(threadMessages);
  const messages = threadMessages.filter(
    (threadMessage) => !isDraftMessage(threadMessage)
  );
  const visibleMessages = messages.length > 0 ? messages : [message];
  const codeMessageIds = visibleMessages.map(
    (threadMessage) => threadMessage.id
  );
  const codeMessageIdBuckets: string[][] = [];
  for (let offset = 0; offset < codeMessageIds.length; offset += 100) {
    codeMessageIdBuckets.push(codeMessageIds.slice(offset, offset + 100));
  }
  const codeQueries = useQueries({
    queries: codeMessageIdBuckets.map((messageIds) =>
      verificationCodesQueryOptions(
        queryClient,
        mailboxId,
        { messageIds, mode: "messages" },
        mailboxProvider !== "api"
      )
    ),
  });
  const verificationCodes = codeQueries.flatMap(
    (query) => query.data?.items ?? []
  );
  const messagesMissingLoadedBody =
    getMessagesMissingLoadedBody(visibleMessages);
  const hasMissingLoadedBody = messagesMissingLoadedBody.length > 0;
  const isBodyRefreshPending =
    isThreadPending || isThreadFetching || hasMissingLoadedBody;
  const subject = resolveThreadSubject(
    visibleMessages,
    threadData?.subject,
    message.subject
  );
  const lastRecordedRef = useRef<string | null>(null);
  useEffect(() => {
    const selected = threadData?.messages.find(
      (entry) =>
        entry.id === message.id &&
        entry.threadId === message.threadId &&
        !isDraftMessage(entry)
    );
    const selectionKey = JSON.stringify([
      mailboxId,
      message.threadId,
      message.id,
    ]);
    if (
      !onConversationOpened ||
      !isThreadSuccess ||
      isThreadPlaceholder ||
      threadData?.threadId !== message.threadId ||
      !selected ||
      lastRecordedRef.current === selectionKey
    ) {
      return;
    }
    lastRecordedRef.current = selectionKey;
    onConversationOpened({
      mailboxId,
      message: {
        ...mergeMessagePreservingLoadedDetails(message, selected),
        subject,
      },
    });
  }, [
    isThreadPlaceholder,
    isThreadSuccess,
    mailboxId,
    message,
    onConversationOpened,
    subject,
    threadData,
  ]);
  const threadIsUnread = visibleMessages.some((entry) =>
    isMessageUnread(entry)
  );
  const isSingleMessageThread = visibleMessages.length === 1;
  const canComposeFromMailbox = mailboxProvider !== "api";
  const { apiSource } = message;
  const threadAttachments = visibleMessages.flatMap((threadMessage) =>
    (threadMessage.attachments ?? []).map((attachment) => ({
      ...attachment,
      messageId: threadMessage.id,
    }))
  );
  const isActionPending =
    pendingActions.isMessageActionPending(message.id) ||
    visibleMessages.some((entry) =>
      pendingActions.isMessageActionPending(entry.id)
    ) ||
    pendingActions.isThreadActionPending(message.threadId);
  const hotkeyMessage = visibleMessages.at(-1) ?? message;
  const hotkeyLinkedDraftMessage =
    findLinkedDraftForMessage(threadMessages, hotkeyMessage) ?? undefined;

  const apiSourceAction = (
    <ApiSourceAction
      apiSource={apiSource}
      isPending={createApiMailboxMutation.isPending}
      onCreateMailbox={() => {
        createApiMailboxMutation.mutate({
          mailboxId,
          messageId: message.id,
        });
      }}
    />
  );

  return {
    apiSource,
    apiSourceAction,
    canComposeFromMailbox,
    gmailLabels,
    hotkeyLinkedDraftMessage,
    hotkeyMessage,
    isActionPending,
    isBodyRefreshPending,
    isSingleMessageThread,
    subject,
    threadAttachments,
    threadIsUnread,
    threadLabelIds,
    threadMessages,
    verificationCodes,
    visibleMessages,
  };
};

export const useMessageViewHotkeys = ({
  activeMailbox,
  canComposeFromMailbox,
  currentUserEmail,
  hotkeyLinkedDraftMessage,
  hotkeyMessage,
  isActionPending,
  mailboxActions,
  mailboxProvider,
  onBackToList,
  onComposeDraftRequested,
}: {
  activeMailbox: MailboxCategory;
  canComposeFromMailbox: boolean;
  currentUserEmail?: string | null;
  hotkeyLinkedDraftMessage: MessageListItem | undefined;
  hotkeyMessage: MessageListItem;
  isActionPending: boolean;
  mailboxActions: MailboxActions;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  onBackToList?: () => void;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
}) => {
  const requestComposeAction = (action: "reply" | "reply-all" | "forward") => {
    if (!canComposeFromMailbox || onComposeDraftRequested === undefined) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        existingDraftMessage: hotkeyLinkedDraftMessage,
        message: hotkeyMessage,
      })
    );
  };
  useHotkeys(
    omitDisabledHotkeys([
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          requestComposeAction("reply");
        },
        hotkey: "R",
        options: {
          enabled:
            canComposeFromMailbox &&
            onComposeDraftRequested !== undefined &&
            activeMailbox !== "drafts",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          requestComposeAction("reply-all");
        },
        hotkey: "A",
        options: {
          enabled:
            onComposeDraftRequested !== undefined &&
            canComposeFromMailbox &&
            activeMailbox !== "drafts" &&
            hasDistinctReplyAllRecipients(hotkeyMessage, currentUserEmail),
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          requestComposeAction("forward");
        },
        hotkey: "F",
        options: {
          enabled:
            canComposeFromMailbox &&
            onComposeDraftRequested !== undefined &&
            activeMailbox !== "drafts",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.moveThreadToTrash(hotkeyMessage.threadId);
            onBackToList?.();
          }, "Conversation moved to Trash.");
        },
        hotkey: "Shift+3",
        options: {
          enabled:
            !isActionPending &&
            activeMailbox !== "drafts" &&
            activeMailbox !== "trash",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.markThreadAsSpam(hotkeyMessage.threadId);
            onBackToList?.();
          }, "Conversation marked as Spam.");
        },
        hotkey: "Shift+1",
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider === "gmail" &&
            activeMailbox !== "drafts" &&
            activeMailbox === "inbox",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.markThreadAsRead(hotkeyMessage.threadId);
          }, "Conversation marked as Read.");
        },
        hotkey: "Shift+I",
        options: {
          enabled:
            !isActionPending &&
            mailboxActions.canMarkRead &&
            activeMailbox !== "drafts",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.markThreadAsUnread(hotkeyMessage.threadId);
          }, "Conversation marked as Unread.");
        },
        hotkey: "Shift+U",
        options: {
          enabled:
            !isActionPending &&
            mailboxActions.canMarkRead &&
            activeMailbox !== "drafts",
        },
      },
    ]),
    { ignoreInputs: true }
  );
};

export const useMessageViewFocus = ({
  focusOnOpen,
  onAutoFocusComplete,
}: Pick<MessageViewProps, "focusOnOpen" | "onAutoFocusComplete">) => {
  const viewRef = useRef<HTMLElement>(null);
  const onAutoFocusCompleteRef = useRef(onAutoFocusComplete);

  useEffect(() => {
    onAutoFocusCompleteRef.current = onAutoFocusComplete;
  }, [onAutoFocusComplete]);

  useEffect(() => {
    if (focusOnOpen !== true) {
      // oxlint-disable-next-line no-useless-undefined -- React effects may return an optional cleanup.
      return undefined;
    }

    const frameId = requestAnimationFrame(() => {
      const view = viewRef.current;
      const focusTarget = [
        ...(view?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
        ) ?? []),
      ].find((element) => element.getClientRects().length > 0);
      const target = focusTarget ?? view;
      target?.focus({ focusVisible: true, preventScroll: true });
      if (target && document.activeElement === target) {
        onAutoFocusCompleteRef.current?.();
      }
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [focusOnOpen]);

  return viewRef;
};
