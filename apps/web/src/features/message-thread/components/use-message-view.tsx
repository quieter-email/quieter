"use client";

import type { ThreadMessagesResult } from "@quieter/mail/messages";
import { toast } from "@quieter/ui/toast";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  buildComposeDraftFromMessageAction,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "#/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import {
  omitDisabledHotkeys,
  shouldIgnoreAppShortcut,
} from "#/features/hotkeys/domain/hotkey-guards";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "#/features/mailbox/components/mailbox-action-handlers";
import { toastError } from "#/lib/error-toast";
import { labelsQueryOptions } from "#/lib/gmail/labels-query";
import { getThreadLabelIds } from "#/lib/gmail/thread-list";
import { getThreadWithDetailsOptions } from "#/lib/gmail/thread-query";
import { getThreadQueryKey } from "#/lib/gmail/thread-query-keys";
import { gmailThreadUsefulDetailsQueryOptions } from "#/lib/gmail/useful-details-query";
import {
  hasRenderableMessageBody,
  isMessageUnread,
  MAILBOX_LABELS,
} from "#/lib/mail";
import type { MailboxCategory, MessageListItem } from "#/lib/mail";
import { useMailNavigationMeasurement } from "#/lib/mail-sync/use-navigation-measurement";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

import { ApiSourceAction } from "./message-inspector-panel";
import type { MessageViewProps } from "./message-view-types";

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
  mailboxId,
  mailboxProvider,
  message,
  pendingActions,
}: {
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  message: MessageListItem;
  pendingActions: MailboxPendingActions;
}) => {
  const queryClient = useQueryClient();
  const cachedThread = queryClient.getQueryData<ThreadMessagesResult>(
    getThreadQueryKey(mailboxId, message.threadId)
  );
  const { data: gmailLabels = [] } = useQuery(
    labelsQueryOptions(mailboxId, mailboxProvider !== "api")
  );
  const {
    data: threadData,
    isFetching: isThreadFetching,
    isPending: isThreadPending,
  } = useQuery({
    // react-doctor-disable-next-line react-doctor/no-event-handler
    ...getThreadWithDetailsOptions(mailboxId, message.threadId),
    placeholderData: {
      messages: [message],
      snippet: message.snippet,
      subject: message.subject,
      threadId: message.threadId,
    },
  });
  const { data: usefulDetails = [] } = useQuery(
    gmailThreadUsefulDetailsQueryOptions(
      mailboxId,
      message.threadId,
      mailboxProvider === "gmail"
    )
  );
  useMailNavigationMeasurement(
    mailboxId,
    message.threadId,
    cachedThread,
    threadData
  );
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
  const threadMessages =
    threadData?.messages !== undefined && threadData.messages.length > 0
      ? threadData.messages.toReversed()
      : [message];
  const threadLabelIds = getThreadLabelIds(threadMessages);
  const messages = threadMessages.filter(
    (threadMessage) => !isDraftMessage(threadMessage)
  );
  const visibleMessages = messages.length > 0 ? messages : [message];
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
    pendingActions.isThreadActionPending(message.threadId);
  const hotkeyMessage = visibleMessages[0] ?? message;
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
    usefulDetails,
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
            await mailboxActions.archiveThread(hotkeyMessage.threadId);
            onBackToList?.();
          }, "Conversation archived.");
        },
        hotkey: "E",
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider !== "api" &&
            (activeMailbox === "inbox" || activeMailbox === "unread"),
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.moveThreadToTrash(hotkeyMessage.threadId);
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
            mailboxProvider !== "api" &&
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
            mailboxProvider !== "api" &&
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
      const focusTarget = view?.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      );
      (focusTarget ?? view)?.focus({ focusVisible: true, preventScroll: true });
      onAutoFocusCompleteRef.current?.();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [focusOnOpen]);

  return viewRef;
};
