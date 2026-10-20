import type {
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/keys";
import {
  applyOptimisticMailboxUpdate,
  persistQueryKeys,
  updateMessagesInCachedMailboxQueries,
} from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query";
import { queryPersister } from "@quieter/app/lib/query-persister";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vite-plus/test";

const message = (
  id: string,
  extras: Partial<MessageListItem> = {}
): MessageListItem => ({
  id,
  threadId: `thread-${id}`,
  ...extras,
});

const messagesData = (messages: MessageListItem[]): MessagesQueryData => ({
  pageParams: [undefined],
  pages: [{ messages }],
});

describe(persistQueryKeys, () => {
  test("persists message lists and threads while skipping search queries", async () => {
    const queryClient = new QueryClient();
    const inboxQueryKey = getMessagesQueryKey("mailbox-a", "inbox");
    const searchQueryKey = getMessagesQueryKey(
      "mailbox-a",
      "inbox",
      "from:alex"
    );
    const threadQueryKey = getThreadQueryKey("mailbox-a", "thread-a");
    const persistSpy = vi
      .spyOn(queryPersister, "persistQueryByKey")
      .mockImplementation(async () => {});

    try {
      await persistQueryKeys(queryClient, [
        inboxQueryKey,
        searchQueryKey,
        threadQueryKey,
      ]);

      expect(persistSpy.mock.calls.map(([queryKey]) => queryKey)).toStrictEqual(
        [inboxQueryKey, threadQueryKey]
      );
    } finally {
      persistSpy.mockRestore();
    }
  });
});

describe(applyOptimisticMailboxUpdate, () => {
  test("a failed action preserves arriving mail and reconciles the changed query", async () => {
    const queryClient = new QueryClient();
    const queryKey = getMessagesQueryKey("mailbox-a", "inbox");
    queryClient.setQueryData(
      queryKey,
      messagesData([message("a", { isUnread: true })])
    );
    const rollback = await applyOptimisticMailboxUpdate(
      queryClient,
      "mailbox-a",
      () => {
        updateMessagesInCachedMailboxQueries(
          queryClient,
          "mailbox-a",
          (item) => item.id === "a",
          (item) => ({ ...item, isUnread: false })
        );
      }
    );
    queryClient.setQueryData(
      queryKey,
      messagesData([message("new"), message("a", { isUnread: false })])
    );
    await rollback();
    expect(
      queryClient
        .getQueryData<MessagesQueryData>(queryKey)
        ?.pages[0].messages.map((item) => item.id)
    ).toStrictEqual(["new", "a"]);
    const fresh = messagesData([
      message("new"),
      message("a", { isUnread: true }),
    ]);
    await expect(
      queryClient.query({ queryFn: () => fresh, queryKey })
    ).resolves.toStrictEqual(fresh);
    queryClient.clear();
  });

  test("a failed action restores unchanged list and thread caches without touching another mailbox", async () => {
    const queryClient = new QueryClient();
    const queryKey = getMessagesQueryKey("mailbox-a", "inbox");
    const otherKey = getMessagesQueryKey("mailbox-b", "inbox");
    const threadKey = getThreadQueryKey("mailbox-a", "thread-a");
    const original = message("a", { isUnread: true });
    queryClient.setQueryData(queryKey, messagesData([original]));
    queryClient.setQueryData(otherKey, messagesData([original]));
    queryClient.setQueryData<ThreadMessagesResult>(threadKey, {
      messages: [original],
      threadId: "thread-a",
    });
    const rollback = await applyOptimisticMailboxUpdate(
      queryClient,
      "mailbox-a",
      () => {
        queryClient.setQueryData(queryKey, messagesData([]));
        queryClient.setQueryData<ThreadMessagesResult>(threadKey, {
          messages: [],
          threadId: "thread-a",
        });
      },
      threadKey
    );
    queryClient.setQueryData(otherKey, messagesData([message("other")]));
    await rollback();
    expect(
      queryClient.getQueryData<MessagesQueryData>(queryKey)?.pages[0].messages
    ).toStrictEqual([original]);
    expect(
      queryClient.getQueryData<ThreadMessagesResult>(threadKey)?.messages
    ).toStrictEqual([original]);
    expect(
      queryClient.getQueryData<MessagesQueryData>(otherKey)?.pages[0].messages
    ).toStrictEqual([message("other")]);
    queryClient.clear();
  });
});
