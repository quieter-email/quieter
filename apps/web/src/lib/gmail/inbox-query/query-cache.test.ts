import { QueryClient } from "@tanstack/react-query";
import { describe, expect, spyOn, test } from "bun:test";
import type { MessageListItem, ThreadMessagesResult } from "../gmail";
import type { MessagesQueryData } from "./data";
import { queryPersister } from "../../query-persister";
import { getThreadQueryKey } from "../thread-query";
import { getMessagesQueryKey } from "./keys";
import { applyVisibleMailboxMessagesRefreshToCache, persistQueryKeys } from "./query-cache";

const message = (id: string, extras: Partial<MessageListItem> = {}): MessageListItem => ({
  id,
  threadId: `thread-${id}`,
  ...extras,
});

const messagesData = (messages: MessageListItem[]): MessagesQueryData => ({
  pages: [{ messages }],
  pageParams: [undefined],
});

describe("applyVisibleMailboxMessagesRefreshToCache", () => {
  test("removes viewed messages that left the active mailbox", async () => {
    const queryClient = new QueryClient();
    const inboxQueryKey = getMessagesQueryKey("mailbox-a", "inbox", undefined);
    queryClient.setQueryData(inboxQueryKey, messagesData([message("a", { labelIds: ["INBOX"] })]));

    await applyVisibleMailboxMessagesRefreshToCache(
      queryClient,
      { mailboxId: "mailbox-a", mailbox: "inbox" },
      { removedMessageIds: ["a"], updatedMessages: [] },
    );

    expect(queryClient.getQueryData<MessagesQueryData>(inboxQueryKey)?.pages[0].messages).toEqual(
      [],
    );
  });

  test("updates visible message metadata in place", async () => {
    const queryClient = new QueryClient();
    const inboxQueryKey = getMessagesQueryKey("mailbox-a", "inbox", undefined);
    queryClient.setQueryData(
      inboxQueryKey,
      messagesData([message("a", { isUnread: false, labelIds: ["INBOX"] })]),
    );

    await applyVisibleMailboxMessagesRefreshToCache(
      queryClient,
      { mailboxId: "mailbox-a", mailbox: "inbox" },
      {
        removedMessageIds: [],
        updatedMessages: [message("a", { isUnread: true, labelIds: ["INBOX", "UNREAD"] })],
      },
    );

    expect(
      queryClient.getQueryData<MessagesQueryData>(inboxQueryKey)?.pages[0].messages[0],
    ).toMatchObject({
      id: "a",
      isUnread: true,
      labelIds: ["INBOX", "UNREAD"],
    });
  });

  test("preserves loaded details when refreshing cached message metadata", async () => {
    const queryClient = new QueryClient();
    const inboxQueryKey = getMessagesQueryKey("mailbox-a", "inbox", undefined);
    const threadQueryKey = getThreadQueryKey("mailbox-a", "thread-a");
    queryClient.setQueryData(
      inboxQueryKey,
      messagesData([
        message("a", {
          bodyHtml: "<p>loaded</p>",
          labelIds: ["INBOX"],
          senderAvatarUrls: { dark: "dark-avatar", light: "light-avatar" },
          threadId: "thread-a",
        }),
      ]),
    );
    queryClient.setQueryData<ThreadMessagesResult>(threadQueryKey, {
      threadId: "thread-a",
      messages: [
        message("a", {
          bodyHtml: "<p>loaded</p>",
          labelIds: ["INBOX"],
          threadId: "thread-a",
        }),
      ],
    });

    await applyVisibleMailboxMessagesRefreshToCache(
      queryClient,
      { mailboxId: "mailbox-a", mailbox: "inbox" },
      {
        removedMessageIds: [],
        updatedMessages: [
          message("a", { isUnread: true, labelIds: ["INBOX"], threadId: "thread-a" }),
        ],
      },
    );

    expect(
      queryClient.getQueryData<MessagesQueryData>(inboxQueryKey)?.pages[0].messages[0],
    ).toMatchObject({
      bodyHtml: "<p>loaded</p>",
      isUnread: true,
      senderAvatarUrls: { dark: "dark-avatar", light: "light-avatar" },
    });
    expect(
      queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey)?.messages[0],
    ).toMatchObject({
      bodyHtml: "<p>loaded</p>",
      isUnread: true,
    });
  });
});

describe("persistQueryKeys", () => {
  test("persists allowlisted message lists and skips search and thread queries", async () => {
    const queryClient = new QueryClient();
    const inboxQueryKey = getMessagesQueryKey("mailbox-a", "inbox");
    const searchQueryKey = getMessagesQueryKey("mailbox-a", "inbox", "from:alex");
    const threadQueryKey = getThreadQueryKey("mailbox-a", "thread-a");
    const persistSpy = spyOn(queryPersister, "persistQueryByKey").mockImplementation(
      async () => {},
    );

    try {
      await persistQueryKeys(queryClient, [inboxQueryKey, searchQueryKey, threadQueryKey]);

      expect(persistSpy.mock.calls.map(([queryKey]) => queryKey)).toEqual([inboxQueryKey]);
    } finally {
      persistSpy.mockRestore();
    }
  });
});
