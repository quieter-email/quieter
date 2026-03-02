import { createAsync, query, redirect, useSearchParams } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo } from "solid-js";
import { MailSidebar } from "~/components/mail-sidebar";
import { MessageDetail } from "~/components/message-detail";
import { MessageList } from "~/components/message-list";
import { getGoogleRelinkUrl, getGoogleScopeStatus, getSession } from "~/lib/auth";
import {
  GMAIL_QUERY_STALE_TIME_MS,
  listMessagesWithDetails,
  type ListMessagesPageResult,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import { trpc } from "~/lib/trpc";

const MESSAGES_QUERY_KEY = ["messages"] as const;
const LIVE_SYNC_QUERY_KEY = [...MESSAGES_QUERY_KEY, "live-sync"] as const;

type MessagesQueryData = {
  pages: ListMessagesPageResult[];
  pageParams: Array<string | undefined>;
};

const parsePageToken = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const loadPersistedMessages = async (
  messageIds: string[],
  signal?: AbortSignal,
): Promise<MessageListItem[]> => {
  if (messageIds.length === 0) return [];

  const messages = await trpc.gmail.getCachedMessages.query({ messageIds }, { signal });

  return messages;
};

const persistFetchedMessages = async (messages: MessageListItem[], signal?: AbortSignal) => {
  if (messages.length === 0) return;

  await trpc.gmail.upsertCachedMessages.mutate({ messages }, { signal });
};

const fetchMessagesPage = async (
  pageToken: string | undefined,
  cachedMessagesById: ReadonlyMap<string, MessageListItem>,
  signal?: AbortSignal,
): Promise<ListMessagesPageResult> =>
  await listMessagesWithDetails({
    pageToken,
    maxResults: pageToken ? 25 : 50,
    cachedMessagesById,
    loadCachedMessages: loadPersistedMessages,
    persistFetchedMessages,
    signal,
  });

const toCachedMessagesById = (
  data: MessagesQueryData | undefined,
): Map<string, MessageListItem> => {
  const cache = new Map<string, MessageListItem>();
  if (!data) return cache;

  for (const page of data.pages) {
    for (const message of page.messages) {
      cache.set(message.id, message);
    }
  }

  return cache;
};

const dedupePagesByMessageId = (pages: ListMessagesPageResult[]) => {
  const seenMessageIds = new Set<string>();

  return pages.map((page) => ({
    ...page,
    messages: page.messages.filter((message) => {
      if (seenMessageIds.has(message.id)) return false;
      seenMessageIds.add(message.id);
      return true;
    }),
  }));
};

const mergeRefreshedPages = (
  current: MessagesQueryData | undefined,
  refreshedPages: ListMessagesPageResult[],
): MessagesQueryData => {
  if (!current || current.pages.length === 0) {
    const firstPage = refreshedPages[0];
    return {
      pages: firstPage ? [firstPage] : [],
      pageParams: [undefined],
    };
  }

  const refreshedMessageIds = new Set(
    refreshedPages.flatMap((page) => page.messages.map((message) => message.id)),
  );

  const mergedPages = current.pages.map((page, index) => {
    const refreshedPage = refreshedPages[index];
    if (refreshedPage) return refreshedPage;

    return {
      ...page,
      messages: page.messages.filter((message) => !refreshedMessageIds.has(message.id)),
    };
  });

  return {
    pages: dedupePagesByMessageId(mergedPages),
    pageParams: [undefined, ...current.pageParams.slice(1)],
  };
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
  let syncAttemptCount = 0;

  const [searchParams, setSearchParams] = useSearchParams<{
    messageId?: string;
  }>();

  const activeMessageId = createMemo(() => {
    if (!searchParams.messageId || typeof searchParams.messageId !== "string") return null;
    const normalized = searchParams.messageId.trim();
    return normalized.length > 0 ? normalized : null;
  });

  const messagesQuery = useInfiniteQuery(() => ({
    queryKey: MESSAGES_QUERY_KEY,
    queryFn: (ctx: { pageParam: unknown; signal: AbortSignal }) => {
      const cachedMessages = toCachedMessagesById(
        queryClient.getQueryData<MessagesQueryData>(MESSAGES_QUERY_KEY),
      );

      return fetchMessagesPage(parsePageToken(ctx.pageParam), cachedMessages, ctx.signal);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ListMessagesPageResult) => lastPage.nextPageToken ?? undefined,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }));

  const syncQuery = useQuery(() => ({
    queryKey: LIVE_SYNC_QUERY_KEY,
    queryFn: async ({ signal }) => {
      syncAttemptCount += 1;
      const currentMessages = queryClient.getQueryData<MessagesQueryData>(MESSAGES_QUERY_KEY);
      const cachedMessages = toCachedMessagesById(currentMessages);

      const refreshedPages: ListMessagesPageResult[] = [
        await fetchMessagesPage(undefined, cachedMessages, signal),
      ];

      const shouldDeepReconcile =
        syncAttemptCount % 20 === 0 && (currentMessages?.pages.length ?? 0) > 1;

      if (shouldDeepReconcile) {
        let pageToken = refreshedPages[0]?.nextPageToken;
        const maxPagesToRefresh = Math.min(2, currentMessages?.pages.length ?? 1);

        for (let pageIndex = 1; pageIndex < maxPagesToRefresh && pageToken; pageIndex += 1) {
          const nextPage = await fetchMessagesPage(pageToken, cachedMessages, signal);
          refreshedPages.push(nextPage);
          pageToken = nextPage.nextPageToken;
        }
      }

      queryClient.setQueryData<MessagesQueryData>(MESSAGES_QUERY_KEY, (current) =>
        mergeRefreshedPages(current, refreshedPages),
      );

      return refreshedPages[0];
    },
    enabled: !messagesQuery.isPending && !messagesQuery.isError,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
  }));

  const refreshMessages = async () => {
    await queryClient.cancelQueries({ queryKey: LIVE_SYNC_QUERY_KEY });

    if (!messagesQuery.data?.pages.length) {
      await messagesQuery.refetch();
      return;
    }

    await syncQuery.refetch();
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

  return (
    <main class="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground lg:flex-row">
      <MailSidebar />

      <div class="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,38%)_minmax(0,62%)] lg:grid-rows-[minmax(0,1fr)]">
        <section class="flex min-h-0 min-w-0 flex-col border-b border-border bg-background-light lg:border-r lg:border-b-0">
          <MessageList
            onActivateMessage={activateMessage}
            onRefresh={() => void refreshMessages()}
            isRefreshing={
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
          <MessageDetail selectedMessage={selectedMessage()} />
        </div>
      </div>
    </main>
  );
}
