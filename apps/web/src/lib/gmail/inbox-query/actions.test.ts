import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { MessageListItem, ThreadMessagesResult } from "#/lib/mail";
import { rpc } from "#/lib/orpc";

import { getThreadQueryKey } from "../thread-query";
import { updateMessageInMailbox, updateThreadInMailbox } from "./actions";
import type { MessagesQueryData } from "./data";
import { getMessagesQueryKey } from "./keys";

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only mail mutation contracts are needed.
vi.mock("#/lib/orpc", () => ({
  rpc: {
    mail: {
      markMessageAsRead: vi.fn<typeof rpc.mail.markMessageAsRead>(),
      markMessageAsUnread: vi.fn<typeof rpc.mail.markMessageAsUnread>(),
      markThreadAsRead: vi.fn<typeof rpc.mail.markThreadAsRead>(),
      markThreadAsUnread: vi.fn<typeof rpc.mail.markThreadAsUnread>(),
      moveMessageToTrash: vi.fn<typeof rpc.mail.moveMessageToTrash>(),
      moveThreadToTrash: vi.fn<typeof rpc.mail.moveThreadToTrash>(),
      untrashMessage: vi.fn<typeof rpc.mail.untrashMessage>(),
      untrashThread: vi.fn<typeof rpc.mail.untrashThread>(),
      updateMessageLabels: vi.fn<typeof rpc.mail.updateMessageLabels>(),
      updateThreadLabels: vi.fn<typeof rpc.mail.updateThreadLabels>(),
    },
  },
}));

const setup = () => {
  const queryClient = new QueryClient();
  const messages: MessageListItem[] = ["a", "b"].map((id) => ({
    bodyHtml: `<p>${id}</p>`,
    id,
    isUnread: true,
    labelIds: ["INBOX", "UNREAD"],
    threadId: "thread",
  }));
  const inboxKey = getMessagesQueryKey("mailbox", "inbox");
  const unreadKey = getMessagesQueryKey("mailbox", "unread");
  const otherMailboxKey = getMessagesQueryKey("other-mailbox", "inbox");
  const threadKey = getThreadQueryKey("mailbox", "thread");
  for (const key of [inboxKey, unreadKey, otherMailboxKey]) {
    queryClient.setQueryData<MessagesQueryData>(key, {
      pageParams: [undefined],
      pages: [{ messages }],
    });
  }
  queryClient.setQueryData<ThreadMessagesResult>(threadKey, {
    messages,
    threadId: "thread",
  });
  return {
    inboxKey,
    messages,
    otherMailboxKey,
    queryClient,
    threadKey,
    unreadKey,
  };
};

describe("mail metadata cache updates", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  test("reading one message updates unread views, retains loaded bodies and leaves its sibling and other mailbox alone", async () => {
    const {
      queryClient,
      inboxKey,
      unreadKey,
      otherMailboxKey,
      threadKey,
      messages,
    } = setup();
    vi.mocked(rpc.mail.markMessageAsRead).mockResolvedValue({
      id: "a",
      isUnread: false,
      labelIds: ["INBOX", "server-label"],
    });

    await updateMessageInMailbox(
      {
        mailbox: "inbox",
        mailboxId: "mailbox",
        messageId: "a",
        queryClient,
        searchQuery: undefined,
      },
      "read"
    );

    expect(
      queryClient
        .getQueryData<MessagesQueryData>(unreadKey)
        ?.pages[0].messages.map(({ id }) => id)
    ).toStrictEqual(["b"]);
    expect(
      queryClient.getQueryData<MessagesQueryData>(inboxKey)?.pages[0].messages
    ).toMatchObject([
      {
        bodyHtml: "<p>a</p>",
        id: "a",
        isUnread: false,
        labelIds: ["INBOX", "server-label"],
      },
      { id: "b", isUnread: true },
    ]);
    expect(
      queryClient.getQueryData<ThreadMessagesResult>(threadKey)?.messages
    ).toMatchObject([
      { bodyHtml: "<p>a</p>", id: "a", isUnread: false },
      { id: "b", isUnread: true },
    ]);
    expect(
      queryClient.getQueryData<MessagesQueryData>(otherMailboxKey)?.pages[0]
        .messages
    ).toStrictEqual(messages);
  });

  test("reading a thread includes messages loaded only in the thread and reconciles their server labels", async () => {
    const { queryClient, inboxKey, unreadKey, threadKey } = setup();
    queryClient.setQueryData<MessagesQueryData>(inboxKey, {
      pageParams: [undefined],
      pages: [
        {
          messages: [
            {
              id: "a",
              isUnread: true,
              labelIds: ["INBOX", "UNREAD"],
              threadId: "thread",
            },
          ],
        },
      ],
    });
    vi.mocked(rpc.mail.markThreadAsRead).mockResolvedValue({
      messages: [
        { id: "a", isUnread: false, labelIds: ["INBOX"] },
        { id: "b", isUnread: false, labelIds: ["INBOX", "server-label"] },
      ],
      threadId: "thread",
    });

    await updateThreadInMailbox(
      { mailboxId: "mailbox", queryClient, threadId: "thread" },
      "read"
    );

    expect(rpc.mail.markThreadAsRead).toHaveBeenCalledWith(
      expect.objectContaining({ mailboxId: "mailbox", threadId: "thread" }),
      expect.anything()
    );
    expect(rpc.mail.markMessageAsRead).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<MessagesQueryData>(unreadKey)?.pages[0].messages
    ).toStrictEqual([]);
    expect(
      queryClient.getQueryData<ThreadMessagesResult>(threadKey)?.messages
    ).toMatchObject([
      { bodyHtml: "<p>a</p>", id: "a", isUnread: false },
      {
        bodyHtml: "<p>b</p>",
        id: "b",
        isUnread: false,
        labelIds: ["INBOX", "server-label"],
      },
    ]);
  });

  test("a failed read restores unread membership and thread metadata after the optimistic update", async () => {
    const { queryClient, inboxKey, unreadKey, threadKey, messages } = setup();
    const failure = new Error("offline");
    vi.mocked(rpc.mail.markThreadAsRead).mockImplementation(() => {
      expect(
        queryClient.getQueryData<MessagesQueryData>(unreadKey)?.pages[0]
          .messages
      ).toStrictEqual([]);
      expect(
        queryClient
          .getQueryData<ThreadMessagesResult>(threadKey)
          ?.messages.every((message) => message.isUnread === false)
      ).toBeTruthy();
      throw failure;
    });

    await expect(
      updateThreadInMailbox(
        { mailboxId: "mailbox", queryClient, threadId: "thread" },
        "read"
      )
    ).rejects.toBe(failure);

    for (const key of [inboxKey, unreadKey]) {
      expect(
        queryClient.getQueryData<MessagesQueryData>(key)?.pages[0].messages
      ).toStrictEqual(messages);
    }
    expect(
      queryClient.getQueryData<ThreadMessagesResult>(threadKey)?.messages
    ).toStrictEqual(messages);
  });
});
