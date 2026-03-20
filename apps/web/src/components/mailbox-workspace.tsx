"use client";

import {
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useQueryStates } from "nuqs";
import { type Dispatch, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { ComposeDraftState } from "~/lib/gmail/compose";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { buildComposeDraftFromSavedDraftMessage } from "~/lib/gmail/compose-actions";
import {
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import {
  deleteDraftInMailbox,
  deleteMessagePermanentlyInMailbox,
  deleteThreadPermanentlyInMailbox,
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  markMessageAsReadInMailbox,
  markMessageAsSpamInMailbox,
  markMessageAsUnreadInMailbox,
  markThreadAsReadInMailbox,
  markThreadAsSpamInMailbox,
  markThreadAsUnreadInMailbox,
  messagesQueryOptions,
  moveThreadToTrashInMailbox,
  moveMessageToTrashInMailbox,
  refreshLoadedMessagesPages,
  syncMessages,
  unmarkThreadAsSpamInMailbox,
  unmarkMessageAsSpamInMailbox,
  updateMessageLabelsInMailbox,
} from "~/lib/gmail/inbox-query";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { mailboxSearchParams } from "~/lib/search-params";
import { type ComposeDialogHandle, ComposeDialog } from "./compose-dialog";
import { MailSidebar } from "./mail-sidebar";
import { MessageDetail } from "./message-detail";
import { MessageList } from "./message-list";

type MailboxWorkspaceProps = {
  user: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
};

type LabelChangeSet = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

type MailboxWorkspaceState = {
  isManualRefreshing: boolean;
  isWindowActive: boolean;
  pendingMessageActionIds: ReadonlySet<string>;
  pendingThreadActionIds: ReadonlySet<string>;
};

type MailboxWorkspaceAction =
  | {
      type: "manual-refresh/set";
      value: boolean;
    }
  | {
      type: "window-active/set";
      value: boolean;
    }
  | {
      type: "message-pending/set";
      messageId: string;
      pending: boolean;
    }
  | {
      type: "message-pending-many/set";
      messageIds: string[];
      pending: boolean;
    }
  | {
      type: "thread-pending/set";
      pending: boolean;
      threadId: string;
    }
  | {
      type: "thread-pending-many/set";
      pending: boolean;
      threadIds: string[];
    };

type MailboxWorkspaceViewProps = {
  activeMailbox: MailboxCategory;
  activeMessageId: string | null;
  onBulkDeleteDrafts: (threads: ThreadListEntry[]) => void;
  onBulkDeletePermanently: (threads: ThreadListEntry[]) => void;
  onBulkMarkAsRead: (threads: ThreadListEntry[]) => void;
  onBulkMarkAsSpam: (threads: ThreadListEntry[]) => void;
  onBulkMarkAsUnread: (threads: ThreadListEntry[]) => void;
  onBulkMoveToTrash: (threads: ThreadListEntry[]) => void;
  onBulkUnmarkAsSpam: (threads: ThreadListEntry[]) => void;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onDeleteDraft: (message: MessageListItem) => void;
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isMessagesError: boolean;
  isMessagesPending: boolean;
  isRefreshing: boolean;
  isThreadActionPending: (threadId: string | null | undefined) => boolean;
  messages: ListMessagesPageResult[];
  onActivateMessage: (messageId: string) => void;
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
  onComposeNewMail: () => void;
  onDeletePermanently: (messageId: string) => void;
  onLoadMore: () => void;
  onMarkAsRead: (messageId: string) => void;
  onMarkAsSpam: (messageId: string) => void;
  onMarkAsUnread: (messageId: string) => void;
  onMarkThreadAsRead: (threadId: string) => void;
  onMarkThreadAsUnread: (threadId: string) => void;
  onMoveToTrash: (messageId: string) => void;
  onOpenDraft: (message: MessageListItem) => void;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onUnmarkAsSpam: (messageId: string) => void;
  onUpdateLabels: (messageId: string, changes: LabelChangeSet) => void;
  searchQuery: string;
  selectedMessage: MessageListItem | null;
  user: MailboxWorkspaceProps["user"];
};

type MailboxActionHandlerArgs = {
  activeMailbox: MailboxCategory;
  activeSearchQuery: string;
  dispatch: Dispatch<MailboxWorkspaceAction>;
  pendingMessageActionIds: ReadonlySet<string>;
  pendingThreadActionIds: ReadonlySet<string>;
  queryClient: QueryClient;
  refreshSearchResultsIfNeeded: () => Promise<void>;
};

const initialMailboxWorkspaceState: MailboxWorkspaceState = {
  isManualRefreshing: false,
  isWindowActive: false,
  pendingMessageActionIds: new Set(),
  pendingThreadActionIds: new Set(),
};

const updatePendingIds = (
  current: ReadonlySet<string>,
  ids: readonly string[],
  pending: boolean,
): ReadonlySet<string> => {
  const next = new Set(current);

  for (const id of ids) {
    if (pending) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }

  return next;
};

const mailboxWorkspaceReducer = (
  state: MailboxWorkspaceState,
  action: MailboxWorkspaceAction,
): MailboxWorkspaceState => {
  switch (action.type) {
    case "manual-refresh/set":
      return {
        ...state,
        isManualRefreshing: action.value,
      };
    case "window-active/set":
      return {
        ...state,
        isWindowActive: action.value,
      };
    case "message-pending/set":
      return {
        ...state,
        pendingMessageActionIds: updatePendingIds(
          state.pendingMessageActionIds,
          [action.messageId],
          action.pending,
        ),
      };
    case "message-pending-many/set":
      return {
        ...state,
        pendingMessageActionIds: updatePendingIds(
          state.pendingMessageActionIds,
          action.messageIds,
          action.pending,
        ),
      };
    case "thread-pending/set":
      return {
        ...state,
        pendingThreadActionIds: updatePendingIds(
          state.pendingThreadActionIds,
          [action.threadId],
          action.pending,
        ),
      };
    case "thread-pending-many/set":
      return {
        ...state,
        pendingThreadActionIds: updatePendingIds(
          state.pendingThreadActionIds,
          action.threadIds,
          action.pending,
        ),
      };
  }
};

const createMailboxActionHandlers = ({
  activeMailbox,
  activeSearchQuery,
  dispatch,
  pendingMessageActionIds,
  pendingThreadActionIds,
  queryClient,
  refreshSearchResultsIfNeeded,
}: MailboxActionHandlerArgs) => {
  const isMessageActionPending = (messageId: string | null | undefined) =>
    messageId ? pendingMessageActionIds.has(messageId) : false;

  const isThreadActionPending = (threadId: string | null | undefined) =>
    threadId ? pendingThreadActionIds.has(threadId) : false;

  const getUniqueIds = (ids: readonly string[]) =>
    Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));

  const setMessageActionPending = (messageId: string, pending: boolean) => {
    dispatch({
      type: "message-pending/set",
      messageId,
      pending,
    });
  };

  const setThreadActionPending = (threadId: string, pending: boolean) => {
    dispatch({
      type: "thread-pending/set",
      pending,
      threadId,
    });
  };

  const setMessageActionsPending = (messageIds: string[], pending: boolean) => {
    if (messageIds.length === 0) return;
    dispatch({
      type: "message-pending-many/set",
      messageIds,
      pending,
    });
  };

  const setThreadActionsPending = (threadIds: string[], pending: boolean) => {
    if (threadIds.length === 0) return;
    dispatch({
      type: "thread-pending-many/set",
      pending,
      threadIds,
    });
  };

  const runMessageAction = async (messageId: string, action: () => Promise<void>) => {
    if (isMessageActionPending(messageId)) return;

    setMessageActionPending(messageId, true);
    try {
      await action();
      await refreshSearchResultsIfNeeded();
    } finally {
      setMessageActionPending(messageId, false);
    }
  };

  const runThreadAction = async (threadId: string, action: () => Promise<void>) => {
    if (isThreadActionPending(threadId)) return;

    setThreadActionPending(threadId, true);
    try {
      await action();
      await refreshSearchResultsIfNeeded();
    } finally {
      setThreadActionPending(threadId, false);
    }
  };

  const runBulkMessageAction = async (
    messageIds: readonly string[],
    action: (messageId: string) => Promise<void>,
  ) => {
    const actionableMessageIds = getUniqueIds(messageIds).filter(
      (messageId) => !isMessageActionPending(messageId),
    );
    if (actionableMessageIds.length === 0) return;

    setMessageActionsPending(actionableMessageIds, true);

    let actionError: unknown = null;
    let shouldRefreshSearchResults = false;

    try {
      for (const messageId of actionableMessageIds) {
        await action(messageId);
        shouldRefreshSearchResults = true;
      }
    } catch (error) {
      actionError = error;
    } finally {
      setMessageActionsPending(actionableMessageIds, false);
    }

    if (shouldRefreshSearchResults) {
      try {
        await refreshSearchResultsIfNeeded();
      } catch (refreshError) {
        if (!actionError) {
          throw refreshError;
        }
      }
    }

    if (actionError) {
      throw actionError;
    }
  };

  const runBulkThreadAction = async (
    threadIds: readonly string[],
    action: (threadId: string) => Promise<void>,
  ) => {
    const actionableThreadIds = getUniqueIds(threadIds).filter(
      (threadId) => !isThreadActionPending(threadId),
    );
    if (actionableThreadIds.length === 0) return;

    setThreadActionsPending(actionableThreadIds, true);

    let actionError: unknown = null;
    let shouldRefreshSearchResults = false;

    try {
      for (const threadId of actionableThreadIds) {
        await action(threadId);
        shouldRefreshSearchResults = true;
      }
    } catch (error) {
      actionError = error;
    } finally {
      setThreadActionsPending(actionableThreadIds, false);
    }

    if (shouldRefreshSearchResults) {
      try {
        await refreshSearchResultsIfNeeded();
      } catch (refreshError) {
        if (!actionError) {
          throw refreshError;
        }
      }
    }

    if (actionError) {
      throw actionError;
    }
  };

  const markMessageAsRead = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsReadInMailbox(queryClient, activeMailbox, activeSearchQuery, messageId);
    });
  };

  const markMessageAsUnread = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsUnreadInMailbox(queryClient, activeMailbox, activeSearchQuery, messageId);
    });
  };

  const markMessageAsSpam = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsSpamInMailbox(queryClient, activeMailbox, activeSearchQuery, messageId);
    });
  };

  const markThreadAsRead = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsReadInMailbox(queryClient, activeMailbox, activeSearchQuery, threadId);
    });
  };

  const markThreadAsUnread = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsUnreadInMailbox(queryClient, activeMailbox, activeSearchQuery, threadId);
    });
  };

  const updateMessageLabels = async (messageId: string, changes: LabelChangeSet) => {
    await runMessageAction(messageId, async () => {
      await updateMessageLabelsInMailbox(
        queryClient,
        activeMailbox,
        activeSearchQuery,
        messageId,
        changes,
      );
    });
  };

  const moveMessageToTrash = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await moveMessageToTrashInMailbox(queryClient, activeMailbox, activeSearchQuery, messageId);
    });
  };

  const unmarkMessageAsSpam = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await unmarkMessageAsSpamInMailbox(queryClient, activeMailbox, activeSearchQuery, messageId);
    });
  };

  const deleteDraft = async (message: MessageListItem) => {
    if (!message.draftId) return;

    await runMessageAction(message.id, async () => {
      await deleteDraftInMailbox(
        queryClient,
        activeMailbox,
        activeSearchQuery,
        message.id,
        message.draftId!,
      );
    });
  };

  const deleteMessagePermanently = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await deleteMessagePermanentlyInMailbox(
        queryClient,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const deleteDrafts = async (threads: ThreadListEntry[]) => {
    const draftsByMessageId = new Map(
      threads.flatMap((thread) => {
        const message = thread.anchorMessage;
        return message.draftId ? [[message.id, message.draftId] as const] : [];
      }),
    );

    await runBulkMessageAction(Array.from(draftsByMessageId.keys()), async (messageId) => {
      const draftId = draftsByMessageId.get(messageId);
      if (!draftId) return;
      await deleteDraftInMailbox(queryClient, activeMailbox, activeSearchQuery, messageId, draftId);
    });
  };

  const markThreadsAsRead = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsReadInMailbox(queryClient, activeMailbox, activeSearchQuery, threadId);
      },
    );
  };

  const markThreadsAsUnread = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsUnreadInMailbox(queryClient, activeMailbox, activeSearchQuery, threadId);
      },
    );
  };

  const markThreadsAsSpam = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsSpamInMailbox(queryClient, activeMailbox, activeSearchQuery, threadId);
      },
    );
  };

  const unmarkThreadsAsSpam = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await unmarkThreadAsSpamInMailbox(queryClient, activeMailbox, activeSearchQuery, threadId);
      },
    );
  };

  const moveThreadsToTrash = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await moveThreadToTrashInMailbox(queryClient, activeMailbox, activeSearchQuery, threadId);
      },
    );
  };

  const deleteThreadsPermanently = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await deleteThreadPermanentlyInMailbox(
          queryClient,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  return {
    deleteDraft,
    deleteDrafts,
    deleteMessagePermanently,
    deleteThreadsPermanently,
    isMessageActionPending,
    isThreadActionPending,
    markMessageAsRead,
    markMessageAsSpam,
    markMessageAsUnread,
    markThreadAsRead,
    markThreadsAsRead,
    markThreadsAsSpam,
    markThreadsAsUnread,
    markThreadAsUnread,
    moveThreadsToTrash,
    moveMessageToTrash,
    unmarkThreadsAsSpam,
    unmarkMessageAsSpam,
    updateMessageLabels,
  };
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const composeDialogRef = useRef<ComposeDialogHandle | null>(null);
  const [workspaceState, dispatch] = useReducer(
    mailboxWorkspaceReducer,
    initialMailboxWorkspaceState,
  );
  const { isManualRefreshing, isWindowActive, pendingMessageActionIds, pendingThreadActionIds } =
    workspaceState;
  const [{ mailbox: activeMailbox, messageId: activeMessageId, query }, setMailboxQuery] =
    useQueryStates(mailboxSearchParams, {
      history: "replace",
      scroll: false,
    });
  const activeSearchQuery = query.trim();

  const messagesQuery = useInfiniteQuery(
    messagesQueryOptions(queryClient, activeMailbox, activeSearchQuery),
  );
  const hasLoadedMessages = Boolean(messagesQuery.data?.pages.length);
  const isLiveSyncEnabled =
    pathname === "/" &&
    activeMailbox !== "drafts" &&
    activeSearchQuery.length === 0 &&
    isWindowActive &&
    hasLoadedMessages &&
    !isManualRefreshing;
  const syncQuery = useQuery(
    liveSyncQueryOptions(queryClient, activeMailbox, activeSearchQuery, isLiveSyncEnabled),
  );

  const flattenedMessages = messagesQuery.data?.pages.flatMap((page) => page.messages) ?? [];

  const refreshMessages = async () => {
    const liveSyncQueryKey = getLiveSyncQueryKey(activeMailbox, activeSearchQuery);
    const messagesQueryKey = getMessagesQueryKey(activeMailbox, activeSearchQuery);

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    dispatch({
      type: "manual-refresh/set",
      value: true,
    });
    try {
      await syncMessages(queryClient, activeMailbox, activeSearchQuery);
    } finally {
      dispatch({
        type: "manual-refresh/set",
        value: false,
      });
    }
  };

  const refreshSearchResultsIfNeeded = async () => {
    if (activeSearchQuery.length === 0) return;
    await refreshLoadedMessagesPages(queryClient, activeMailbox, activeSearchQuery);
  };

  let selectedMessage: MessageListItem | null = null;
  if (activeMailbox !== "drafts" && activeMessageId) {
    for (const message of flattenedMessages) {
      if (message.id === activeMessageId) {
        selectedMessage = message;
        break;
      }
    }
  }

  useEffect(() => {
    const updateWindowActivity = () => {
      dispatch({
        type: "window-active/set",
        value: document.visibilityState === "visible" && document.hasFocus(),
      });
    };

    updateWindowActivity();
    window.addEventListener("focus", updateWindowActivity);
    window.addEventListener("blur", updateWindowActivity);
    document.addEventListener("visibilitychange", updateWindowActivity);

    return () => {
      window.removeEventListener("focus", updateWindowActivity);
      window.removeEventListener("blur", updateWindowActivity);
      document.removeEventListener("visibilitychange", updateWindowActivity);
    };
  }, []);

  useLayoutEffect(() => {
    if (
      !activeMessageId ||
      messagesQuery.isPending ||
      !messagesQuery.data?.pages.length ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxQuery({ messageId: null });
  }, [
    activeMessageId,
    messagesQuery.data,
    messagesQuery.isPending,
    selectedMessage,
    setMailboxQuery,
  ]);

  const {
    deleteDraft,
    deleteDrafts,
    deleteMessagePermanently,
    deleteThreadsPermanently,
    isMessageActionPending,
    isThreadActionPending,
    markMessageAsRead,
    markMessageAsSpam,
    markMessageAsUnread,
    markThreadAsRead,
    markThreadsAsRead,
    markThreadsAsSpam,
    markThreadsAsUnread,
    markThreadAsUnread,
    moveThreadsToTrash,
    moveMessageToTrash,
    unmarkThreadsAsSpam,
    unmarkMessageAsSpam,
    updateMessageLabels,
  } = createMailboxActionHandlers({
    activeMailbox,
    activeSearchQuery,
    dispatch,
    pendingMessageActionIds,
    pendingThreadActionIds,
    queryClient,
    refreshSearchResultsIfNeeded,
  });

  const openDraft = (message: MessageListItem) => {
    if (!message.draftId) {
      return;
    }

    void setMailboxQuery({ messageId: null });
    composeDialogRef.current?.openDraft(buildComposeDraftFromSavedDraftMessage(message));
  };

  const activateMessage = (messageId: string) => {
    if (activeMailbox === "drafts") {
      const draftMessage = flattenedMessages.find((message) => message.id === messageId);
      if (draftMessage) {
        openDraft(draftMessage);
      }
      return;
    }

    if (activeMessageId === messageId) return;
    const threadId = flattenedMessages.find((message) => message.id === messageId)?.threadId;

    void setMailboxQuery({ messageId });

    if (threadId) {
      void queryClient.prefetchQuery(getThreadWithDetailsOptions(activeMailbox, threadId));
    }
  };

  const loadMoreMessages = () => {
    if (
      !messagesQuery.hasNextPage ||
      messagesQuery.isFetchingNextPage ||
      messagesQuery.isPending ||
      messagesQuery.isError
    ) {
      return;
    }

    void messagesQuery.fetchNextPage();
  };

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === activeSearchQuery) {
      void setMailboxQuery({ messageId: null });
      void refreshMessages();
      return;
    }

    void setMailboxQuery({
      messageId: null,
      query: normalizedQuery.length > 0 ? normalizedQuery : null,
    });
  };

  const selectMailbox = (mailbox: MailboxCategory) => {
    if (mailbox === activeMailbox) return;
    void setMailboxQuery({ mailbox, messageId: null });
  };

  const isRefreshing =
    isManualRefreshing ||
    syncQuery.isFetching ||
    (messagesQuery.isRefetching && !messagesQuery.isFetchingNextPage);

  return (
    <>
      <MailboxWorkspaceView
        activeMailbox={activeMailbox}
        activeMessageId={activeMessageId}
        onBulkDeleteDrafts={(threads) => {
          void deleteDrafts(threads);
        }}
        onBulkDeletePermanently={(threads) => {
          void deleteThreadsPermanently(threads);
        }}
        onBulkMarkAsRead={(threads) => {
          void markThreadsAsRead(threads);
        }}
        onBulkMarkAsSpam={(threads) => {
          void markThreadsAsSpam(threads);
        }}
        onBulkMarkAsUnread={(threads) => {
          void markThreadsAsUnread(threads);
        }}
        onBulkMoveToTrash={(threads) => {
          void moveThreadsToTrash(threads);
        }}
        onBulkUnmarkAsSpam={(threads) => {
          void unmarkThreadsAsSpam(threads);
        }}
        error={messagesQuery.error ?? null}
        hasNextPage={Boolean(messagesQuery.hasNextPage)}
        isFetchingNextPage={messagesQuery.isFetchingNextPage}
        onDeleteDraft={(message) => {
          void deleteDraft(message);
        }}
        isMessageActionPending={isMessageActionPending}
        isMessagesError={messagesQuery.isError}
        isMessagesPending={messagesQuery.isPending}
        isRefreshing={isRefreshing}
        isThreadActionPending={isThreadActionPending}
        messages={messagesQuery.data?.pages ?? []}
        onActivateMessage={activateMessage}
        onComposeNewMail={() => {
          composeDialogRef.current?.openNewMail();
        }}
        onComposeDraftRequested={(draft) => {
          composeDialogRef.current?.openDraft(draft);
        }}
        onDeletePermanently={(messageId) => {
          void deleteMessagePermanently(messageId);
        }}
        onLoadMore={loadMoreMessages}
        onMarkAsRead={(messageId) => {
          void markMessageAsRead(messageId);
        }}
        onMarkAsSpam={(messageId) => {
          void markMessageAsSpam(messageId);
        }}
        onMarkAsUnread={(messageId) => {
          void markMessageAsUnread(messageId);
        }}
        onMarkThreadAsRead={(threadId) => {
          void markThreadAsRead(threadId);
        }}
        onMarkThreadAsUnread={(threadId) => {
          void markThreadAsUnread(threadId);
        }}
        onMoveToTrash={(messageId) => {
          void moveMessageToTrash(messageId);
        }}
        onOpenDraft={openDraft}
        onRefresh={() => {
          void refreshMessages();
        }}
        onSearch={applySearch}
        onSelectMailbox={selectMailbox}
        onUnmarkAsSpam={(messageId) => {
          void unmarkMessageAsSpam(messageId);
        }}
        onUpdateLabels={(messageId, changes) => {
          void updateMessageLabels(messageId, changes);
        }}
        searchQuery={activeSearchQuery}
        selectedMessage={selectedMessage}
        user={user}
      />

      <ComposeDialog
        key={user.id ?? "signed-out"}
        ref={composeDialogRef}
        userId={user.id ?? null}
      />
      <LogoDevFooter />
    </>
  );
};

