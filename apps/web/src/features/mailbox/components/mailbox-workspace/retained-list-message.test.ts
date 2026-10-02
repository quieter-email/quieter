import { describe, expect, test } from "vite-plus/test";

import { buildThreadListEntries } from "#/lib/gmail/thread-list";
import type { ListMessagesPageResult, MessageListItem } from "#/lib/mail";

import {
  captureListMessage,
  retainSelectedMessageInList,
} from "./retained-list-message";

const scopeKey = JSON.stringify(["mailbox-a", "unread", ""]);
const openedMessage: MessageListItem = {
  id: "opened",
  isUnread: true,
  labelIds: ["INBOX", "UNREAD"],
  threadId: "thread-opened",
  threadLabelIds: ["INBOX", "UNREAD"],
  threadMessageCount: 4,
};
const readMessage: MessageListItem = {
  id: "opened",
  isUnread: false,
  labelIds: ["INBOX"],
  threadId: "thread-opened",
};
const precedingMessage: MessageListItem = {
  id: "before",
  threadId: "thread-before",
};
const followingMessage: MessageListItem = {
  id: "after",
  threadId: "thread-after",
};
const originalPages: ListMessagesPageResult[] = [
  { messages: [precedingMessage, openedMessage, followingMessage] },
];
const currentPages: ListMessagesPageResult[] = [
  { messages: [precedingMessage, followingMessage] },
];

describe("retained message list selection", () => {
  test("keeps an opened read thread in position with fresh metadata without changing the query cache", () => {
    const pages = retainSelectedMessageInList({
      messageId: openedMessage.id,
      pages: currentPages,
      retainedMessage: captureListMessage(
        originalPages,
        scopeKey,
        openedMessage.id
      ),
      scopeKey,
      selectedMessage: readMessage,
      selectedThreadMessages: [readMessage],
    });

    expect(pages[0].messages.map((message) => message.id)).toStrictEqual([
      "before",
      "opened",
      "after",
    ]);
    expect(buildThreadListEntries(pages[0].messages)[1]).toMatchObject({
      messageCount: 4,
      threadLabelIds: ["INBOX"],
      unreadCount: 0,
    });
    expect(currentPages[0].messages.map((message) => message.id)).toStrictEqual(
      ["before", "after"]
    );
  });

  test.each([
    { messageId: null, scopeKey },
    { messageId: "another-message", scopeKey },
    {
      messageId: "opened",
      scopeKey: JSON.stringify(["mailbox-b", "unread", ""]),
    },
    {
      messageId: "opened",
      scopeKey: JSON.stringify(["mailbox-a", "inbox", ""]),
    },
    {
      messageId: "opened",
      scopeKey: JSON.stringify(["mailbox-a", "unread", "from:alex"]),
    },
  ])(
    "releases the retained row when the selection or list scope changes: %j",
    (selection) => {
      const pages = retainSelectedMessageInList({
        ...selection,
        pages: currentPages,
        retainedMessage: captureListMessage(
          originalPages,
          scopeKey,
          openedMessage.id
        ),
        selectedMessage: readMessage,
        selectedThreadMessages: [readMessage],
      });

      expect(
        pages.flatMap((page) => page.messages.map((message) => message.id))
      ).not.toContain("opened");
    }
  );

  test("uses the current thread row instead of duplicating an older anchor", () => {
    const latestMessage = { ...readMessage, id: "new-anchor" };
    const pages = retainSelectedMessageInList({
      messageId: openedMessage.id,
      pages: [{ messages: [latestMessage] }],
      retainedMessage: captureListMessage(
        originalPages,
        scopeKey,
        openedMessage.id
      ),
      scopeKey,
      selectedMessage: readMessage,
      selectedThreadMessages: [readMessage, latestMessage],
    });

    expect(pages[0].messages.map((message) => message.id)).toStrictEqual([
      "new-anchor",
    ]);
  });

  test("preserves the row's place among its neighbors when new mail arrives across pages", () => {
    const arrivingMessage = { id: "arriving", threadId: "thread-arriving" };
    const retainedMessage = captureListMessage(
      [
        { messages: [precedingMessage, openedMessage] },
        { messages: [followingMessage] },
      ],
      scopeKey,
      openedMessage.id
    );
    const pages = retainSelectedMessageInList({
      messageId: openedMessage.id,
      pages: [
        { messages: [arrivingMessage, precedingMessage] },
        { messages: [followingMessage] },
      ],
      retainedMessage,
      scopeKey,
      selectedMessage: readMessage,
      selectedThreadMessages: [readMessage],
    });

    expect(
      pages.flatMap((page) => page.messages.map((message) => message.id))
    ).toStrictEqual(["arriving", "before", "opened", "after"]);
  });

  test("retains the last unread message while its independent thread query loads", () => {
    const pages = retainSelectedMessageInList({
      messageId: openedMessage.id,
      pages: [],
      retainedMessage: captureListMessage(
        originalPages,
        scopeKey,
        openedMessage.id
      ),
      scopeKey,
      selectedMessage: null,
      selectedThreadMessages: undefined,
    });

    expect(
      pages.flatMap((page) => page.messages.map((message) => message.id))
    ).toContain("opened");
  });
});
