import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vite-plus/test";

import type { MessageListItem, ThreadMessagesResult } from "#/lib/mail";
import { rpc } from "#/lib/orpc";

import { getThreadQueryKey } from "../thread-query";
import type { MessagesQueryData } from "./data";
import { getMessagesQueryKey } from "./keys";
import { applyMailboxSyncDelta, syncMessages } from "./sync";

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the sync contract is needed.
vi.mock("#/lib/orpc", () => ({
  rpc: {
    mail: {
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

  test("patches loaded metadata without fetching message lists or thread bodies", async () => {
    const queryClient = new QueryClient();
    const messagesQueryKey = getMessagesQueryKey("mailbox", "inbox");
    const threadQueryKey = getThreadQueryKey("mailbox", "thread");
    const loaded = message("a", {
      bodyHtml: "<p>Loaded body</p>",
      isUnread: true,
      threadId: "thread",
    });
    const listData = {
      pageParams: [undefined],
      pages: [{ messages: [loaded] }],
    };
    const threadData = { messages: [loaded], threadId: "thread" };
    const fetchList = vi
      .fn<() => MessagesQueryData>()
      .mockReturnValue(listData);
    const fetchThread = vi
      .fn<() => ThreadMessagesResult>()
      .mockReturnValue(threadData);
    const list = new QueryObserver(queryClient, {
      initialData: listData,
      queryFn: fetchList,
      queryKey: messagesQueryKey,
      staleTime: Infinity,
    });
    const thread = new QueryObserver(queryClient, {
      initialData: threadData,
      queryFn: fetchThread,
      queryKey: threadQueryKey,
      staleTime: Infinity,
    });
    const unsubscribeList = list.subscribe(() => {});
    const unsubscribeThread = thread.subscribe(() => {});
    await applyMailboxSyncDelta(
      queryClient,
      "mailbox",
      messagesQueryKey,
      [message("a", { isUnread: false, threadId: "thread" })],
      []
    );
    expect(thread.getCurrentResult().data?.messages[0]).toMatchObject({
      bodyHtml: loaded.bodyHtml,
      isUnread: false,
    });
    expect(
      list.getCurrentResult().data?.pages[0].messages[0].isUnread
    ).toBeFalsy();
    expect(fetchList).not.toHaveBeenCalled();
    expect(fetchThread).not.toHaveBeenCalled();
    unsubscribeList();
    unsubscribeThread();
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
