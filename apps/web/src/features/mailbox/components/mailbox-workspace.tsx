"use client";

import { isPersonalWorkspaceId, toWorkspaceId } from "@quieter/auth/workspace";
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import {
  type ComposeDraftState,
  buildComposeDraftFromSavedDraftMessage,
  cloneComposeDraft,
  hydrateComposeDraftRuntime,
} from "~/features/compose";
import { type ComposeDialogHandle, ComposeDialog } from "~/features/compose";
import { MessageList } from "~/features/message-list/components/message-list";
import { MessageDetail } from "~/features/message-thread/components/message-detail";
import { MailSidebar } from "~/features/navigation/components/mail-sidebar";
import { authClient } from "~/lib/auth";
import { getErrorMessage } from "~/lib/errors";
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
  untrashMessageInMailbox,
  untrashThreadInMailbox,
  unmarkThreadAsSpamInMailbox,
  unmarkMessageAsSpamInMailbox,
  updateMessageLabelsInMailbox,
} from "~/lib/gmail/inbox-query";
import {
  createMailboxWorkspaceStore,
  isMessageActionPending as isMessageActionPendingInStore,
  isThreadActionPending as isThreadActionPendingInStore,
  setMailboxWorkspaceManualRefreshing,
  setMailboxWorkspaceMessagePending,
  setMailboxWorkspaceMessagesPending,
  setMailboxWorkspaceThreadPending,
  setMailboxWorkspaceThreadsPending,
  setMailboxWorkspaceWindowActive,
  type MailboxWorkspaceStore,
} from "~/lib/gmail/mailbox-workspace-store";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { inboxRouteApi } from "~/lib/route-apis";
import { toMailboxSearch } from "~/lib/search-params";

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

type ConnectedMailbox = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  provider: string;
};

type MailboxWorkspaceViewProps = {
  activeMailbox: MailboxCategory;
  activeMessageId: string | null;
  hasMailbox: boolean;
  onBulkDeleteDrafts: (threads: ThreadListEntry[]) => void;
  onBulkDeletePermanently: (threads: ThreadListEntry[]) => void;
  onBulkMarkAsRead: (threads: ThreadListEntry[]) => void;
  onBulkMarkAsSpam: (threads: ThreadListEntry[]) => void;
  onBulkMarkAsUnread: (threads: ThreadListEntry[]) => void;
  onBulkMoveToTrash: (threads: ThreadListEntry[]) => void;
  onBulkUnmarkAsSpam: (threads: ThreadListEntry[]) => void;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onDeleteDraft: (message: MessageListItem) => void;
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isPersonalWorkspace: boolean;
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
  onMarkThreadAsSpam: (threadId: string) => void;
  onMarkThreadAsUnread: (threadId: string) => void;
  onMoveThreadToTrash: (threadId: string) => void;
  onMoveToTrash: (messageId: string) => void;
  onOpenDraft: (message: MessageListItem) => void;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  defaultMailboxId: string | null;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onUntrash: (messageId: string) => void;
  onUntrashThread: (threadId: string) => void;
  onUnsubscribe: (messageId: string) => void;
  onUnmarkAsSpam: (messageId: string) => void;
  onUnmarkThreadAsSpam: (threadId: string) => void;
  onUpdateLabels: (messageId: string, changes: LabelChangeSet) => void;
  onDeleteThreadPermanently: (threadId: string) => void;
  selectedMailboxId: string | null;
  mailboxes: ConnectedMailbox[];
  searchQuery: string;
  selectedMessage: MessageListItem | null;
  mailboxId: string | null;
  user: MailboxWorkspaceProps["user"];
  workspaceName: string;
};

type MailboxActionHandlerArgs = {
  activeMailbox: MailboxCategory;
  activeSearchQuery: string;
  workspaceStore: MailboxWorkspaceStore;
  queryClient: QueryClient;
  refreshSearchResultsIfNeeded: () => Promise<void>;
  unsubscribeFromMessageMutation: (messageId: string) => Promise<void>;
  mailboxId: string;
};

const mergeHydratedComposeDraft = (
  pendingDraft: ComposeDraftState,
  hydratedDraft: ComposeDraftState,
): ComposeDraftState => ({
  ...hydratedDraft,
  localId: pendingDraft.localId,
  draftAnchor: pendingDraft.draftAnchor ?? hydratedDraft.draftAnchor ?? null,
  replyContext: pendingDraft.replyContext ?? hydratedDraft.replyContext ?? null,
  recipients: pendingDraft.recipients,
  subject: pendingDraft.subject,
  bodyHtml: pendingDraft.bodyHtml,
  bodyText: pendingDraft.bodyText,
});

