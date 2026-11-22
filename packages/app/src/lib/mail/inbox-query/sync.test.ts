import type {
  ListMessagesPageResult,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import {
  disposeMailMutations,
  runMailMutation,
} from "@quieter/app/lib/mail-mutations";
import {
  removeMessagesFromQueryData,
  updateMessageInQueryData,
} from "@quieter/app/lib/mail/inbox-query/data";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/keys";
import {
  applyMailboxSyncDelta,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
  syncMessages,
} from "@quieter/app/lib/mail/inbox-query/sync";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query";
import { rpc } from "@quieter/app/lib/orpc";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the sync contract is needed.
vi.mock("@quieter/app/lib/orpc", () => ({
  rpc: {
    mail: {
      listThreads: vi.fn<typeof rpc.mail.listThreads>(),
      syncMailbox: vi.fn<typeof rpc.mail.syncMailbox>(),
    },
  },
}));

const message = (
  id: string,
  extras: Partial<MessageListItem> = {}
): MessageListItem => ({
  id,
  threadId: `thread-${id}`,
  ...extras,
});

describe(applyMailboxSyncDelta, () => {
  test("retries an interrupted reply hydration before advancing the history cursor", async () => {
    const queryClient = new QueryClient();
    const messagesQueryKey = getMessagesQueryKey("mailbox", "inbox");
    const loaded = message("a", {
      bodyHtml: "<p>Old body</p>",
      threadId: "thread",
    });
    const reply = message("b", { threadId: "thread" });
    queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, {
      pageParams: [undefined],
      pages: [{ historyId: "1", messages: [loaded] }],
    });
    vi.mocked(rpc.mail.syncMailbox).mockResolvedValue({
      hasChanges: true,
      historyId: "2",
      refreshFirstPage: false,
      removedMessageIds: [],
      requiresFullRefresh: false,
      updatedMessages: [reply],
    });
    const hydration = Promise.withResolvers<ThreadMessagesResult>();
    const fetchThread = vi
      .fn<() => Promise<ThreadMessagesResult>>()
      .mockReturnValueOnce(hydration.promise)
      .mockResolvedValue({
        messages: [loaded, { ...reply, bodyHtml: "<p>New reply</p>" }],
        threadId: "thread",
      });
    const thread = new QueryObserver(queryClient, {
      initialData: { messages: [loaded], threadId: "thread" },
      queryFn: fetchThread,
      queryKey: getThreadQueryKey("mailbox", "thread"),
      staleTime: Infinity,
    });
    const unsubscribe = thread.subscribe(() => {});
    const controller = new AbortController();
    const sync = syncMessages(
      queryClient,
      "mailbox",
      "inbox",
      undefined,
      controller.signal
    );
    await vi.waitFor(() => {
      expect(fetchThread).toHaveBeenCalledOnce();
    });
    controller.abort();
    hydration.resolve({ messages: [loaded, reply], threadId: "thread" });
    await expect(sync).rejects.toThrow(/abort/iu);
    expect(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey)?.pages[0]
        .historyId
    ).toBe("1");
    await syncMessages(queryClient, "mailbox", "inbox");
    expect(thread.getCurrentResult().data?.messages.at(-1)?.bodyHtml).toContain(
      "New reply"
    );
    expect(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey)?.pages[0]
        .historyId
    ).toBe("2");
    unsubscribe();
    queryClient.clear();
  });

  test("replaces an older fetch only for the loaded thread that gains a reply", async () => {
    const queryClient = new QueryClient();
    const messagesQueryKey = getMessagesQueryKey("mailbox", "inbox");
    const loaded = message("a", {
      bodyHtml: "<p>Old body</p>",
      threadId: "thread",
    });
    const reply = message("b", { threadId: "thread" });
    queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, {
      pageParams: [undefined],
      pages: [{ messages: [loaded] }],
    });
    const olderRead = Promise.withResolvers<ThreadMessagesResult>();
    const fetchThread = vi
      .fn<() => Promise<ThreadMessagesResult>>()
      .mockReturnValueOnce(olderRead.promise)
      .mockResolvedValue({
        messages: [loaded, { ...reply, bodyHtml: "<p>New reply</p>" }],
        threadId: "thread",
      });
    const fetchOtherThread = vi
      .fn<() => ThreadMessagesResult>()
      .mockReturnValue({ messages: [], threadId: "other" });
    const thread = new QueryObserver(queryClient, {
      initialData: { messages: [loaded], threadId: "thread" },
      queryFn: fetchThread,
      queryKey: getThreadQueryKey("mailbox", "thread"),
      staleTime: Infinity,
    });
    const other = new QueryObserver(queryClient, {
      initialData: { messages: [], threadId: "other" },
      queryFn: fetchOtherThread,
      queryKey: getThreadQueryKey("mailbox", "other"),
      staleTime: Infinity,
    });
    const unsubscribeThread = thread.subscribe(() => {});
    const unsubscribeOther = other.subscribe(() => {});
    const staleRead = thread.refetch();
    await applyMailboxSyncDelta(
      queryClient,
      "mailbox",
      messagesQueryKey,
      [reply],
      []
    );
    olderRead.resolve({ messages: [loaded], threadId: "thread" });
    await staleRead;
    expect(thread.getCurrentResult().data?.messages.at(-1)?.bodyHtml).toContain(
      "New reply"
    );
    expect(fetchOtherThread).not.toHaveBeenCalled();
    unsubscribeThread();
    unsubscribeOther();
    queryClient.clear();
  });

  test("refreshes an open conversation when a new reply is outside the active folder", async () => {
    const queryClient = new QueryClient();
    const messagesQueryKey = getMessagesQueryKey("mailbox", "sent");
    const sent = message("sent", {
      bodyHtml: "<p>Sent</p>",
      threadId: "thread",
    });
    const reply = message("reply", {
      bodyHtml: "<p>Incoming</p>",
      threadId: "thread",
    });
    queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, {
      pageParams: [undefined],
      pages: [{ messages: [sent] }],
    });
    const fetchThread = vi
      .fn<() => ThreadMessagesResult>()
      .mockReturnValue({ messages: [sent, reply], threadId: "thread" });
    const thread = new QueryObserver(queryClient, {
      initialData: { messages: [sent], threadId: "thread" },
      queryFn: fetchThread,
      queryKey: getThreadQueryKey("mailbox", "thread"),
      staleTime: Infinity,
    });
    const unsubscribe = thread.subscribe(() => {});
    await applyMailboxSyncDelta(
      queryClient,
      "mailbox",
      messagesQueryKey,
      [],
      ["reply"],
      undefined,
      ["thread"]
    );
    expect(
      thread.getCurrentResult().data?.messages.map((item) => item.id)
    ).toContain("reply");
    expect(
      queryClient
        .getQueryData<MessagesQueryData>(messagesQueryKey)
        ?.pages[0].messages.map((item) => item.id)
    ).not.toContain("reply");
    unsubscribe();
    queryClient.clear();
  });

  test("keeps loaded thread details when a message leaves the active mailbox view", async () => {
    const queryClient = new QueryClient();
    const messagesQueryKey = getMessagesQueryKey("mailbox-a", "unread");
    const threadQueryKey = getThreadQueryKey("mailbox-a", "thread-a");
    const selectedMessage = message("a", {
      bodyHtml: "<p>Loaded message</p>",
      isUnread: false,
      threadId: "thread-a",
    });

    queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, {
      pageParams: [undefined],
      pages: [{ historyId: "1", messages: [selectedMessage] }],
    });
    queryClient.setQueryData<ThreadMessagesResult>(threadQueryKey, {
      messages: [selectedMessage],
      threadId: "thread-a",
    });

    await applyMailboxSyncDelta(
      queryClient,
      "mailbox-a",
      messagesQueryKey,
      [],
      ["a"]
    );

    expect(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey)?.pages[0]
        .messages
    ).toStrictEqual([]);
    expect(
      queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey)?.messages
    ).toStrictEqual([selectedMessage]);
  });
});

