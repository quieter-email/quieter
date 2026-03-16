"use client";

import {
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useQueryStates } from "nuqs";
import { type Dispatch, useEffect, useReducer } from "react";
import { cloneComposeDraft, type ComposeDraftState } from "~/lib/gmail/compose";
import {
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import {
  deleteMessagePermanentlyInMailbox,
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  markMessageAsReadInMailbox,
  markMessageAsSpamInMailbox,
  markMessageAsUnreadInMailbox,
  markThreadAsReadInMailbox,
  markThreadAsUnreadInMailbox,
  messagesQueryOptions,
  moveMessageToTrashInMailbox,
  refreshLoadedMessagesPages,
  syncMessages,
  unmarkMessageAsSpamInMailbox,
  updateMessageLabelsInMailbox,
} from "~/lib/gmail/inbox-query";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { mailboxSearchParams } from "~/lib/search-params";
import { ComposeDialog } from "./compose-dialog";
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
  composeRequestId: number;
  requestedDraft: ComposeDraftState | null;
  isManualRefreshing: boolean;
  isWindowActive: boolean;
  pendingMessageActionIds: ReadonlySet<string>;
  pendingThreadActionIds: ReadonlySet<string>;
};

type MailboxWorkspaceAction =
  | {
      type: "compose/requested";
      draft?: ComposeDraftState | null;
    }
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
      type: "thread-pending/set";
      pending: boolean;
      threadId: string;
    };

type MailboxWorkspaceViewProps = {
  activeMailbox: MailboxCategory;
  activeMessageId: string | null;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
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
  composeRequestId: 0,
  requestedDraft: null,
  isManualRefreshing: false,
  isWindowActive: false,
  pendingMessageActionIds: new Set(),
  pendingThreadActionIds: new Set(),
};

const updatePendingIds = (
  current: ReadonlySet<string>,
  id: string,
  pending: boolean,
): ReadonlySet<string> => {
  const next = new Set(current);

  if (pending) {
    next.add(id);
  } else {
    next.delete(id);
  }

  return next;
};

const mailboxWorkspaceReducer = (
  state: MailboxWorkspaceState,
  action: MailboxWorkspaceAction,
): MailboxWorkspaceState => {
  switch (action.type) {
    case "compose/requested":
      return {
        ...state,
        composeRequestId: state.composeRequestId + 1,
        requestedDraft: action.draft ? cloneComposeDraft(action.draft) : null,
      };
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
          action.messageId,
          action.pending,
        ),
      };
    case "thread-pending/set":
      return {
        ...state,
        pendingThreadActionIds: updatePendingIds(
          state.pendingThreadActionIds,
          action.threadId,
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

  return {
    deleteMessagePermanently,
    isMessageActionPending,
    isThreadActionPending,
    markMessageAsRead,
    markMessageAsSpam,
    markMessageAsUnread,
    markThreadAsRead,
    markThreadAsUnread,
    moveMessageToTrash,
    unmarkMessageAsSpam,
    updateMessageLabels,
  };
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [workspaceState, dispatch] = useReducer(
    mailboxWorkspaceReducer,
    initialMailboxWorkspaceState,
  );
  const {
    composeRequestId,
    requestedDraft,
    isManualRefreshing,
    isWindowActive,
    pendingMessageActionIds,
    pendingThreadActionIds,
  } = workspaceState;
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
  if (activeMessageId) {
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

  useEffect(() => {
    if (isLiveSyncEnabled) return;

    void queryClient.cancelQueries({
      queryKey: getLiveSyncQueryKey(activeMailbox, activeSearchQuery),
    });
  }, [activeMailbox, activeSearchQuery, isLiveSyncEnabled, queryClient]);

  useEffect(() => {
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
    deleteMessagePermanently,
    isMessageActionPending,
    isThreadActionPending,
    markMessageAsRead,
    markMessageAsSpam,
    markMessageAsUnread,
    markThreadAsRead,
    markThreadAsUnread,
    moveMessageToTrash,
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

  const activateMessage = (messageId: string) => {
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
        error={messagesQuery.error ?? null}
        hasNextPage={Boolean(messagesQuery.hasNextPage)}
        isFetchingNextPage={messagesQuery.isFetchingNextPage}
        isMessageActionPending={isMessageActionPending}
        isMessagesError={messagesQuery.isError}
        isMessagesPending={messagesQuery.isPending}
        isRefreshing={isRefreshing}
        isThreadActionPending={isThreadActionPending}
        messages={messagesQuery.data?.pages ?? []}
        onActivateMessage={activateMessage}
        onComposeNewMail={() => {
          dispatch({
            type: "compose/requested",
          });
        }}
        onComposeDraftRequested={(draft) => {
          dispatch({
            type: "compose/requested",
            draft,
          });
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
        composeRequestId={composeRequestId}
        queryClient={queryClient}
        requestedDraft={requestedDraft}
        userId={user.id ?? null}
      />
      <LogoDevFooter />
    </>
  );
};

const MailboxWorkspaceView = ({
  activeMailbox,
  activeMessageId,
  error,
  hasNextPage,
  isFetchingNextPage,
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
              error={error}
              hasNextPage={hasNextPage}
              isError={isMessagesError}
              isFetchingNextPage={isFetchingNextPage}
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