const MailboxWorkspaceView = ({
  activeMailbox,
  activeMessageId,
  onBulkDeleteDrafts,
  onBulkDeletePermanently,
  onBulkMarkAsRead,
  onBulkMarkAsSpam,
  onBulkMarkAsUnread,
  onBulkMoveToTrash,
  onBulkUnmarkAsSpam,
  error,
  hasNextPage,
  isFetchingNextPage,
  onDeleteDraft,
  isMessageActionPending,
  isMessagesError,
  isMessagesPending,
  isRefreshing,
  isThreadActionPending,
  messages,
  onActivateMessage,
  onComposeDraftRequested,
  onComposeNewMail,
  onDeletePermanently,
  onLoadMore,
  onMarkAsRead,
  onMarkAsSpam,
  onMarkAsUnread,
  onMarkThreadAsRead,
  onMarkThreadAsUnread,
  onMoveToTrash,
  onOpenDraft,
  onRefresh,
  onSearch,
  onSelectMailbox,
  onUnmarkAsSpam,
  onUpdateLabels,
  searchQuery,
  selectedMessage,
  user,
}: MailboxWorkspaceViewProps) => {
  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" />

        <MailSidebar
          onComposeNewMail={onComposeNewMail}
          onSelectMailbox={onSelectMailbox}
          selectedMailbox={activeMailbox}
          user={user}
        />

        <div className="relative flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <section className="flex min-h-0 min-w-0 flex-col border-r border-border bg-background-light">
            <MessageList
              activeMailbox={activeMailbox}
              activeMessageId={activeMessageId}
              isThreadActionPending={isThreadActionPending}
              onBulkDeleteDrafts={onBulkDeleteDrafts}
              onBulkDeletePermanently={onBulkDeletePermanently}
              onBulkMarkAsRead={onBulkMarkAsRead}
              onBulkMarkAsSpam={onBulkMarkAsSpam}
              onBulkMarkAsUnread={onBulkMarkAsUnread}
              onBulkMoveToTrash={onBulkMoveToTrash}
              onBulkUnmarkAsSpam={onBulkUnmarkAsSpam}
              error={error}
              hasNextPage={hasNextPage}
              isError={isMessagesError}
              isFetchingNextPage={isFetchingNextPage}
              onDeleteDraft={onDeleteDraft}
              isMessageActionPending={isMessageActionPending}
              isPending={isMessagesPending}
              isRefreshing={isRefreshing}
              messages={messages}
              onActivateMessage={onActivateMessage}
              onDeletePermanently={onDeletePermanently}
              onLoadMore={onLoadMore}
              onMarkAsRead={onMarkAsRead}
              onMarkAsSpam={onMarkAsSpam}
              onMarkAsUnread={onMarkAsUnread}
              onMoveToTrash={onMoveToTrash}
              onOpenDraft={onOpenDraft}
              onRefresh={onRefresh}
              onSearch={onSearch}
              onUnmarkAsSpam={onUnmarkAsSpam}
              onUpdateLabels={onUpdateLabels}
              searchQuery={searchQuery}
            />
          </section>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
            <MessageDetail
              activeMailbox={activeMailbox}
              currentUserEmail={user.email ?? null}
              isActionPending={
                isMessageActionPending(selectedMessage?.id) ||
                isThreadActionPending(selectedMessage?.threadId)
              }
              onComposeDraftRequested={onComposeDraftRequested}
              onDeletePermanently={onDeletePermanently}
              onMarkAsRead={onMarkAsRead}
              onMarkAsSpam={onMarkAsSpam}
              onMarkAsUnread={onMarkAsUnread}
              onMarkThreadAsRead={onMarkThreadAsRead}
              onMarkThreadAsUnread={onMarkThreadAsUnread}
              onMoveToTrash={onMoveToTrash}
              onUnmarkAsSpam={onUnmarkAsSpam}
              onUpdateLabels={onUpdateLabels}
              selectedMessage={selectedMessage}
            />
          </div>
        </div>
      </div>
    </main>
  );
};

const LogoDevFooter = () => {
  return (
    <footer className="fixed right-4 bottom-4 px-3 py-1.5 text-[10px] text-muted-foreground">
      <a
        className="transition-colors hover:text-foreground"
        href="https://logo.dev"
        rel="noreferrer"
        target="_blank"
        title="Logo API"
      >
        Logos provided by Logo.dev
      </a>
    </footer>
  );
};