const createMailboxActionHandlers = ({
  activeMailbox,
  activeSearchQuery,
  workspaceStore,
  queryClient,
  refreshSearchResultsIfNeeded,
  unsubscribeFromMessageMutation,
  mailboxId,
}: MailboxActionHandlerArgs) => {
  const isMessageActionPending = (messageId: string | null | undefined) =>
    isMessageActionPendingInStore(workspaceStore, messageId);

  const isThreadActionPending = (threadId: string | null | undefined) =>
    isThreadActionPendingInStore(workspaceStore, threadId);

  const getUniqueIds = (ids: readonly string[]) =>
    Array.from(
      new Set(
        ids.flatMap((id) => {
          const normalizedId = id.trim();
          return normalizedId ? [normalizedId] : [];
        }),
      ),
    );

  const setMessageActionPending = (messageId: string, pending: boolean) => {
    setMailboxWorkspaceMessagePending(workspaceStore, messageId, pending);
  };

  const setThreadActionPending = (threadId: string, pending: boolean) => {
    setMailboxWorkspaceThreadPending(workspaceStore, threadId, pending);
  };

  const setMessageActionsPending = (messageIds: string[], pending: boolean) => {
    setMailboxWorkspaceMessagesPending(workspaceStore, messageIds, pending);
  };

  const setThreadActionsPending = (threadIds: string[], pending: boolean) => {
    setMailboxWorkspaceThreadsPending(workspaceStore, threadIds, pending);
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
      await markMessageAsReadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markMessageAsUnread = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsUnreadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markMessageAsSpam = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markThreadAsRead = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsReadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const markThreadAsUnread = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsUnreadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const updateMessageLabels = async (messageId: string, changes: LabelChangeSet) => {
    await runMessageAction(messageId, async () => {
      await updateMessageLabelsInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
        changes,
      );
    });
  };

  const moveMessageToTrash = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await moveMessageToTrashInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const moveThreadToTrash = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await moveThreadToTrashInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const untrashMessage = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await untrashMessageInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const untrashThread = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await untrashThreadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const unsubscribeFromMessage = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await unsubscribeFromMessageMutation(messageId);
    });
  };

  const unmarkMessageAsSpam = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await unmarkMessageAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markThreadAsSpam = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const unmarkThreadAsSpam = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await unmarkThreadAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const deleteDraft = async (message: MessageListItem) => {
    if (!message.draftId) return;

    await runMessageAction(message.id, async () => {
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
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
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const deleteThreadPermanently = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await deleteThreadPermanentlyInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
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
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
        draftId,
      );
    });
  };

  const markThreadsAsRead = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsReadInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const markThreadsAsUnread = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsUnreadInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const markThreadsAsSpam = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsSpamInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const unmarkThreadsAsSpam = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await unmarkThreadAsSpamInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const moveThreadsToTrash = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await moveThreadToTrashInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const deleteThreadsPermanently = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await deleteThreadPermanentlyInMailbox(
          queryClient,
          mailboxId,
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
    deleteThreadPermanently,
    deleteThreadsPermanently,
    isMessageActionPending,
    isThreadActionPending,
    markMessageAsRead,
    markMessageAsSpam,
    markMessageAsUnread,
    markThreadAsRead,
    markThreadAsSpam,
    markThreadsAsRead,
    markThreadsAsSpam,
    markThreadsAsUnread,
    markThreadAsUnread,
    moveThreadToTrash,
    moveThreadsToTrash,
    moveMessageToTrash,
    untrashMessage,
    untrashThread,
    unsubscribeFromMessage,
    unmarkThreadAsSpam,
    unmarkThreadsAsSpam,
    unmarkMessageAsSpam,
    updateMessageLabels,
  };
};

