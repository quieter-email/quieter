import { describe, expect, test } from "vite-plus/test";
import type { ListMessagesPageResult, MessageListItem, ThreadMessagesResult } from "../gmail";
import {
  applyMessageLabelChangesLocally,
  mergeRefreshedMailboxPagesIntoQueryData,
  upsertMessageInThreadData,
  type MessagesQueryData,
} from "./data";

const message = (id: string, extras: Partial<MessageListItem> = {}): MessageListItem => ({
  id,
  threadId: `thread-${id}`,
  ...extras,
});

const page = (messages: MessageListItem[], nextPageToken?: string): ListMessagesPageResult => ({
  messages,
  nextPageToken,
});

describe("mergeRefreshedMailboxPagesIntoQueryData", () => {
  test("preserves unrefreshed persisted pages behind a refreshed prefix", () => {
    const previous: MessagesQueryData = {
      pages: [
        page([message("a", { bodyHtml: "<p>cached a</p>" })], "old-page-2"),
        page([message("b"), message("c")], "old-page-3"),
        page([message("d")]),
      ],
      pageParams: [undefined, "old-page-2", "old-page-3"],
    };

    const next = mergeRefreshedMailboxPagesIntoQueryData(
      previous,
      [page([message("x"), message("a")], "new-page-2")],
      [undefined],
      { preserveUnrefreshedPages: true },
    );

    expect(next.pages.map((currentPage) => currentPage.messages.map((item) => item.id))).toEqual([
      ["x", "a"],
      ["b", "c"],
      ["d"],
    ]);
    expect(next.pages[0].messages[1].bodyHtml).toBe("<p>cached a</p>");
    expect(next.pageParams).toEqual([undefined, "old-page-2", "old-page-3"]);
  });

  test("drops stale tail pages when the refreshed prefix reaches the end", () => {
    const previous: MessagesQueryData = {
      pages: [page([message("a")], "old-page-2"), page([message("b")])],
      pageParams: [undefined, "old-page-2"],
    };

    const next = mergeRefreshedMailboxPagesIntoQueryData(
      previous,
      [page([message("a")])],
      [undefined],
      { preserveUnrefreshedPages: true },
    );

    expect(next.pages.map((currentPage) => currentPage.messages.map((item) => item.id))).toEqual([
      ["a"],
    ]);
    expect(next.pageParams).toEqual([undefined]);
  });
});

describe("upsertMessageInThreadData", () => {
  test("adds a newly synced message to an already cached thread", () => {
    const previous: ThreadMessagesResult = {
      threadId: "thread-a",
      messages: [
        message("a", { threadId: "thread-a", internalDate: "1000" }),
        message("c", { threadId: "thread-a", internalDate: "3000" }),
      ],
    };

    const next = upsertMessageInThreadData(
      previous,
      message("b", { threadId: "thread-a", internalDate: "2000" }),
    );

    expect(next?.messages.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  test("preserves loaded body details when refreshing an existing thread message", () => {
    const previous: ThreadMessagesResult = {
      threadId: "thread-a",
      messages: [
        message("a", {
          bodyHtml: "<p>loaded</p>",
          isUnread: true,
          threadId: "thread-a",
        }),
      ],
    };

    const next = upsertMessageInThreadData(
      previous,
      message("a", { isUnread: false, threadId: "thread-a" }),
    );

    expect(next?.messages[0]).toMatchObject({
      bodyHtml: "<p>loaded</p>",
      id: "a",
      isUnread: false,
    });
  });
});

describe("applyMessageLabelChangesLocally", () => {
  test("archives a message by removing the inbox label only", () => {
    const next = applyMessageLabelChangesLocally(
      message("a", { labelIds: ["INBOX", "IMPORTANT", "UNREAD"] }),
      { removeLabelIds: ["INBOX"] },
    );

    expect(next.labelIds).toEqual(["IMPORTANT", "UNREAD"]);
  });
});
