import type {
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/keys";
import { rememberRequestedUnsubscribe } from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";
import { QueryClient } from "@tanstack/react-query";
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
    const search = getMessagesQueryKey("mailbox", "important", "updates");
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
});