describe(refreshLoadedMessagesPages, () => {
  beforeEach(() => {
    vi.mocked(rpc.mail.listThreads).mockReset();
    vi.mocked(rpc.mail.syncMailbox).mockReset();
  });

  test("publishes a fresh head before a pending continuation, preserves deep details, and resumes a coherent cursor chain", async () => {
    const client = new QueryClient();
    const key = getMessagesQueryKey("mailbox", "inbox");
    const otherKey = getMessagesQueryKey("other", "inbox");
    const deep = message("deep", {
      bodyText: "Loaded detail",
      threadAttachmentNames: ["invoice.pdf"],
      unsubscribeStatus: "requested",
    });
    client.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined, "old-2", "old-3", "old-4"],
      pages: ["a", "b", "c", "deep"].map((id) => ({
        historyId: "old",
        messages: [id === "deep" ? deep : message(id)],
        nextPageToken: `old-after-${id}`,
      })),
    });
    const untouched = {
      pageParams: [undefined],
      pages: [{ messages: [message("other")] }],
    };
    client.setQueryData(otherKey, untouched);
    const second = Promise.withResolvers<ListMessagesPageResult>();
    vi.mocked(rpc.mail.listThreads)
      .mockResolvedValueOnce({
        historyId: "fresh",
        messages: [message("deep")],
        nextPageToken: "fresh-2",
      })
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce({
        messages: [message("c")],
        nextPageToken: "fresh-4",
      });
    const refreshing = refreshLoadedMessagesPages(client, "mailbox", "inbox");
    await vi.waitFor(() => {
      expect(
        client.getQueryData<MessagesQueryData>(key)?.pages[0].messages
      ).toContainEqual(
        expect.objectContaining({
          bodyText: "Loaded detail",
          id: "deep",
          threadAttachmentNames: ["invoice.pdf"],
          unsubscribeStatus: "requested",
        })
      );
      expect(rpc.mail.listThreads).toHaveBeenCalledTimes(2);
    });
    expect(client.getQueryData<MessagesQueryData>(key)?.pages).toHaveLength(3);
    expect(client.getQueryData<MessagesQueryData>(key)?.pages[0]).toMatchObject(
      {
        historyId: "old",
        nextPageToken: "fresh-2",
        refreshing: true,
      }
    );
    expect(
      client
        .getQueryData<MessagesQueryData>(key)
        ?.pages.slice(1)
        .flatMap((page) => page.messages.map((item) => item.id))
    ).toStrictEqual(["b", "c"]);
    second.resolve({ messages: [message("b")], nextPageToken: "fresh-3" });
    await refreshing;
    const refreshed = client.getQueryData<MessagesQueryData>(key);
    expect(
      refreshed?.pages.flatMap((page) => page.messages.map((item) => item.id))
    ).toStrictEqual(["deep", "b", "c"]);
    expect(refreshed?.pageParams).toStrictEqual([
      undefined,
      "fresh-2",
      "fresh-3",
    ]);
    expect(refreshed?.pages[0].historyId).toBe("fresh");
    expect(refreshed?.pages.at(-1)?.nextPageToken).toBe("fresh-4");
    expect(refreshed?.pages[0]?.refreshing).toBeUndefined();
    expect(client.getQueryData(otherKey)).toStrictEqual(untouched);
    client.clear();
  });

  test.each(["failure", "abort"])(
    "keeps the old checkpoint and restores valid continuation after %s",
    async (outcome) => {
      const client = new QueryClient();
      const key = getMessagesQueryKey("mailbox", "inbox");
      client.setQueryData<MessagesQueryData>(key, {
        pageParams: [undefined, "old-2"],
        pages: [
          { historyId: "old", messages: [message("a")] },
          { messages: [message("b")] },
        ],
      });
      const second = Promise.withResolvers<ListMessagesPageResult>();
      const controller = new AbortController();
      vi.mocked(rpc.mail.listThreads)
        .mockResolvedValueOnce({
          historyId: "fresh",
          messages: [message("arrival")],
          nextPageToken: "fresh-2",
        })
        .mockReturnValueOnce(second.promise);
      const refreshing = refreshLoadedMessagesPages(
        client,
        "mailbox",
        "inbox",
        undefined,
        { signal: controller.signal }
      );
      const rejected = Promise.allSettled([refreshing]);
      await vi.waitFor(() => {
        expect(rpc.mail.listThreads).toHaveBeenCalledTimes(2);
      });
      if (outcome === "abort") {
        controller.abort();
        second.resolve({ messages: [message("late")] });
      } else {
        second.reject(new Error("Provider unavailable"));
      }
      await expect(rejected).resolves.toMatchObject([
        {
          reason: { name: outcome === "abort" ? "AbortError" : "Error" },
          status: "rejected",
        },
      ]);
      expect(client.getQueryData<MessagesQueryData>(key)).toMatchObject({
        pages: [
          {
            historyId: "old",
            messages: [{ id: "arrival" }],
            nextPageToken: "fresh-2",
          },
          {
            messages: [{ id: "b" }],
          },
        ],
      });
      expect(
        client.getQueryData<MessagesQueryData>(key)?.pages[0]?.refreshing
      ).toBeUndefined();
      vi.mocked(rpc.mail.listThreads).mockResolvedValueOnce({
        historyId: "retried",
        messages: [message("arrival"), message("late")],
      });
      await refreshLoadedMessagesPages(client, "mailbox", "inbox");
      expect(
        client.getQueryData<MessagesQueryData>(key)?.pages[0].historyId
      ).toBe("retried");
      client.clear();
    }
  );

  test("ignores superseded direct refreshes and stale deltas without requiring caller signals", async () => {
    const client = new QueryClient();
    const key = getMessagesQueryKey("mailbox", "inbox");
    client.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined],
      pages: [{ historyId: "old", messages: [message("old")] }],
    });
    const delta =
      Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.syncMailbox>>>();
    vi.mocked(rpc.mail.syncMailbox).mockReturnValueOnce(delta.promise);
    const staleSynchronization = syncMessages(client, "mailbox", "inbox");
    const syncRejected = Promise.allSettled([staleSynchronization]);
    const oldHead = Promise.withResolvers<ListMessagesPageResult>();
    vi.mocked(rpc.mail.listThreads)
      .mockReturnValueOnce(oldHead.promise)
      .mockResolvedValueOnce({
        historyId: "newest",
        messages: [message("newest")],
      });
    const staleRefresh = refreshLoadedMessagesPages(client, "mailbox", "inbox");
    const refreshRejected = Promise.allSettled([staleRefresh]);
    await vi.waitFor(() => {
      expect(rpc.mail.listThreads).toHaveBeenCalledOnce();
    });
    await refreshLoadedMessagesPages(client, "mailbox", "inbox");
    oldHead.resolve({ historyId: "stale", messages: [message("stale")] });
    delta.resolve({
      hasChanges: true,
      historyId: "stale-delta",
      refreshFirstPage: false,
      removedMessageIds: ["newest"],
      requiresFullRefresh: false,
      updatedMessages: [message("stale-delta")],
    });
    await expect(syncRejected).resolves.toMatchObject([
      { reason: { name: "AbortError" }, status: "rejected" },
    ]);
    await expect(refreshRejected).resolves.toMatchObject([
      { reason: { name: "AbortError" }, status: "rejected" },
    ]);
    expect(client.getQueryData<MessagesQueryData>(key)?.pages[0]).toMatchObject(
      { historyId: "newest", messages: [{ id: "newest" }] }
    );
    client.clear();
  });

  test("a newer refresh replaces a provisional prefix without the older continuation restoring stale cursors", async () => {
    const client = new QueryClient();
    const key = getMessagesQueryKey("mailbox", "inbox");
    client.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined, "old-2"],
      pages: [
        { historyId: "old", messages: [message("a")] },
        { messages: [message("b")] },
      ],
    });
    const continuation = Promise.withResolvers<ListMessagesPageResult>();
    vi.mocked(rpc.mail.listThreads)
      .mockResolvedValueOnce({
        historyId: "intermediate",
        messages: [message("intermediate")],
        nextPageToken: "intermediate-2",
      })
      .mockReturnValueOnce(continuation.promise)
      .mockResolvedValueOnce({
        historyId: "newest",
        messages: [message("newest")],
      });
    const older = refreshLoadedMessagesPages(client, "mailbox", "inbox");
    const olderOutcome = Promise.allSettled([older]);
    await vi.waitFor(() => {
      expect(
        client.getQueryData<MessagesQueryData>(key)?.pages[0]?.refreshing
      ).toBeTruthy();
    });
    expect(
      client.getQueryData<MessagesQueryData>(key)?.pages.at(-1)?.nextPageToken
    ).toBeUndefined();
    await refreshLoadedMessagesPages(client, "mailbox", "inbox");
    continuation.resolve({
      messages: [message("stale")],
      nextPageToken: "stale-3",
    });
    await expect(olderOutcome).resolves.toMatchObject([
      { reason: { name: "AbortError" }, status: "rejected" },
    ]);
    expect(client.getQueryData<MessagesQueryData>(key)).toMatchObject({
      pages: [
        {
          historyId: "newest",
          messages: [{ id: "newest" }],
        },
      ],
    });
    expect(
      client.getQueryData<MessagesQueryData>(key)?.pages[0]?.refreshing
    ).toBeUndefined();
    client.clear();
  });

  test("a delta head repair keeps the loaded tail behind its covered checkpoint", async () => {
    const client = new QueryClient();
    const key = getMessagesQueryKey("mailbox", "inbox");
    client.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined, "old-2"],
      pages: [
        { historyId: "old", messages: [message("a")] },
        { messages: [message("b")] },
      ],
    });
    vi.mocked(rpc.mail.syncMailbox).mockResolvedValueOnce({
      hasChanges: true,
      historyId: "covered",
      refreshFirstPage: true,
      removedMessageIds: [],
      requiresFullRefresh: false,
      updatedMessages: [],
    });
    vi.mocked(rpc.mail.listThreads).mockResolvedValueOnce({
      historyId: "list-checkpoint",
      messages: [message("fresh")],
      nextPageToken: "fresh-2",
    });
    await syncMessages(client, "mailbox", "inbox");
    expect(client.getQueryData<MessagesQueryData>(key)?.pages).toHaveLength(2);
    expect(client.getQueryData<MessagesQueryData>(key)?.pages[0]).toMatchObject(
      {
        historyId: "covered",
        messages: [{ id: "fresh" }],
        nextPageToken: "fresh-2",
      }
    );
    expect(
      client.getQueryData<MessagesQueryData>(key)?.pages[1]?.messages
    ).toStrictEqual([expect.objectContaining({ id: "b" })]);
    client.clear();
  });

  test("does not recreate cleared session queries from late provider results", async () => {
    const client = new QueryClient();
    const response = Promise.withResolvers<ListMessagesPageResult>();
    vi.mocked(rpc.mail.listThreads).mockReturnValueOnce(response.promise);
    const refresh = refreshLoadedMessagesPages(client, "mailbox", "inbox");
    const rejected = Promise.allSettled([refresh]);
    await vi.waitFor(() => {
      expect(rpc.mail.listThreads).toHaveBeenCalledOnce();
    });
    client.clear();
    response.resolve({ messages: [message("private")] });
    await expect(rejected).resolves.toMatchObject([
      { reason: { name: "AbortError" }, status: "rejected" },
    ]);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  test("keeps loading the next page when background synchronization finds no changes", async () => {
    const client = new QueryClient();
    const key = getMessagesQueryKey("mailbox", "inbox");
    client.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined],
      pages: [
        {
          historyId: "current",
          messages: [message("head")],
          nextPageToken: "tail",
        },
      ],
    });
    const tail = Promise.withResolvers<ListMessagesPageResult>();
    vi.mocked(rpc.mail.listThreads).mockReturnValueOnce(tail.promise);
    vi.mocked(rpc.mail.syncMailbox).mockResolvedValueOnce({
      hasChanges: false,
      historyId: "current",
      refreshFirstPage: false,
      removedMessageIds: [],
      requiresFullRefresh: false,
      updatedMessages: [],
    });
    const observer = new InfiniteQueryObserver(
      client,
      messagesQueryOptions("mailbox", "inbox")
    );
    const unsubscribe = observer.subscribe(() => {});
    const paging = observer.fetchNextPage();
    await vi.waitFor(() => {
      expect(rpc.mail.listThreads).toHaveBeenCalledOnce();
    });
    await syncMessages(client, "mailbox", "inbox");
    tail.resolve({ messages: [message("next")] });
    await paging;
    const messages = observer
      .getCurrentResult()
      .data?.pages.flatMap((page) => page.messages.map((item) => item.id));
    expect(messages).toContain("head");
    expect(messages).toContain("next");
    expect(observer.getCurrentResult().isFetchingNextPage).toBeFalsy();
    unsubscribe();
    client.clear();
  });

  test("cancels pending pagination from the old chain before publishing fresh pages", async () => {
    const client = new QueryClient();
    const key = getMessagesQueryKey("mailbox", "inbox");
    client.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined],
      pages: [{ messages: [message("old")], nextPageToken: "old-2" }],
    });
    const oldTail = Promise.withResolvers<ListMessagesPageResult>();
    vi.mocked(rpc.mail.listThreads)
      .mockReturnValueOnce(oldTail.promise)
      .mockResolvedValueOnce({
        historyId: "fresh",
        messages: [message("fresh")],
        nextPageToken: "fresh-2",
      });
    const observer = new InfiniteQueryObserver(
      client,
      messagesQueryOptions("mailbox", "inbox")
    );
    const unsubscribe = observer.subscribe(() => {});
    const paging = observer.fetchNextPage();
    await vi.waitFor(() => {
      expect(rpc.mail.listThreads).toHaveBeenCalledOnce();
    });
    await refreshLoadedMessagesPages(client, "mailbox", "inbox");
    oldTail.resolve({ messages: [message("stale-tail")] });
    await paging;
    expect(
      observer
        .getCurrentResult()
        .data?.pages.flatMap((page) => page.messages.map((item) => item.id))
    ).toStrictEqual(["fresh"]);
    expect(observer.getCurrentResult().data?.pages.at(-1)?.nextPageToken).toBe(
      "fresh-2"
    );
    unsubscribe();
    client.clear();
  });

  test("keeps pending read and archive intents through prefix publications and restores failed archive", async () => {
    const client = new QueryClient();
    const key = getMessagesQueryKey("mailbox", "inbox");
    client.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined, "old-2"],
      pages: [
        {
          historyId: "old",
          messages: [message("read", { isUnread: true }), message("archive")],
        },
        { messages: [message("tail")] },
      ],
    });
    const settle = Promise.withResolvers<() => void>();
    const mutation = runMailMutation(client, {
      apply: () => {
        client.setQueryData<MessagesQueryData>(key, (data) =>
          removeMessagesFromQueryData(
            updateMessageInQueryData(data, "read", (item) => ({
              ...item,
              isUnread: false,
            })),
            (item) => item.id === "archive"
          )
        );
      },
      execute: async () => await settle.promise,
      mailboxId: "mailbox",
      targets: ["read", "archive"],
    });
    const failed = mutation.catch(() => {});
    const second = Promise.withResolvers<ListMessagesPageResult>();
    vi.mocked(rpc.mail.listThreads)
      .mockResolvedValueOnce({
        historyId: "fresh",
        messages: [message("read", { isUnread: true }), message("archive")],
        nextPageToken: "fresh-2",
      })
      .mockReturnValueOnce(second.promise);
    const refresh = refreshLoadedMessagesPages(client, "mailbox", "inbox");
    await vi.waitFor(() => {
      expect(rpc.mail.listThreads).toHaveBeenCalledTimes(2);
    });
    expect(
      client.getQueryData<MessagesQueryData>(key)?.pages[0].messages
    ).toStrictEqual([expect.objectContaining({ id: "read", isUnread: false })]);
    second.resolve({ messages: [message("tail")] });
    await refresh;
    expect(
      client.getQueryData<MessagesQueryData>(key)?.pages[0].messages
    ).toStrictEqual([expect.objectContaining({ id: "read", isUnread: false })]);
    settle.reject(new Error("Mutation failed"));
    await failed;
    expect(
      client.getQueryData<MessagesQueryData>(key)?.pages[0].messages
    ).toContainEqual(expect.objectContaining({ id: "archive" }));
    disposeMailMutations(client);
    client.clear();
  });
});
