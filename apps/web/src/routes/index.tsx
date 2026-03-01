import { createAsync, query, redirect, useSearchParams } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
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

const parsePageToken = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const fetchMessagesPage = async (
  pageToken: string | undefined,
  signal?: AbortSignal,
): Promise<ListMessagesPageResult> =>
  await listMessagesWithDetails({
    pageToken,
    maxResults: pageToken ? 25 : 100,
    signal,
  });

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

  const [searchParams, setSearchParams] = useSearchParams<{
    messageId?: string;
  }>();

  const activeMessageId = createMemo(() => {
    if (!searchParams.messageId || typeof searchParams.messageId !== "string") return null;
    const normalized = searchParams.messageId.trim();
    return normalized.length > 0 ? normalized : null;
  });

  const messagesQuery = useInfiniteQuery(() => ({
    queryKey: ["messages"],
    queryFn: (ctx: { pageParam: unknown; signal: AbortSignal }) =>
      fetchMessagesPage(parsePageToken(ctx.pageParam), ctx.signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ListMessagesPageResult) => lastPage.nextPageToken ?? undefined,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }));

  const selectedMessage = createMemo<MessageListItem | null>(() => {
    const messageId = activeMessageId();
    if (!messageId) return null;

    if (!messagesQuery.data || !messagesQuery.data.pages) return null;

    for (const page of messagesQuery.data.pages)
      for (const message of page.messages) if (message.id === messageId) return message;

    return null;
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
