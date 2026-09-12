import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { MessageListItem, ThreadMessagesResult } from "#/lib/mail";
import {
  disposeMailMutations,
  updateMailQueryFromServer,
} from "#/lib/mail-mutations";
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

  test("reverses an in-flight label change immediately and preserves the latest intent through its response", async () => {
    const { queryClient, inboxKey } = setup();
    const first = Promise.withResolvers<{
      id: string;
      isUnread: boolean;
      labelIds: string[];
    }>();
    vi.mocked(rpc.mail.updateMessageLabels)
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValueOnce({
        id: "a",
        isUnread: true,
        labelIds: ["INBOX", "UNREAD"],
      });
    const args = {
      mailbox: "inbox" as const,
      mailboxId: "mailbox",
      messageId: "a",
      queryClient,
      searchQuery: undefined,
    };
    const add = updateMessageInMailbox(args, { addLabelIds: ["work"] });
    await Promise.resolve();
    const remove = updateMessageInMailbox(args, { removeLabelIds: ["work"] });
    expect(
      queryClient.getQueryData<MessagesQueryData>(inboxKey)?.pages[0]
        .messages[0].labelIds
    ).not.toContain("work");
    expect(rpc.mail.updateMessageLabels).toHaveBeenCalledOnce();
    first.resolve({
      id: "a",
      isUnread: true,
      labelIds: ["INBOX", "UNREAD", "work"],
    });
    await Promise.all([add, remove]);
    expect(rpc.mail.updateMessageLabels).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<MessagesQueryData>(inboxKey)?.pages[0]
        .messages[0].labelIds
    ).not.toContain("work");
  });

  test("coalesces unsent changes and preserves incoming mail when an earlier write fails", async () => {
    const { queryClient, inboxKey } = setup();
    const first = Promise.withResolvers<{
      id: string;
      isUnread: boolean;
      labelIds: string[];
    }>();
    vi.mocked(rpc.mail.updateMessageLabels)
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValueOnce({
        id: "a",
        isUnread: true,
        labelIds: ["INBOX", "UNREAD", "work"],
      });
    const args = {
      mailbox: "inbox" as const,
      mailboxId: "mailbox",
      messageId: "a",
      queryClient,
      searchQuery: undefined,
    };
    const add = updateMessageInMailbox(args, { addLabelIds: ["work"] });
    // oxlint-disable-next-line vitest/valid-expect -- Attach rejection handling before deliberately rejecting the deferred provider call.
    const failed = expect(add).rejects.toThrow("failed");
    await Promise.resolve();
    const remove = updateMessageInMailbox(args, { removeLabelIds: ["work"] });
    const restore = updateMessageInMailbox(args, { addLabelIds: ["work"] });
    queryClient.setQueryData<MessagesQueryData>(inboxKey, {
      pageParams: [undefined],
      pages: [
        {
          messages: [
            { id: "new", labelIds: ["INBOX"], threadId: "new-thread" },
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
    first.reject(new Error("failed"));
    await Promise.all([failed, remove, restore]);
    expect(rpc.mail.updateMessageLabels).toHaveBeenCalledTimes(2);
    const messages =
      queryClient.getQueryData<MessagesQueryData>(inboxKey)?.pages[0].messages;
    expect(messages?.map((message) => message.id)).toContain("new");
    expect(messages?.find((message) => message.id === "a")?.labelIds).toContain(
      "work"
    );
  });

  test("keeps provider deltas separate from a failed optimistic label", async () => {
    const { queryClient, inboxKey } = setup();
    const first = Promise.withResolvers<{
      id: string;
      isUnread: boolean;
      labelIds: string[];
    }>();
    vi.mocked(rpc.mail.updateMessageLabels).mockImplementationOnce(
      async () => await first.promise
    );
    const action = updateMessageInMailbox(
      {
        mailbox: "inbox",
        mailboxId: "mailbox",
        messageId: "a",
        queryClient,
        searchQuery: undefined,
      },
      { addLabelIds: ["work"] }
    );
    // oxlint-disable-next-line vitest/valid-expect -- Attach rejection handling before rejecting the deferred provider call.
    const failure = expect(action).rejects.toThrow("failed");
    await Promise.resolve();
    updateMailQueryFromServer<MessagesQueryData>(
      queryClient,
      inboxKey,
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            messages: [
              ...page.messages,
              { id: "new", labelIds: ["INBOX"], threadId: "new-thread" },
            ],
          })),
        }
    );
    first.reject(new Error("failed"));
    await failure;
    const messages =
      queryClient.getQueryData<MessagesQueryData>(inboxKey)?.pages[0].messages;
    expect(
      messages?.find((message) => message.id === "a")?.labelIds
    ).not.toContain("work");
    expect(messages?.map((message) => message.id)).toContain("new");
  });

  test("stops queued writes and ignores in-flight responses after session disposal", async () => {
    const { queryClient } = setup();
    const first = Promise.withResolvers<{
      id: string;
      isUnread: boolean;
      labelIds: string[];
    }>();
    vi.mocked(rpc.mail.updateMessageLabels).mockImplementationOnce(
      async () => await first.promise
    );
    const args = {
      mailbox: "inbox" as const,
      mailboxId: "mailbox",
      messageId: "a",
      queryClient,
      searchQuery: undefined,
    };
    const add = updateMessageInMailbox(args, { addLabelIds: ["work"] });
    await Promise.resolve();
    const remove = updateMessageInMailbox(args, { removeLabelIds: ["work"] });
    const results = Promise.allSettled([add, remove]);
    disposeMailMutations(queryClient);
    queryClient.clear();
    first.resolve({
      id: "a",
      isUnread: true,
      labelIds: ["INBOX", "UNREAD", "work"],
    });
    const settled = await results;
    expect(settled.map((result) => result.status)).toStrictEqual([
      "rejected",
      "rejected",
    ]);
    expect(rpc.mail.updateMessageLabels).toHaveBeenCalledOnce();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  test("updates replies loaded only in the open thread", async () => {
    const { queryClient, threadKey, messages } = setup();
    queryClient.setQueryData<ThreadMessagesResult>(threadKey, {
      messages: [
        ...messages,
        {
          id: "reply",
          isUnread: true,
          labelIds: ["UNREAD"],
          threadId: "thread",
        },
      ],
      threadId: "thread",
    });
    vi.mocked(rpc.mail.markMessageAsRead).mockResolvedValue({
      id: "reply",
      isUnread: false,
      labelIds: [],
    });
    await updateMessageInMailbox(
      {
        mailbox: "inbox",
        mailboxId: "mailbox",
        messageId: "reply",
        queryClient,
        searchQuery: undefined,
      },
      "read"
    );
    expect(
      queryClient
        .getQueryData<ThreadMessagesResult>(threadKey)
        ?.messages.find((message) => message.id === "reply")?.isUnread
    ).toBeFalsy();
    expect(
      queryClient.getQueryData(getThreadQueryKey("mailbox", "reply"))
    ).toBeUndefined();
  });

  test("a slow background read cannot overwrite a confirmed mutation", async () => {
    const { queryClient, threadKey, messages } = setup();
    const write = Promise.withResolvers<{
      id: string;
      isUnread: boolean;
      labelIds: string[];
    }>();
    const staleRead = Promise.withResolvers<ThreadMessagesResult>();
    vi.mocked(rpc.mail.updateMessageLabels).mockImplementationOnce(
      async () => await write.promise
    );
    const mutation = updateMessageInMailbox(
      {
        mailbox: "inbox",
        mailboxId: "mailbox",
        messageId: "a",
        queryClient,
        searchQuery: undefined,
      },
      { addLabelIds: ["work"] }
    );
    await Promise.resolve();
    const readOutcome = Promise.allSettled([
      queryClient.fetchQuery({
        queryFn: async () => await staleRead.promise,
        queryKey: threadKey,
      }),
    ]);
    write.resolve({
      id: "a",
      isUnread: true,
      labelIds: ["INBOX", "UNREAD", "work"],
    });
    await mutation;
    staleRead.resolve({ messages, threadId: "thread" });
    await readOutcome;
    expect(
      queryClient.getQueryData<ThreadMessagesResult>(threadKey)?.messages[0]
        .labelIds
    ).toContain("work");
  });
});
