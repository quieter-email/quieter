"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { cn } from "@quieter/ui";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MailboxSwitcherOrder } from "~/features/navigation/components/mailbox-switcher";
import type { MailboxSearch } from "~/routes/index";
import { LoadingPage } from "~/components/loading-page";
import { type ComposeDraftState, buildComposeDraftFromSavedDraftMessage } from "~/features/compose";
import { type ComposeDialogHandle, ComposeDialog } from "~/features/compose";
import { MessageList } from "~/features/message-list/components/message-list";
import { MessageDetail } from "~/features/message-thread/components/message-detail";
import { MailSidebar } from "~/features/navigation/components/mail-sidebar";
import { useDemoModeEnabled } from "~/features/settings/domain/demo-mode-setting";
import { createDemoMailboxActions, DEMO_MAILBOX_ID, getDemoMailboxes } from "~/lib/gmail/demo-mail";
import { type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
  refreshVisibleMailboxMessages,
  syncMessages,
} from "~/lib/gmail/inbox-query";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";
import { inboxRouteApi } from "~/lib/route-apis";
import { createMailboxActionHandlers, type MailboxPendingActions } from "./mailbox-action-handlers";
import {
  collectVisibleMessageRefreshBatch,
  queueVisibleMessageRefreshIds,
} from "./visible-message-refresh";

type MailboxWorkspaceProps = {
  user: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
};

type MailboxSearchPatch = {
  mailbox?: MailboxCategory;
  mailboxId?: string | null;
  messageId?: string | null;
  query?: string | null;
};

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];

const VISIBLE_MESSAGE_REFRESH_DEBOUNCE_MS = 250;
const VISIBLE_MESSAGE_REFRESH_COOLDOWN_MS = 1000 * 60 * 5;
const VISIBLE_MESSAGE_REFRESH_MAX_BATCH_SIZE = 25;
const VISIBLE_MESSAGE_REFRESH_PREFIX_PAGE_SKIP = 3;

const getPrefixMessageIds = (pages: readonly { messages: readonly MessageListItem[] }[]) => {
  return new Set(
    pages
      .slice(0, VISIBLE_MESSAGE_REFRESH_PREFIX_PAGE_SKIP)
      .flatMap((page) => page.messages.map((message) => message.id)),
  );
};

const mergeMailboxSearch = (previous: MailboxSearch, patch: MailboxSearchPatch): MailboxSearch => ({
  mailbox: patch.mailbox ?? previous.mailbox,
  mailboxId:
    patch.mailboxId === undefined
      ? previous.mailboxId
      : patch.mailboxId === null
        ? undefined
        : patch.mailboxId.trim() || undefined,
  messageId:
    patch.messageId === undefined
      ? previous.messageId
      : patch.messageId === null
        ? undefined
        : patch.messageId.trim() || undefined,
  query:
    patch.query === undefined ? previous.query : patch.query === null ? "" : patch.query.trim(),
});

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

