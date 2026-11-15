import type {
  ListMessagesPageResult,
  MessageListItem,
} from "@quieter/app/lib/mail";
import { mergeRefreshedMailboxPagesIntoQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { describe, expect, test } from "vite-plus/test";

const message = (
  id: string,
  extras: Partial<MessageListItem> = {}
): MessageListItem => ({
  id,
  threadId: `thread-${id}`,
  ...extras,
});

const page = (
  messages: MessageListItem[],
  nextPageToken?: string
): ListMessagesPageResult => ({
  messages,
  nextPageToken,
});

describe(mergeRefreshedMailboxPagesIntoQueryData, () => {
  test("replaces stale tail pages with a coherent fresh prefix and preserves loaded details", () => {
    const previous: MessagesQueryData = {
      pageParams: [undefined, "old-page-2", "old-page-3"],
      pages: [
        page([message("a", { bodyHtml: "<p>cached a</p>" })], "old-page-2"),
        page([message("b"), message("c")], "old-page-3"),
        page([message("d")]),
      ],
    };

    const next = mergeRefreshedMailboxPagesIntoQueryData(
      previous,
      [page([message("x"), message("a")], "new-page-2")],
      [undefined]
    );

    expect(
      next.pages.map((currentPage) =>
        currentPage.messages.map((item) => item.id)
      )
    ).toStrictEqual([["x", "a"]]);
    expect(next.pages[0].messages[1].bodyHtml).toBe("<p>cached a</p>");
    expect(next.pageParams).toStrictEqual([undefined]);
  });

  test("drops stale tail pages when the refreshed prefix reaches the end", () => {
    const previous: MessagesQueryData = {
      pageParams: [undefined, "old-page-2"],
      pages: [page([message("a")], "old-page-2"), page([message("b")])],
    };

    const next = mergeRefreshedMailboxPagesIntoQueryData(
      previous,
      [page([message("a")])],
      [undefined]
    );

    expect(
      next.pages.map((currentPage) =>
        currentPage.messages.map((item) => item.id)
      )
    ).toStrictEqual([["a"]]);
    expect(next.pageParams).toStrictEqual([undefined]);
  });
});
