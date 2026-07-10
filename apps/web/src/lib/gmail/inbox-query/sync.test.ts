import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";
import type { MessageListItem, ThreadMessagesResult } from "../gmail";
import type { MessagesQueryData } from "./data";
import { getThreadQueryKey } from "../thread-query";
import { getMessagesQueryKey } from "./keys";
import { applyMailboxSyncDelta } from "./sync";

const message = (id: string, extras: Partial<MessageListItem> = {}): MessageListItem => ({
  id,
  threadId: `thread-${id}`,
  ...extras,
});

describe("applyMailboxSyncDelta", () => {
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
      pages: [{ historyId: "1", messages: [selectedMessage] }],
      pageParams: [undefined],
    });
    queryClient.setQueryData<ThreadMessagesResult>(threadQueryKey, {
      threadId: "thread-a",
      messages: [selectedMessage],
    });

    await applyMailboxSyncDelta(queryClient, "mailbox-a", messagesQueryKey, "1", [], ["a"], "2");

    expect(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey)?.pages[0].messages,
    ).toEqual([]);
    expect(queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey)?.messages).toEqual([
      selectedMessage,
    ]);
  });
});
