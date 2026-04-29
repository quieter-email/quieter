"use client";

import { isPersonalWorkspaceId, toWorkspaceId } from "@quieter/auth/workspace";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MailboxSearch } from "~/routes/index";
import { LoadingPage } from "~/components/loading-page";
import { type ComposeDraftState, buildComposeDraftFromSavedDraftMessage } from "~/features/compose";
import { type ComposeDialogHandle, ComposeDialog } from "~/features/compose";
import { MessageList } from "~/features/message-list/components/message-list";
import { MessageDetail } from "~/features/message-thread/components/message-detail";
import { MailSidebar } from "~/features/navigation/components/mail-sidebar";
import { authClient } from "~/lib/auth";
import { type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
  syncMessages,
} from "~/lib/gmail/inbox-query";
import { getThreadQueryKey, getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { inboxRouteApi } from "~/lib/route-apis";
import { createMailboxActionHandlers, type MailboxPendingActions } from "./mailbox-action-handlers";

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

const BACKGROUND_THREAD_BODY_PREFETCH_LIMIT = 8;
const BACKGROUND_THREAD_BODY_PREFETCH_TIMEOUT_MS = 3000;
const BACKGROUND_THREAD_BODY_PREFETCH_FALLBACK_DELAY_MS = 600;

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

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const navigate = useNavigate({
    from: "/",
  });
  const queryClient = useQueryClient();
  const activeOrganizationState = authClient.useActiveOrganization();
  const composeDialogRef = useRef<ComposeDialogHandle | null>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isWindowActive, setIsWindowActive] = useState(false);
  const [pendingMessageActionIds, setPendingMessageActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingThreadActionIds, setPendingThreadActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pendingMessageActionIdsRef = useRef(pendingMessageActionIds);
  const pendingThreadActionIdsRef = useRef(pendingThreadActionIds);
  const { mailbox: activeMailbox, mailboxId, messageId, query } = inboxRouteApi.useSearch();
  const workspaceId = toWorkspaceId(activeOrganizationState.data?.id);
  const workspaceName = activeOrganizationState.data?.name ?? "Personal";
  const isPersonalWorkspace = isPersonalWorkspaceId(workspaceId);

  pendingMessageActionIdsRef.current = pendingMessageActionIds;
  pendingThreadActionIdsRef.current = pendingThreadActionIds;
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
    messagesQueryOptions(selectedMailboxId ?? "", activeMailbox, query.trim(), !!selectedMailboxId),
  );
  const hasLoadedMessages = !!messagesQuery.data?.pages.length;
  const isLiveSyncEnabled =
    !!selectedMailboxId &&
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
  const flattenedMessages = useMemo(
    () => messagesQuery.data?.pages.flatMap((page) => page.messages) ?? [],
    [messagesQuery.data],
  );
  const backgroundThreadIds = useMemo(() => {
    const threadIds: string[] = [];
    const seenThreadIds = new Set<string>();

    for (const message of flattenedMessages) {
      if (seenThreadIds.has(message.threadId)) continue;
      seenThreadIds.add(message.threadId);
      threadIds.push(message.threadId);
      if (threadIds.length >= BACKGROUND_THREAD_BODY_PREFETCH_LIMIT) break;
    }

    return threadIds;
  }, [flattenedMessages]);

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

  let selectedMessage: MessageListItem | null = null;
  if (activeMailbox !== "drafts" && messageId) {
    for (const message of flattenedMessages) {
      if (message.id === messageId) {
        selectedMessage = message;
        break;
      }
    }
  }

  const setMailboxSearch = (patch: MailboxSearchPatch) => {
    return navigate({
      replace: true,
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
      !messageId ||
      messagesQuery.isPending ||
      !messagesQuery.data?.pages.length ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxSearch({ messageId: null });
  }, [messageId, messagesQuery.data, messagesQuery.isPending, selectedMessage]);

  useEffect(() => {
    if (
      !selectedMailboxId ||
      activeMailbox === "drafts" ||
      query.trim().length > 0 ||
      !isWindowActive ||
      isManualRefreshing ||
      messagesQuery.isFetching ||
      syncQuery.isFetching ||
      backgroundThreadIds.length === 0
    ) {
      return;
    }

    let cancelled = false;
    let idleCallbackId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let nextThreadIndex = 0;

    function cancelScheduledPrefetch() {
      if (idleCallbackId != null) {
        window.cancelIdleCallback(idleCallbackId);
        idleCallbackId = null;
      }

      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function prefetchNextThreads(deadline?: IdleDeadline) {
      idleCallbackId = null;
      timeoutId = null;

      if (cancelled) return;

      while (
        nextThreadIndex < backgroundThreadIds.length &&
        (deadline == null || deadline.didTimeout || deadline.timeRemaining() > 8)
      ) {
        const threadId = backgroundThreadIds[nextThreadIndex];
        nextThreadIndex += 1;

        if (!threadId || threadId === selectedMessage?.threadId) {
          continue;
        }

        const threadQueryKey = getThreadQueryKey(selectedMailboxId, threadId);
        if (queryClient.isFetching({ queryKey: threadQueryKey }) > 0) {
          continue;
        }

        void queryClient
          .prefetchQuery(getThreadWithDetailsOptions(selectedMailboxId, activeMailbox, threadId))
          .finally(() => {
            if (!cancelled && nextThreadIndex < backgroundThreadIds.length) {
              scheduleNextPrefetch();
            }
          });
        return;
      }

      if (nextThreadIndex < backgroundThreadIds.length) {
        scheduleNextPrefetch();
      }
    }

    function scheduleNextPrefetch() {
      cancelScheduledPrefetch();

      if ("requestIdleCallback" in window) {
        idleCallbackId = window.requestIdleCallback(prefetchNextThreads, {
          timeout: BACKGROUND_THREAD_BODY_PREFETCH_TIMEOUT_MS,
        });
        return;
      }

      timeoutId = setTimeout(
        () => prefetchNextThreads(),
        BACKGROUND_THREAD_BODY_PREFETCH_FALLBACK_DELAY_MS,
      );
    }

    scheduleNextPrefetch();

    return () => {
      cancelled = true;
      cancelScheduledPrefetch();
    };
  }, [
    activeMailbox,
    query,
    backgroundThreadIds,
    isManualRefreshing,
    isWindowActive,
    messagesQuery.isFetching,
    queryClient,
    selectedMailboxId,
    selectedMessage?.threadId,
    syncQuery.isFetching,
  ]);

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

  const mailboxActions = createMailboxActionHandlers({
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

  if (mailboxesQuery.isPending) {
    return (
      <>
        <LoadingPage />
        <ComposeDialog
          key={selectedMailboxId ?? `${workspaceId}:${user.id ?? "signed-out"}`}
          mailboxId={selectedMailboxId}
          ref={composeDialogRef}
        />
      </>
    );
  }

  const messages = messagesQuery.data?.pages ?? [];
  const isLoadingEmptyMessages =
    !messages.some((page) => page.messages.length > 0) && (messagesQuery.isPending || isRefreshing);

  return (
    <>
      <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0" />

          <MailSidebar
            defaultMailboxId={defaultMailboxId}
            mailboxes={mailboxes}
            onComposeNewMail={() => composeDialogRef.current?.openNewMail()}
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
            workspaceName={workspaceName}
          />

          <div className="relative flex min-h-0 flex-1 flex-col gap-1 bg-background py-1 pr-1 lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
            {selectedMailboxId ? (
              <>
                <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-background-light">
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
                    onRefresh={() => {
                      void refreshMessages();
                    }}
                    onSearch={applySearch}
                    pendingActions={pendingActions}
                    searchQuery={query.trim()}
                  />
                </section>

                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-background-light">
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
                    isPending={isLoadingEmptyMessages}
                    selectedMessage={selectedMessage}
                  />
                </div>
              </>
            ) : (
              <section className="flex min-h-0 flex-1 items-center justify-center bg-background-light px-8">
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
      <ComposeDialog
        key={selectedMailboxId ?? `${workspaceId}:${user.id ?? "signed-out"}`}
        mailboxId={selectedMailboxId}
        ref={composeDialogRef}
      />
    </>
  );
};
