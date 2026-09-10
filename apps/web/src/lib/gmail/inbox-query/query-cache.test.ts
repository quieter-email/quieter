import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import type { MessageListItem, ThreadMessagesResult } from "#/lib/mail";

import { getThreadQueryKey } from "../thread-query";
import type { MessagesQueryData } from "./data";
import { getMessagesQueryKey } from "./keys";
import {
  applyOptimisticMailboxUpdate,
  updateMessagesInCachedMailboxQueries,
} from "./query-cache";

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
      queryClient.fetchQuery({ queryFn: () => fresh, queryKey })
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
