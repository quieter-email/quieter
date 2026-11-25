import type { MessageListItem } from "@quieter/app/lib/mail";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/keys";
import { getProvisionalMessagesData } from "@quieter/app/lib/mail/inbox-query/provisional";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

const message = (
  id: string,
  extras: Partial<MessageListItem> = {}
): MessageListItem => ({
  id,
  threadId: `thread-${id}`,
  ...extras,
});

const cacheMessages = (
  client: QueryClient,
  mailbox: "done" | "inbox" | "sent" | "unread",
  messages: MessageListItem[]
) => {
  client.setQueryData<MessagesQueryData>(
    getMessagesQueryKey("mailbox", mailbox),
    {
      pageParams: [undefined],
      pages: [{ messages }],
    }
  );
};

describe(getProvisionalMessagesData, () => {
  test("derives unread conversations from loaded mailbox pages", () => {
    const client = new QueryClient();
    cacheMessages(client, "inbox", [
      message("unread", {
        labelIds: ["INBOX", "UNREAD"],
        subject: "Unread",
      }),
      message("read", { labelIds: ["INBOX"], subject: "Read" }),
    ]);

    const provisional = getProvisionalMessagesData(client, "mailbox", "unread");

    expect(
      provisional?.pages[0]?.messages.map((item) => item.id)
    ).toStrictEqual(["unread"]);
    client.clear();
  });

  test("derives matching search results from already loaded pages", () => {
    const client = new QueryClient();
    cacheMessages(client, "inbox", [
      message("invoice", {
        from: "Billing <billing@example.com>",
        labelIds: ["INBOX"],
        subject: "March invoice",
      }),
      message("lunch", {
        from: "Friend <friend@example.com>",
        labelIds: ["INBOX"],
        subject: "Lunch",
      }),
    ]);
    cacheMessages(client, "sent", [
      message("sent-invoice", {
        from: "Me <me@example.com>",
        subject: "Invoice follow-up",
      }),
    ]);

    const provisional = getProvisionalMessagesData(
      client,
      "mailbox",
      "inbox",
      "invoice"
    );

    expect(
      provisional?.pages[0]?.messages.map((item) => item.id)
    ).toStrictEqual(["invoice"]);
    client.clear();
  });

  test("does not guess when a query needs server-only search semantics", () => {
    const client = new QueryClient();
    cacheMessages(client, "inbox", [
      message("invoice", { subject: "March invoice" }),
    ]);

    expect(
      getProvisionalMessagesData(
        client,
        "mailbox",
        "inbox",
        "invoice before:2025/01/01"
      )
    ).toBeUndefined();
    client.clear();
  });
});
