import { createAsync, query, redirect, useSearchParams } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal } from "solid-js";
import { MailSidebar } from "~/components/mail-sidebar";
import { MessageDetail } from "~/components/message-detail";
import { MessageList } from "~/components/message-list";
import { getGoogleRelinkUrl, getGoogleScopeStatus, getSession } from "~/lib/auth";
import { isMessageUnread, type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  markMessageAsReadInMailbox,
  markMessageAsUnreadInMailbox,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
} from "~/lib/gmail/inbox-query";

const MAILBOXES: readonly MailboxCategory[] = ["inbox", "sent", "trash"];

const parseMailboxCategory = (value: string | undefined): MailboxCategory => {
  if (!value) return "inbox";

  return MAILBOXES.find((mailbox) => mailbox === value) ?? "inbox";
};

const ensureInboxAccess = query(async () => {
  "use server";

  const session = await getSession();
  if (!session?.user) return redirect("/home");

  const googleScopeStatus = await getGoogleScopeStatus();
  if (!googleScopeStatus.hasRequiredScopes) {
    const relinkUrl = await getGoogleRelinkUrl("/");
    if (relinkUrl) return redirect(relinkUrl);
  }
}, "ensureInboxAccess");

export default clientOnly(async () => ({ default: HomePage }), { lazy: true });

function HomePage() {
  createAsync(() => ensureInboxAccess());
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams<{
    messageId?: string;
    mailbox?: MailboxCategory;
  }>();
  const [isManualRefreshing, setIsManualRefreshing] = createSignal(false);
  const [pendingReadStateMessageIds, setPendingReadStateMessageIds] = createSignal<
    ReadonlySet<string>
  >(new Set());

  const isReadStatePending = (messageId: string | null | undefined): boolean => {
    if (!messageId) return false;
    return pendingReadStateMessageIds().has(messageId);
  };

  const setReadStatePending = (messageId: string, pending: boolean) => {
    setPendingReadStateMessageIds((current) => {
      const next = new Set(current);

      if (pending) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }

      return next;
    });
  };

  const activeMailbox = createMemo<MailboxCategory>(() => {
    return parseMailboxCategory(searchParams.mailbox);
  });

  const activeMessageId = createMemo(() => {
    if (!searchParams.messageId || typeof searchParams.messageId !== "string") return null;
    const normalized = searchParams.messageId.trim();
    return normalized.length > 0 ? normalized : null;
  });

  const messagesQuery = useInfiniteQuery(() => messagesQueryOptions(queryClient, activeMailbox()));

  const syncQuery = useQuery(() =>
    liveSyncQueryOptions(queryClient, activeMailbox(), !isManualRefreshing()),
  );

  const refreshMessages = async () => {
    const liveSyncQueryKey = getLiveSyncQueryKey(activeMailbox());
    const messagesQueryKey = getMessagesQueryKey(activeMailbox());

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setIsManualRefreshing(true);

    try {
      await refreshLoadedMessagesPages(queryClient, activeMailbox());
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const selectedMessage = createMemo<MessageListItem | null>(() => {
    const messageId = activeMessageId();
    if (!messageId) return null;

    if (!messagesQuery.data || !messagesQuery.data.pages) return null;

    for (const page of messagesQuery.data.pages)
      for (const message of page.messages) if (message.id === messageId) return message;

    return null;
  });

  createEffect(() => {
    const messageId = activeMessageId();
    if (!messageId) return;
    if (messagesQuery.isPending) return;
    if (!messagesQuery.data?.pages.length) return;
    if (selectedMessage()) return;

    setSearchParams({ messageId: undefined }, { replace: true, scroll: false });
  });

  const activateMessage = (messageId: string) => {
    if (activeMessageId() === messageId) return;
    setSearchParams({ messageId }, { replace: true, scroll: false });
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

  const markMessageAsRead = async (messageId: string) => {
    if (isReadStatePending(messageId)) return;

    setReadStatePending(messageId, true);
    try {
      await markMessageAsReadInMailbox(queryClient, activeMailbox(), messageId);
    } finally {
      setReadStatePending(messageId, false);
    }
  };

  const markMessageAsUnread = async (messageId: string) => {
    if (isReadStatePending(messageId)) return;

    setReadStatePending(messageId, true);
    try {
      await markMessageAsUnreadInMailbox(queryClient, activeMailbox(), messageId);
    } finally {
      setReadStatePending(messageId, false);
    }
  };

  createEffect((previousMessageId: string | null) => {
    const message = selectedMessage();
    const currentMessageId = message?.id ?? null;
    if (!currentMessageId) return currentMessageId;
    if (!message) return currentMessageId;

    const hasReadState = message.isUnread != null || message.labelIds != null;
    if (!hasReadState) {
      return previousMessageId;
    }

    if (currentMessageId !== previousMessageId && isMessageUnread(message)) {
      void markMessageAsRead(currentMessageId);
    }

    return currentMessageId;
  }, null);

  const selectMailbox = (mailbox: MailboxCategory) => {
    if (mailbox === activeMailbox()) return;
    setSearchParams({ mailbox, messageId: undefined }, { replace: true, scroll: false });
  };

  return (
    <main class="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground lg:flex-row">
      <MailSidebar selectedMailbox={activeMailbox()} onSelectMailbox={selectMailbox} />

      <div class="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,38%)_minmax(0,62%)] lg:grid-rows-[minmax(0,1fr)]">
        <section class="flex min-h-0 min-w-0 flex-col border-b border-border bg-background-light lg:border-r lg:border-b-0">
          <MessageList
            activeMessageId={activeMessageId()}
            onActivateMessage={activateMessage}
            onMarkAsRead={(messageId) => {
              void markMessageAsRead(messageId);
            }}
            onMarkAsUnread={(messageId) => {
              void markMessageAsUnread(messageId);
            }}
            isReadStatePending={isReadStatePending}
            onRefresh={() => void refreshMessages()}
            isRefreshing={
              isManualRefreshing() ||
              syncQuery.isFetching ||
              (messagesQuery.isRefetching && !messagesQuery.isFetchingNextPage)
            }
            isPending={messagesQuery.isPending}
            isError={messagesQuery.isError}
            error={messagesQuery.error ?? null}
            messages={messagesQuery.data?.pages ?? []}
            hasNextPage={Boolean(messagesQuery.hasNextPage)}
            isFetchingNextPage={messagesQuery.isFetchingNextPage}
            onLoadMore={loadMoreMessages}
          />
        </section>

        <div class="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <MessageDetail
            selectedMessage={selectedMessage()}
            onMarkAsRead={(messageId) => {
              void markMessageAsRead(messageId);
            }}
            onMarkAsUnread={(messageId) => {
              void markMessageAsUnread(messageId);
            }}
            isReadStatePending={isReadStatePending(selectedMessage()?.id)}
          />
        </div>
      </div>
    </main>
  );
}
