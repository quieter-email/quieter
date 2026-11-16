"use client";

import { resolveMailboxActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/resolve-mailbox-actions";
import {
  captureListMessage,
  retainSelectedMessageInList,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/retained-list-message";
import type { RetainedListMessage } from "@quieter/app/features/mailbox/components/mailbox-workspace/retained-list-message";
import { useMailboxMessages } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-messages";
import { useMailboxPendingActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-pending-actions";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { rememberRequestedUnsubscribe } from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getMailboxThreadQueriesKey } from "@quieter/app/lib/mail/thread-query-keys";
import { orpc } from "@quieter/app/lib/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

type ListSelection = {
  scopeKey: string;
  observedMessageId: string | null;
  observedThreadId: string | null;
  retainedMessage: RetainedListMessage | null;
  restoreSelection: boolean;
};

export const useMailboxListController = ({
  activeMailbox,
  isDemoMode,
  isManagedDemoMode,
  mailboxId,
  mailboxProvider,
  messageId,
  searchQuery,
  selectionScopeKey,
  threadId,
}: {
  activeMailbox: MailboxCategory;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  messageId: string | null;
  searchQuery: string;
  selectionScopeKey?: string;
  threadId: string | null;
}) => {
  const queryClient = useQueryClient();
  const normalizedSearchQuery = searchQuery.trim();
  const scopeKey = JSON.stringify([
    mailboxId,
    activeMailbox,
    normalizedSearchQuery,
    selectionScopeKey,
  ]);
  const [selection, setSelection] = useState<ListSelection>({
    observedMessageId: messageId,
    observedThreadId: threadId,
    restoreSelection: true,
    retainedMessage: null,
    scopeKey,
  });
  if (selection.scopeKey !== scopeKey) {
    setSelection({
      observedMessageId: messageId,
      observedThreadId: threadId,
      restoreSelection: false,
      retainedMessage: null,
      scopeKey,
    });
  } else if (
    selection.observedMessageId !== messageId ||
    selection.observedThreadId !== threadId
  ) {
    setSelection({
      ...selection,
      observedMessageId: messageId,
      observedThreadId: threadId,
      restoreSelection: messageId !== null,
      retainedMessage:
        selection.retainedMessage?.message.id === messageId &&
        (!threadId || selection.retainedMessage.message.threadId === threadId)
          ? selection.retainedMessage
          : null,
    });
  }

  const data = useMailboxMessages({
    activeMailbox,
    isDemoMode,
    isManagedDemoMode,
    mailboxProvider,
    messageId: messageId ?? undefined,
    queryClient,
    searchQuery: normalizedSearchQuery,
    selectedMailboxId: mailboxId,
    threadId: threadId ?? undefined,
  });
  const canRetainSelection =
    data.selectedThreadError === null &&
    (data.messagesPending || data.selectedMessage !== null);
  if (
    !canRetainSelection &&
    (selection.retainedMessage !== null || selection.restoreSelection) &&
    selection.scopeKey === scopeKey &&
    selection.observedMessageId === messageId &&
    selection.observedThreadId === threadId
  ) {
    setSelection({
      ...selection,
      restoreSelection: false,
      retainedMessage: null,
    });
  }
  const { refreshMessages: refreshNativeMessages } = data;
  const {
    isMessageActionPending,
    isThreadActionPending,
    pendingActions,
    setMessageActionsPending,
    setThreadActionsPending,
  } = useMailboxPendingActions();
  const { mutateAsync: unsubscribeFromMessage } = useMutation(
    orpc.mail.unsubscribeFromMessage.mutationOptions()
  );
  const mailboxActions = useMemo(
    () =>
      resolveMailboxActions({
        activeMailbox,
        isDemoMode,
        isManagedDemoMode,
        isMessageActionPending,
        isThreadActionPending,
        mailboxId,
        mailboxProvider,
        normalizedSearchQuery,
        queryClient,
        refreshSearchResultsIfNeeded: data.refreshSearchResultsIfNeeded,
        setMessageActionPending: (id, pending) => {
          setMessageActionsPending([id], pending);
        },
        setMessageActionsPending,
        setThreadActionPending: (id, pending) => {
          setThreadActionsPending([id], pending);
        },
        setThreadActionsPending,
        unsubscribeFromMessage: async (targetMessageId) => {
          try {
            const result = await unsubscribeFromMessage({
              mailboxId,
              messageId: targetMessageId,
            });
            await rememberRequestedUnsubscribe(
              queryClient,
              mailboxId,
              result.key,
              targetMessageId
            );
            setSelection((current) =>
              current.scopeKey === scopeKey &&
              (current.retainedMessage?.message.unsubscribeKey === result.key ||
                current.retainedMessage?.message.id === targetMessageId)
                ? {
                    ...current,
                    retainedMessage: {
                      ...current.retainedMessage,
                      message: {
                        ...current.retainedMessage.message,
                        unsubscribeKey: result.key,
                        unsubscribeStatus: "requested",
                      },
                    },
                  }
                : current
            );
            return result.newlyRequested;
          } catch (error) {
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["messages", mailboxId],
              }),
              queryClient.invalidateQueries({
                queryKey: getMailboxThreadQueriesKey(mailboxId),
              }),
            ]);
            throw error;
          }
        },
      }),
    [
      activeMailbox,
      data.refreshSearchResultsIfNeeded,
      isDemoMode,
      isManagedDemoMode,
      isMessageActionPending,
      isThreadActionPending,
      mailboxId,
      mailboxProvider,
      normalizedSearchQuery,
      queryClient,
      scopeKey,
      setMessageActionsPending,
      setThreadActionsPending,
      unsubscribeFromMessage,
    ]
  );
  const rawPages = data.listState.messages;
  const displayPages = useMemo(() => {
    const snapshot = canRetainSelection
      ? (selection.retainedMessage ??
        (selection.restoreSelection && data.selectedMessage && messageId
          ? captureListMessage(
              [{ messages: [data.selectedMessage] }],
              scopeKey,
              messageId
            )
          : null))
      : null;
    return retainSelectedMessageInList({
      messageId,
      pages: rawPages,
      retainedMessage: snapshot,
      scopeKey,
      selectedMessage: data.selectedMessage,
      selectedThreadMessages: data.selectedThreadMessages,
    });
  }, [
    canRetainSelection,
    data.selectedMessage,
    data.selectedThreadMessages,
    messageId,
    rawPages,
    scopeKey,
    selection,
  ]);
  const flattenedMessages = useMemo(
    () => displayPages.flatMap((page) => page.messages),
    [displayPages]
  );
  const activateListMessage = useCallback(
    (nextMessageId: string) => {
      setSelection((current) => ({
        ...current,
        restoreSelection: true,
        retainedMessage: captureListMessage(
          displayPages,
          scopeKey,
          nextMessageId
        ),
        scopeKey,
      }));
    },
    [displayPages, scopeKey]
  );
  const resetListSelection = useCallback(() => {
    setSelection((current) => ({
      ...current,
      restoreSelection: false,
      retainedMessage: null,
    }));
  }, []);
  const refreshMessages = useCallback(async () => {
    resetListSelection();
    await refreshNativeMessages();
  }, [refreshNativeMessages, resetListSelection]);

  return {
    ...data,
    activateListMessage,
    flattenedMessages,
    listState: { ...data.listState, messages: displayPages },
    mailboxActions,
    paginationMessages: data.flattenedMessages,
    pendingActions,
    rawPages,
    refreshMessages,
    resetListSelection,
    retainedMessageId: displayPages === rawPages ? null : messageId,
  };
};
