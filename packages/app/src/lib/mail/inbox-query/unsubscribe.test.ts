import type {
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import { mergeMessagePreservingLoadedDetails } from "@quieter/app/lib/mail/inbox-query/data";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/keys";
import { rememberRequestedUnsubscribe } from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

describe("remembered unsubscribe cache state", () => {
  test("marks matching messages across folders, searches, and threads without crossing mailboxes", async () => {
    const client = new QueryClient();
    const key = "list:updates.example.com";
    const messages: MessageListItem[] = [
      { id: "first", threadId: "first", unsubscribeKey: key },
      { id: "second", threadId: "second", unsubscribeKey: key },
      {
        id: "other",
        threadId: "other",
        unsubscribeKey: "list:other.example.com",
      },
    ];
    const folder = getMessagesQueryKey("mailbox", "inbox");
    const important = getMessagesQueryKey("mailbox", "important");
    const search = getMessagesQueryKey("mailbox", "archive", "updates");
    const otherMailbox = getMessagesQueryKey("another", "inbox");
    const thread = getThreadQueryKey("mailbox", "first");
    for (const queryKey of [folder, important, search, otherMailbox]) {
      client.setQueryData<MessagesQueryData>(queryKey, {
        pageParams: [undefined],
        pages: [{ messages }],
      });
    }
    client.setQueryData<ThreadMessagesResult>(thread, {
      messages,
      threadId: "first",
    });
    const delayed = Promise.withResolvers<MessagesQueryData>();
    const started = Promise.withResolvers<boolean>();
    const stale = Promise.allSettled([
      client.query({
        queryFn: async () => {
          started.resolve(true);
          return await delayed.promise;
        },
        queryKey: folder,
      }),
    ]);
    await started.promise;
    await rememberRequestedUnsubscribe(client, "mailbox", key, "first");
    delayed.resolve({ pageParams: [undefined], pages: [{ messages }] });
    await stale;
    for (const queryKey of [folder, important, search]) {
      const updated =
        client.getQueryData<MessagesQueryData>(queryKey)?.pages[0].messages;
      expect(
        updated
          ?.filter((message) => message.unsubscribeStatus === "requested")
          .map((message) => message.id)
      ).toStrictEqual(expect.arrayContaining(["first", "second"]));
      expect(
        updated?.find((message) => message.id === "other")?.unsubscribeStatus
      ).toBeUndefined();
    }
    expect(
      client.getQueryData<ThreadMessagesResult>(thread)?.messages[1]
        ?.unsubscribeStatus
    ).toBe("requested");
    expect(
      client.getQueryData<MessagesQueryData>(otherMailbox)?.pages[0].messages[0]
        ?.unsubscribeStatus
    ).toBeUndefined();
    client.clear();
  });

  test("successful requests upgrade old cached messages without guessing their list identity", async () => {
    const client = new QueryClient();
    const initiating: MessageListItem = {
      from: "updates@example.com",
      id: "old",
      threadId: "old-thread",
      unsubscribeMailto: "mailto:remove@example.com",
    };
    const another = {
      ...initiating,
      id: "other-list",
      threadId: "other-thread",
    };
    const folder = getMessagesQueryKey("mailbox", "inbox");
    const thread = getThreadQueryKey("mailbox", "old-thread");
    client.setQueryData<MessagesQueryData>(folder, {
      pageParams: [undefined],
      pages: [{ messages: [initiating, another] }],
    });
    client.setQueryData<ThreadMessagesResult>(thread, {
      messages: [initiating],
      threadId: "old-thread",
    });
    await rememberRequestedUnsubscribe(
      client,
      "mailbox",
      "list:updates.example.com",
      initiating.id
    );
    expect(
      client.getQueryData<ThreadMessagesResult>(thread)?.messages[0]
    ).toMatchObject({
      unsubscribeKey: "list:updates.example.com",
      unsubscribeStatus: "requested",
    });
    const cached =
      client.getQueryData<MessagesQueryData>(folder)?.pages[0].messages;
    expect(
      cached?.find((message) => message.id === initiating.id)?.unsubscribeStatus
    ).toBe("requested");
    expect(
      cached?.find((message) => message.id === another.id)?.unsubscribeStatus
    ).toBeUndefined();
    client.clear();
  });

  test("older message details cannot resurrect a completed request", () => {
    const current: MessageListItem = {
      id: "message",
      threadId: "thread",
      unsubscribeKey: "list:updates.example.com",
      unsubscribeStatus: "requested",
    };
    const updated = mergeMessagePreservingLoadedDetails(current, {
      id: "message",
      snippet: "A provider sync",
      threadId: "thread",
    });
    expect(updated.unsubscribeStatus).toBe("requested");
    expect(updated.unsubscribeKey).toBe(current.unsubscribeKey);
  });

  test("confirms success while refreshed mailbox data is still loading", async () => {
    const client = new QueryClient();
    const key = "list:updates.example.com";
    const queryKey = getMessagesQueryKey("mailbox", "inbox");
    const data: MessagesQueryData = {
      pageParams: [undefined],
      pages: [
        {
          messages: [
            { id: "message", threadId: "thread", unsubscribeKey: key },
          ],
        },
      ],
    };
    client.setQueryData(queryKey, data);
    const refreshed = Promise.withResolvers<MessagesQueryData>();
    const started = Promise.withResolvers<boolean>();
    let finished = false;
    const observer = new QueryObserver(client, {
      queryFn: async () => {
        started.resolve(true);
        const result = await refreshed.promise;
        finished = true;
        return result;
      },
      queryKey,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await rememberRequestedUnsubscribe(client, "mailbox", key, "message");
      await started.promise;
      expect(finished).toBeFalsy();
      expect(
        client.getQueryData<MessagesQueryData>(queryKey)?.pages[0].messages[0]
          ?.unsubscribeStatus
      ).toBe("requested");
    } finally {
      refreshed.resolve(data);
      await observer.refetch();
      unsubscribe();
      client.clear();
    }
  });
});