const reorderMailboxQueryData = (
  data: MailboxesQueryData,
  order: MailboxSwitcherOrder,
): MailboxesQueryData => {
  const groupsById = new Map(data.groups.map((group) => [group.id, group]));
  const orderedGroupIds = [
    ...order.groupIds.filter((groupId) => groupsById.has(groupId)),
    ...data.groups.map((group) => group.id).filter((groupId) => !order.groupIds.includes(groupId)),
  ];

  return {
    ...data,
    groups: orderedGroupIds.flatMap((groupId) => {
      const group = groupsById.get(groupId);
      if (!group) {
        return [];
      }

      const mailboxesById = new Map(group.mailboxes.map((mailbox) => [mailbox.id, mailbox]));
      const orderedMailboxIds = [
        ...(order.mailboxIdsByGroupId[group.id] ?? []).filter((mailboxId) =>
          mailboxesById.has(mailboxId),
        ),
        ...group.mailboxes
          .map((mailbox) => mailbox.id)
          .filter((mailboxId) => !order.mailboxIdsByGroupId[group.id]?.includes(mailboxId)),
      ];

      return [
        {
          ...group,
          mailboxes: orderedMailboxIds.flatMap((mailboxId) => {
            const mailbox = mailboxesById.get(mailboxId);
            return mailbox ? [mailbox] : [];
          }),
        },
      ];
    }),
  };
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const navigate = useNavigate({
    from: "/",
  });
  const queryClient = useQueryClient();
  const composeDialogRef = useRef<ComposeDialogHandle | null>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isWindowActive, setIsWindowActive] = useState(false);
  const [pendingMessageActionIds, setPendingMessageActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingThreadActionIds, setPendingThreadActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pendingMessageActionIdsRef = useRef(pendingMessageActionIds);
  const pendingThreadActionIdsRef = useRef(pendingThreadActionIds);
  const visibleMessageRefreshQueueRef = useRef<Set<string>>(new Set());
  const visibleMessageRefreshRecentAttemptsRef = useRef<Map<string, number>>(new Map());
  const visibleMessageRefreshInFlightIdsRef = useRef<Set<string>>(new Set());
  const visibleMessageRefreshInFlightRef = useRef(false);
  const visibleMessageRefreshTimeoutRef = useRef<number | null>(null);
  const flushVisibleMessageRefreshQueueRef = useRef<() => void>(() => {});
  const { mailbox: activeMailbox, mailboxId, messageId, query } = inboxRouteApi.useSearch();
  const isDemoMode = useDemoModeEnabled();

  pendingMessageActionIdsRef.current = pendingMessageActionIds;
  pendingThreadActionIdsRef.current = pendingThreadActionIds;
  const mailboxesQuery = useQuery(mailboxesQueryOptions(!isDemoMode));
  const mailboxesData = isDemoMode ? getDemoMailboxes() : mailboxesQuery.data;
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const mailboxGroups = (mailboxesData?.groups ?? []).map((group) => ({
    id: group.id,
    kind: group.kind,
    name: group.name,
    mailboxes: group.mailboxes.map((mailbox) => ({
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      groupName: mailbox.groupName,
      id: mailbox.id,
      provider: mailbox.provider,
    })),
  }));
  const mailboxes = mailboxGroups.flatMap((group) => group.mailboxes);
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === mailboxId) ??
    mailboxes.find((mailbox) => mailbox.id === defaultMailboxId) ??
    mailboxes[0] ??
    null;
  const selectedMailboxId = selectedMailbox?.id ?? null;

  const unsubscribeMutation = useMutation(orpc.mail.unsubscribeFromMessage.mutationOptions());
  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    },
  });
  const updateMailboxSwitcherOrderMutation = useMutation({
    ...orpc.mail.updateMailboxSwitcherOrder.mutationOptions(),
    onMutate: async (order) => {
      const queryKey = getMailboxesQueryKey();
      await queryClient.cancelQueries({ queryKey });

      const previousData = queryClient.getQueryData<MailboxesQueryData>(queryKey);
      if (previousData) {
        queryClient.setQueryData<MailboxesQueryData>(
          queryKey,
          reorderMailboxQueryData(previousData, order),
        );
        await queryPersister.persistQueryByKey(queryKey, queryClient);
      }

      return { previousData };
    },
    onError: async (_error, _order, context) => {
      if (context?.previousData) {
        const queryKey = getMailboxesQueryKey();
        queryClient.setQueryData(queryKey, context.previousData);
        await queryPersister.persistQueryByKey(queryKey, queryClient);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    },
  });

  const messagesQuery = useInfiniteQuery(
    messagesQueryOptions(selectedMailboxId ?? "", activeMailbox, query.trim(), !!selectedMailboxId),
  );
  const messages = messagesQuery.data?.pages ?? [];
  const hasLoadedMessages = !!messagesQuery.data?.pages.length;
  const isLiveSyncEnabled =
    !!selectedMailboxId &&
    !isDemoMode &&
    activeMailbox !== "drafts" &&
    query.trim().length === 0 &&
    isWindowActive &&
    hasLoadedMessages &&
    !isManualRefreshing;
  const syncQuery = useQuery(
    liveSyncQueryOptions(
      queryClient,
      selectedMailboxId ?? "",
      activeMailbox,
      query.trim(),
      isLiveSyncEnabled,
    ),
  );
  const flattenedMessages = useMemo(() => messages.flatMap((page) => page.messages), [messages]);

  const refreshMessages = async () => {
    if (!selectedMailboxId) {
      return;
    }

    const liveSyncQueryKey = getLiveSyncQueryKey(selectedMailboxId, activeMailbox, query.trim());
    const messagesQueryKey = getMessagesQueryKey(selectedMailboxId, activeMailbox, query.trim());

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setIsManualRefreshing(true);
    try {
      await syncMessages(queryClient, selectedMailboxId, activeMailbox, query.trim());
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const refreshSearchResultsIfNeeded = async () => {
    if (!selectedMailboxId || query.trim().length === 0) return;
    await refreshLoadedMessagesPages(queryClient, selectedMailboxId, activeMailbox, query.trim());
  };

  const scheduleVisibleMessageRefresh = useCallback(
    (delayMs = VISIBLE_MESSAGE_REFRESH_DEBOUNCE_MS) => {
      if (visibleMessageRefreshTimeoutRef.current) return;

      visibleMessageRefreshTimeoutRef.current = window.setTimeout(() => {
        visibleMessageRefreshTimeoutRef.current = null;
        flushVisibleMessageRefreshQueueRef.current();
      }, delayMs);
    },
    [],
  );

  flushVisibleMessageRefreshQueueRef.current = () => {
    if (visibleMessageRefreshInFlightRef.current) return;

    if (!selectedMailboxId || selectedMailboxId === DEMO_MAILBOX_ID || activeMailbox === "drafts") {
      visibleMessageRefreshQueueRef.current.clear();
      return;
    }

    const now = Date.now();
    const skipMessageIds = getPrefixMessageIds(messages);
    const messageIds = collectVisibleMessageRefreshBatch({
      cooldownMs: VISIBLE_MESSAGE_REFRESH_COOLDOWN_MS,
      inFlightMessageIds: visibleMessageRefreshInFlightIdsRef.current,
      maxBatchSize: VISIBLE_MESSAGE_REFRESH_MAX_BATCH_SIZE,
      now,
      queuedMessageIds: visibleMessageRefreshQueueRef.current,
      recentAttemptByMessageId: visibleMessageRefreshRecentAttemptsRef.current,
      skipMessageIds,
    });

    if (messageIds.length === 0) {
      if (visibleMessageRefreshQueueRef.current.size > 0) {
        scheduleVisibleMessageRefresh(0);
      }
      return;
    }

    visibleMessageRefreshInFlightRef.current = true;
    void refreshVisibleMailboxMessages(queryClient, {
      mailboxId: selectedMailboxId,
      mailbox: activeMailbox,
      messageIds,
      searchQuery: query.trim(),
    })
      .catch(() => {})
      .finally(() => {
        for (const messageId of messageIds) {
          visibleMessageRefreshInFlightIdsRef.current.delete(messageId);
        }

        visibleMessageRefreshInFlightRef.current = false;
        if (visibleMessageRefreshQueueRef.current.size > 0) {
          scheduleVisibleMessageRefresh(0);
        }
      });
  };

  const handleVisibleMessageIdsChange = useCallback(
    (messageIds: readonly string[]) => {
      if (
        !selectedMailboxId ||
        selectedMailboxId === DEMO_MAILBOX_ID ||
        activeMailbox === "drafts" ||
        messageIds.length === 0
      ) {
        return;
      }

      const skipMessageIds = getPrefixMessageIds(messages);
      const hasQueuedMessage = queueVisibleMessageRefreshIds(
        visibleMessageRefreshQueueRef.current,
        messageIds,
        skipMessageIds,
      );

      if (hasQueuedMessage) {
        scheduleVisibleMessageRefresh();
      }
    },
    [activeMailbox, messages, scheduleVisibleMessageRefresh, selectedMailboxId],
  );

  let selectedMessage: MessageListItem | null = null;
  if (activeMailbox !== "drafts" && messageId) {
    for (const message of flattenedMessages) {
      if (message.id === messageId) {
        selectedMessage = message;
        break;
      }
    }
  }

  const setMailboxSearch = (
    patch: MailboxSearchPatch,
    { replace = true }: { replace?: boolean } = {},
  ) => {
    return navigate({
      replace,
      resetScroll: false,
      search: (previous) => mergeMailboxSearch(previous, patch),
      to: ".",
    });
  };

  useEffect(() => {
    const updateWindowActivity = () => {
      setIsWindowActive(document.visibilityState === "visible" && document.hasFocus());
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
    return () => {
      if (visibleMessageRefreshTimeoutRef.current) {
        window.clearTimeout(visibleMessageRefreshTimeoutRef.current);
        visibleMessageRefreshTimeoutRef.current = null;
      }

      visibleMessageRefreshQueueRef.current.clear();
      visibleMessageRefreshRecentAttemptsRef.current.clear();
      visibleMessageRefreshInFlightIdsRef.current.clear();
      visibleMessageRefreshInFlightRef.current = false;
    };
  }, [activeMailbox, query, selectedMailboxId]);

  useLayoutEffect(() => {
    if (!isDemoMode && mailboxesQuery.isPending) {
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
  }, [isDemoMode, mailboxId, mailboxesQuery.isPending, selectedMailboxId]);

  useLayoutEffect(() => {
    if (
      !selectedMailboxId ||
      !messageId ||
      messagesQuery.isPending ||
      !messagesQuery.data?.pages.length ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxSearch({ messageId: null });
  }, [messageId, messagesQuery.data, messagesQuery.isPending, selectedMessage]);

  const pendingActions: MailboxPendingActions = {
    isMessageActionPending: (id) => (id ? pendingMessageActionIds.has(id) : false),
    isThreadActionPending: (id) => (id ? pendingThreadActionIds.has(id) : false),
  };

  const setMessageActionsPending = (ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingMessageActionIds((current) => {
      const next = updatePendingIds(current, ids, pending);
      pendingMessageActionIdsRef.current = next;
      return next;
    });
  };

  const setThreadActionsPending = (ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingThreadActionIds((current) => {
      const next = updatePendingIds(current, ids, pending);
      pendingThreadActionIdsRef.current = next;
      return next;
    });
  };

  const mailboxActions = isDemoMode
    ? createDemoMailboxActions(queryClient)
    : createMailboxActionHandlers({
        activeMailbox,
        activeSearchQuery: query.trim(),
        queryClient,
        refreshSearchResultsIfNeeded,
        isMessageActionPending: (id) => (id ? pendingMessageActionIdsRef.current.has(id) : false),
        isThreadActionPending: (id) => (id ? pendingThreadActionIdsRef.current.has(id) : false),
        setMessageActionPending: (id, pending) => setMessageActionsPending([id], pending),
        setMessageActionsPending,
        setThreadActionPending: (id, pending) => setThreadActionsPending([id], pending),
        setThreadActionsPending,
        unsubscribeFromMessageMutation: async (messageId) => {
          if (!selectedMailboxId) {
            return;
          }

          await unsubscribeMutation.mutateAsync({ mailboxId: selectedMailboxId, messageId });
        },
        mailboxId: selectedMailboxId ?? "",
      });

  const openComposeDraft = (draft: ComposeDraftState) => {
    composeDialogRef.current?.openDraft(draft);
  };

  const openDraft = (message: MessageListItem) => {
    if (!message.draftId) {
      return;
    }

    void setMailboxSearch({ messageId: null });
    openComposeDraft(buildComposeDraftFromSavedDraftMessage(message));
  };

  const activateMessage = (nextMessageId: string) => {
    if (activeMailbox === "drafts") {
      const draftMessage = flattenedMessages.find((message) => message.id === nextMessageId);
      if (draftMessage) {
        openDraft(draftMessage);
      }
      return;
    }

    const shouldPushMobileHistory =
      !messageId && window.matchMedia("(max-width: 1023.98px)").matches;
    void setMailboxSearch({ messageId: nextMessageId }, { replace: !shouldPushMobileHistory });
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

    if (normalizedQuery === query.trim()) {
      void setMailboxSearch({ messageId: null });
      void refreshMessages();
      return;
    }

    void setMailboxSearch({
      messageId: null,
      query: normalizedQuery || null,
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
  const isMessageRouteOpen = activeMailbox !== "drafts" && !!messageId;

  if (!isDemoMode && mailboxesQuery.isPending) {
    return (
      <>
        <LoadingPage />
        <ComposeDialog
          key={selectedMailboxId ?? user.id ?? "signed-out"}
          demoMode={isDemoMode}
          mailboxId={selectedMailboxId}
          ref={composeDialogRef}
        />
      </>
    );
  }

  const isLoadingEmptyMessages =
    !messages.some((page) => page.messages.length > 0) && (messagesQuery.isPending || isRefreshing);

  return (
    <>
      <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0" />

          <MailSidebar
            defaultMailboxId={defaultMailboxId}
            groups={mailboxGroups}
            onComposeNewMail={() => composeDialogRef.current?.openNewMail()}
            onReorderMailboxSwitcher={(order) => {
              updateMailboxSwitcherOrderMutation.mutate(order);
            }}
            onSelectMailbox={selectMailbox}
            onSelectMailboxId={(nextMailboxId) => {
              if (nextMailboxId === selectedMailboxId) return;
              void setMailboxSearch({ mailboxId: nextMailboxId, messageId: null });
            }}
            onSetDefaultMailbox={(nextMailboxId) => {
              void setDefaultMailboxMutation.mutateAsync({ mailboxId: nextMailboxId });
            }}
            selectedMailbox={activeMailbox}
            selectedMailboxId={selectedMailboxId}
            isMobileOpen={isMobileSidebarOpen}
            onMobileOpenChange={setIsMobileSidebarOpen}
          />

          <div className="relative flex min-h-0 flex-1 flex-col bg-background lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-1 lg:py-1 lg:pr-1">
            {selectedMailboxId ? (
              <>
                <section
                  className={cn(
                    "min-h-0 min-w-0 flex-col overflow-hidden bg-background-light lg:flex lg:rounded-lg",
                    {
                      "flex flex-1": !isMessageRouteOpen,
                      hidden: isMessageRouteOpen,
                    },
                  )}
                >
                  <MessageList
                    activeMailbox={activeMailbox}
                    activeMessageId={messageId ?? null}
                    mailboxId={selectedMailboxId}
                    error={messagesQuery.error ?? null}
                    hasNextPage={!!messagesQuery.hasNextPage}
                    isError={messagesQuery.isError}
                    isFetchingNextPage={messagesQuery.isFetchingNextPage}
                    isPending={messagesQuery.isPending}
                    isRefreshing={isRefreshing}
                    mailboxActions={mailboxActions}
                    messages={messages}
                    onActivateMessage={activateMessage}
                    onLoadMore={loadMoreMessages}
                    onOpenDraft={openDraft}
                    onOpenSidebar={() => setIsMobileSidebarOpen(true)}
                    onRefresh={() => {
                      void refreshMessages();
                    }}
                    onSearch={applySearch}
                    onVisibleMessageIdsChange={handleVisibleMessageIdsChange}
                    pendingActions={pendingActions}
                    searchQuery={query.trim()}
                  />
                </section>

                <div
                  className={cn(
                    "min-h-0 min-w-0 flex-col overflow-hidden bg-background-light lg:flex lg:rounded-lg",
                    {
                      "flex flex-1": isMessageRouteOpen,
                      hidden: !isMessageRouteOpen,
                    },
                  )}
                >
                  <MessageDetail
                    activeMailbox={activeMailbox}
                    currentUserEmail={
                      mailboxes.find((mailbox) => mailbox.id === selectedMailboxId)?.emailAddress ??
                      null
                    }
                    mailboxId={selectedMailboxId}
                    mailboxActions={mailboxActions}
                    onComposeDraftRequested={openComposeDraft}
                    pendingActions={pendingActions}
                    isPending={isMessageRouteOpen && isLoadingEmptyMessages}
                    onBackToList={() => {
                      void setMailboxSearch({ messageId: null });
                    }}
                    selectedMessage={selectedMessage}
                  />
                </div>
              </>
            ) : (
              <section className="flex min-h-0 flex-1 items-center justify-center bg-background-light px-8">
                <div className="max-w-md space-y-3 text-center">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">
                    No mailboxes
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Connect Gmail or add a managed mailbox to a team.
                  </p>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
      <ComposeDialog
        key={selectedMailboxId ?? user.id ?? "signed-out"}
        demoMode={isDemoMode}
        mailboxId={selectedMailboxId}
        ref={composeDialogRef}
      />
    </>
  );
};