const useMailboxWorkspaceModel = (user: MailboxWorkspaceProps["user"]) => {
  const navigate = useNavigate({
    from: "/",
  });
  const queryClient = useQueryClient();
  const activeOrganizationState = authClient.useActiveOrganization();
  const composeDialogRef = useRef<ComposeDialogHandle | null>(null);
  const [workspaceStore] = useState(createMailboxWorkspaceStore);
  const isManualRefreshing = useSelector(workspaceStore, (state) => state.isManualRefreshing);
  const isWindowActive = useSelector(workspaceStore, (state) => state.isWindowActive);
  const { mailbox: activeMailbox, mailboxId, messageId, query } = inboxRouteApi.useSearch();
  const activeMessageId = messageId ?? null;
  const activeSearchQuery = query.trim();
  const workspaceId = toWorkspaceId(activeOrganizationState.data?.id);
  const workspaceName = activeOrganizationState.data?.name ?? "Personal";
  const isPersonalWorkspace = isPersonalWorkspaceId(workspaceId);
  const mailboxesQuery = useQuery(mailboxesQueryOptions(workspaceId));
  const defaultMailboxId = mailboxesQuery.data?.defaultMailboxId ?? null;
  const mailboxes = (mailboxesQuery.data?.mailboxes ?? [])
    .map((mailbox) => ({
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      provider: mailbox.provider,
    }))
    .sort((a, b) => {
      if (a.id === defaultMailboxId) return -1;
      if (b.id === defaultMailboxId) return 1;
      return 0;
    });
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === mailboxId) ??
    mailboxes.find((mailbox) => mailbox.id === defaultMailboxId) ??
    mailboxes[0] ??
    null;
  const selectedMailboxId = selectedMailbox?.id ?? null;

  const unsubscribeMutationOptions = orpc.mail.unsubscribeFromMessage.mutationOptions();
  const unsubscribeMutation = useMutation(unsubscribeMutationOptions);
  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(workspaceId),
      });
    },
  });

  const messagesQuery = useInfiniteQuery(
    messagesQueryOptions(
      selectedMailboxId ?? "",
      activeMailbox,
      activeSearchQuery,
      Boolean(selectedMailboxId),
    ),
  );
  const hasLoadedMessages = Boolean(messagesQuery.data?.pages.length);
  const isLiveSyncEnabled =
    Boolean(selectedMailboxId) &&
    activeMailbox !== "drafts" &&
    activeSearchQuery.length === 0 &&
    isWindowActive &&
    hasLoadedMessages &&
    !isManualRefreshing;
  const syncQuery = useQuery(
    liveSyncQueryOptions(
      queryClient,
      selectedMailboxId ?? "",
      activeMailbox,
      activeSearchQuery,
      isLiveSyncEnabled,
    ),
  );
  const flattenedMessages = messagesQuery.data?.pages.flatMap((page) => page.messages) ?? [];

  const refreshMessages = async () => {
    if (!selectedMailboxId) {
      return;
    }

    const liveSyncQueryKey = getLiveSyncQueryKey(
      selectedMailboxId,
      activeMailbox,
      activeSearchQuery,
    );
    const messagesQueryKey = getMessagesQueryKey(
      selectedMailboxId,
      activeMailbox,
      activeSearchQuery,
    );

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setMailboxWorkspaceManualRefreshing(workspaceStore, true);
    try {
      await syncMessages(queryClient, selectedMailboxId, activeMailbox, activeSearchQuery);
    } finally {
      setMailboxWorkspaceManualRefreshing(workspaceStore, false);
    }
  };

  const refreshSearchResultsIfNeeded = async () => {
    if (!selectedMailboxId || activeSearchQuery.length === 0) return;
    await refreshLoadedMessagesPages(
      queryClient,
      selectedMailboxId,
      activeMailbox,
      activeSearchQuery,
    );
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

  const setMailboxSearch = (search: {
    mailbox?: MailboxCategory;
    mailboxId?: string | null;
    messageId?: string | null;
    query?: string | null;
  }) => {
    return navigate({
      replace: true,
      resetScroll: false,
      search: (previous) =>
        toMailboxSearch({
          ...previous,
          ...search,
        }),
      to: ".",
    });
  };

  useEffect(() => {
    const updateWindowActivity = () => {
      setMailboxWorkspaceWindowActive(
        workspaceStore,
        document.visibilityState === "visible" && document.hasFocus(),
      );
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
  }, [workspaceStore]);

  useLayoutEffect(() => {
    if (mailboxesQuery.isPending) {
      return;
    }

    const normalizedMailboxId = mailboxId?.trim() || null;
    if (normalizedMailboxId === selectedMailboxId) {
      return;
    }

    void setMailboxSearch({
      mailboxId: selectedMailboxId,
      messageId: null,
    });
  }, [mailboxId, mailboxesQuery.isPending, selectedMailboxId]);

  useLayoutEffect(() => {
    if (
      !selectedMailboxId ||
      !activeMessageId ||
      messagesQuery.isPending ||
      !messagesQuery.data?.pages.length ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxSearch({ messageId: null });
  }, [activeMessageId, messagesQuery.data, messagesQuery.isPending, selectedMessage]);

  const {
    deleteDraft,
    deleteDrafts,
    deleteMessagePermanently,
    deleteThreadPermanently,
    deleteThreadsPermanently,
    isMessageActionPending,
    isThreadActionPending,
    markMessageAsRead,
    markMessageAsSpam,
    markMessageAsUnread,
    markThreadAsRead,
    markThreadAsSpam,
    markThreadsAsRead,
    markThreadsAsSpam,
    markThreadsAsUnread,
    markThreadAsUnread,
    moveThreadToTrash,
    moveThreadsToTrash,
    moveMessageToTrash,
    untrashMessage,
    untrashThread,
    unsubscribeFromMessage,
    unmarkThreadAsSpam,
    unmarkThreadsAsSpam,
    unmarkMessageAsSpam,
    updateMessageLabels,
  } = createMailboxActionHandlers({
    activeMailbox,
    activeSearchQuery,
    workspaceStore,
    queryClient,
    refreshSearchResultsIfNeeded,
    unsubscribeFromMessageMutation: async (messageId) => {
      if (!selectedMailboxId) {
        return;
      }

      await unsubscribeMutation.mutateAsync({ mailboxId: selectedMailboxId, messageId });
    },
    mailboxId: selectedMailboxId ?? "",
  });

  const openComposeDraft = async (draft: ComposeDraftState) => {
    const pendingDraft = cloneComposeDraft(draft);
    if (!selectedMailboxId || !pendingDraft.draftId) {
      composeDialogRef.current?.openDraft(pendingDraft);
      return;
    }

    try {
      const hydratedDraft = await hydrateComposeDraftRuntime(selectedMailboxId, pendingDraft);
      composeDialogRef.current?.openDraft(mergeHydratedComposeDraft(pendingDraft, hydratedDraft));
    } catch (error) {
      composeDialogRef.current?.openDraft({
        ...pendingDraft,
        errorMessage: getErrorMessage(error, "Could not load that draft."),
        saveStatus: "error",
      });
    }
  };

  const openDraft = (message: MessageListItem) => {
    if (!message.draftId) {
      return;
    }

    void setMailboxSearch({ messageId: null });
    void openComposeDraft(buildComposeDraftFromSavedDraftMessage(message));
  };

  const activateMessage = (messageId: string) => {
    if (activeMailbox === "drafts") {
      const draftMessage = flattenedMessages.find((message) => message.id === messageId);
      if (draftMessage) {
        openDraft(draftMessage);
      }
      return;
    }

    const threadId = flattenedMessages.find((message) => message.id === messageId)?.threadId;

    void setMailboxSearch({ messageId });

    if (threadId && selectedMailboxId) {
      void queryClient.prefetchQuery(
        getThreadWithDetailsOptions(selectedMailboxId, activeMailbox, threadId),
      );
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
      void setMailboxSearch({ messageId: null });
      void refreshMessages();
      return;
    }

    void setMailboxSearch({
      messageId: null,
      query: normalizedQuery.length > 0 ? normalizedQuery : null,
    });
  };

  const selectMailbox = (mailbox: MailboxCategory) => {
    if (mailbox === activeMailbox) return;
    void setMailboxSearch({ mailbox, messageId: null });
  };

  const isRefreshing =
    isManualRefreshing ||
    syncQuery.isFetching ||
    (messagesQuery.isRefetching && !messagesQuery.isFetchingNextPage);

  return {
    composeDialogKey: selectedMailboxId ?? `${workspaceId}:${user.id ?? "signed-out"}`,
    composeDialogRef,
    composeDialogMailboxId: selectedMailboxId,
    viewProps: {
      activeMailbox,
      activeMessageId,
      defaultMailboxId,
      error: messagesQuery.error ?? null,
      hasNextPage: Boolean(messagesQuery.hasNextPage),
      hasMailbox: Boolean(selectedMailboxId),
      isFetchingNextPage: messagesQuery.isFetchingNextPage,
      isMessageActionPending,
      isPersonalWorkspace,
      isMessagesError: messagesQuery.isError,
      isMessagesPending: messagesQuery.isPending,
      isRefreshing,
      isThreadActionPending,
      mailboxId: selectedMailboxId,
      mailboxes,
      messages: messagesQuery.data?.pages ?? [],
      onActivateMessage: activateMessage,
      onBulkDeleteDrafts: (threads) => {
        void deleteDrafts(threads);
      },
      onBulkDeletePermanently: (threads) => {
        void deleteThreadsPermanently(threads);
      },
      onBulkMarkAsRead: (threads) => {
        void markThreadsAsRead(threads);
      },
      onBulkMarkAsSpam: (threads) => {
        void markThreadsAsSpam(threads);
      },
      onBulkMarkAsUnread: (threads) => {
        void markThreadsAsUnread(threads);
      },
      onBulkMoveToTrash: (threads) => {
        void moveThreadsToTrash(threads);
      },
      onBulkUnmarkAsSpam: (threads) => {
        void unmarkThreadsAsSpam(threads);
      },
      onComposeDraftRequested: (draft) => {
        void openComposeDraft(draft);
      },
      onComposeNewMail: () => {
        composeDialogRef.current?.openNewMail();
      },
      onDeleteDraft: (message) => {
        void deleteDraft(message);
      },
      onDeletePermanently: (messageId) => {
        void deleteMessagePermanently(messageId);
      },
      onDeleteThreadPermanently: (threadId) => {
        void deleteThreadPermanently(threadId);
      },
      onLoadMore: loadMoreMessages,
      onMarkAsRead: (messageId) => {
        void markMessageAsRead(messageId);
      },
      onMarkAsSpam: (messageId) => {
        void markMessageAsSpam(messageId);
      },
      onMarkAsUnread: (messageId) => {
        void markMessageAsUnread(messageId);
      },
      onMarkThreadAsRead: (threadId) => {
        void markThreadAsRead(threadId);
      },
      onMarkThreadAsSpam: (threadId) => {
        void markThreadAsSpam(threadId);
      },
      onMarkThreadAsUnread: (threadId) => {
        void markThreadAsUnread(threadId);
      },
      onMoveThreadToTrash: (threadId) => {
        void moveThreadToTrash(threadId);
      },
      onMoveToTrash: (messageId) => {
        void moveMessageToTrash(messageId);
      },
      onOpenDraft: openDraft,
      onRefresh: () => {
        void refreshMessages();
      },
      onSearch: applySearch,
      onSelectMailbox: selectMailbox,
      onSelectMailboxId: (nextMailboxId) => {
        if (nextMailboxId === selectedMailboxId) {
          return;
        }

        void setMailboxSearch({ mailboxId: nextMailboxId, messageId: null });
      },
      onSetDefaultMailbox: (nextMailboxId) => {
        void setDefaultMailboxMutation.mutateAsync({ mailboxId: nextMailboxId });
      },
      onUntrash: (messageId) => {
        void untrashMessage(messageId);
      },
      onUntrashThread: (threadId) => {
        void untrashThread(threadId);
      },
      onUnmarkAsSpam: (messageId) => {
        void unmarkMessageAsSpam(messageId);
      },
      onUnmarkThreadAsSpam: (threadId) => {
        void unmarkThreadAsSpam(threadId);
      },
      onUnsubscribe: (messageId) => {
        void unsubscribeFromMessage(messageId);
      },
      onUpdateLabels: (messageId, changes) => {
        void updateMessageLabels(messageId, changes);
      },
      searchQuery: activeSearchQuery,
      selectedMessage,
      selectedMailboxId,
      user,
      workspaceName,
    } satisfies MailboxWorkspaceViewProps,
  };
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const { composeDialogKey, composeDialogMailboxId, composeDialogRef, viewProps } =
    useMailboxWorkspaceModel(user);

  return (
    <>
      <MailboxWorkspaceView {...viewProps} />
      <ComposeDialog
        key={composeDialogKey}
        mailboxId={composeDialogMailboxId}
        ref={composeDialogRef}
      />
    </>
  );
};

const MailboxWorkspaceView = ({
  activeMailbox,
  activeMessageId,
  defaultMailboxId,
  hasMailbox,
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
  isPersonalWorkspace,
  isMessagesError,
  isMessagesPending,
  isRefreshing,
  isThreadActionPending,
  messages,
  onActivateMessage,
  onComposeDraftRequested,
  onComposeNewMail,
  onDeletePermanently,
  onDeleteThreadPermanently,
  onLoadMore,
  onMarkAsRead,
  onMarkAsSpam,
  onMarkAsUnread,
  onMarkThreadAsRead,
  onMarkThreadAsSpam,
  onMarkThreadAsUnread,
  onMoveThreadToTrash,
  onMoveToTrash,
  onOpenDraft,
  onRefresh,
  onSearch,
  onSelectMailbox,
  onSelectMailboxId,
  onSetDefaultMailbox,
  onUntrash,
  onUntrashThread,
  onUnsubscribe,
  onUnmarkAsSpam,
  onUnmarkThreadAsSpam,
  onUpdateLabels,
  mailboxId,
  mailboxes,
  searchQuery,
  selectedMessage,
  selectedMailboxId,
  workspaceName,
}: MailboxWorkspaceViewProps) => {
  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" />

        <MailSidebar
          defaultMailboxId={defaultMailboxId}
          mailboxes={mailboxes}
          onComposeNewMail={onComposeNewMail}
          onSelectMailbox={onSelectMailbox}
          onSelectMailboxId={onSelectMailboxId}
          onSetDefaultMailbox={onSetDefaultMailbox}
          selectedMailbox={activeMailbox}
          selectedMailboxId={selectedMailboxId}
          workspaceName={workspaceName}
        />

        <div className="relative flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          {hasMailbox && mailboxId ? (
            <>
              <section className="flex min-h-0 min-w-0 flex-col border-r border-border bg-background-light">
                <MessageList
                  activeMailbox={activeMailbox}
                  activeMessageId={activeMessageId}
                  isThreadActionPending={isThreadActionPending}
                  mailboxId={mailboxId}
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
                  onDeleteThreadPermanently={onDeleteThreadPermanently}
                  onLoadMore={onLoadMore}
                  onMarkAsRead={onMarkAsRead}
                  onMarkAsSpam={onMarkAsSpam}
                  onMarkAsUnread={onMarkAsUnread}
                  onMarkThreadAsSpam={onMarkThreadAsSpam}
                  onMoveThreadToTrash={onMoveThreadToTrash}
                  onMoveToTrash={onMoveToTrash}
                  onOpenDraft={onOpenDraft}
                  onRefresh={onRefresh}
                  onSearch={onSearch}
                  onUntrash={onUntrash}
                  onUntrashThread={onUntrashThread}
                  onUnsubscribe={onUnsubscribe}
                  onUnmarkAsSpam={onUnmarkAsSpam}
                  onUnmarkThreadAsSpam={onUnmarkThreadAsSpam}
                  onUpdateLabels={onUpdateLabels}
                  searchQuery={searchQuery}
                />
              </section>

              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
                <MessageDetail
                  activeMailbox={activeMailbox}
                  currentUserEmail={
                    mailboxes.find((mailbox) => mailbox.id === mailboxId)?.emailAddress ?? null
                  }
                  isActionPending={
                    isMessageActionPending(selectedMessage?.id) ||
                    isThreadActionPending(selectedMessage?.threadId)
                  }
                  mailboxId={mailboxId}
                  onComposeDraftRequested={onComposeDraftRequested}
                  onDeletePermanently={onDeletePermanently}
                  onDeleteThreadPermanently={onDeleteThreadPermanently}
                  onMarkAsRead={onMarkAsRead}
                  onMarkAsSpam={onMarkAsSpam}
                  onMarkAsUnread={onMarkAsUnread}
                  onMarkThreadAsRead={onMarkThreadAsRead}
                  onMarkThreadAsSpam={onMarkThreadAsSpam}
                  onMarkThreadAsUnread={onMarkThreadAsUnread}
                  onMoveThreadToTrash={onMoveThreadToTrash}
                  onMoveToTrash={onMoveToTrash}
                  onUntrash={onUntrash}
                  onUntrashThread={onUntrashThread}
                  onUnsubscribe={onUnsubscribe}
                  onUnmarkAsSpam={onUnmarkAsSpam}
                  onUnmarkThreadAsSpam={onUnmarkThreadAsSpam}
                  onUpdateLabels={onUpdateLabels}
                  selectedMessage={selectedMessage}
                />
              </div>
            </>
          ) : (
            <section className="flex min-h-0 flex-1 items-center justify-center border-r border-border bg-background-light px-8">
              <div className="max-w-md space-y-3 text-center">
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  No mailboxes in {workspaceName}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {isPersonalWorkspace
                    ? "Connect Gmail to use Personal mail."
                    : "This team does not have a managed mailbox yet."}
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
};
