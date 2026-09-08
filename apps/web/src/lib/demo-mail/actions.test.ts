import { describe, expect, test, vi } from "vite-plus/test";

import { createEmptyComposeDraft } from "#/features/compose/domain/draft";
import { MAILBOX_LABELS } from "#/lib/mail";
import type { MessageListItem } from "#/lib/mail";

import { createDemoActions, createDemoComposeActions } from "./actions";
import { listDemoMail } from "./queries";

describe("demo mail", () => {
  test("sending an unsaved reply preserves existing messages and deleting its draft preserves the thread", () => {
    let messages: MessageListItem[] = [
      {
        id: "incoming",
        labelIds: [MAILBOX_LABELS.inbox],
        threadId: "conversation",
      },
      { id: "other", threadId: "other" },
    ];
    const compose = createDemoComposeActions({
      prefix: "test",
      sender: "sender@example.com",
      updateMessages: (update) => {
        messages = update(messages);
      },
    });
    const draft = {
      ...createEmptyComposeDraft(),
      bodyText: "A reply",
      replyContext: { references: [], threadId: "conversation" },
    };
    const sent = compose.sendDraft(draft);
    expect(sent.threadId).toBe("conversation");
    expect(messages.map((message) => message.id)).toStrictEqual([
      "incoming",
      "other",
      sent.id,
    ]);
    const saved = compose.saveDraft(draft);
    compose.deleteDraft(saved);
    expect(messages.map((message) => message.id)).toStrictEqual([
      "incoming",
      "other",
      sent.id,
    ]);
  });

  test("message actions preserve sibling messages while thread actions update the whole conversation", async () => {
    let messages: MessageListItem[] = [
      {
        id: "first",
        isUnread: true,
        labelIds: [MAILBOX_LABELS.inbox],
        threadId: "conversation",
      },
      {
        id: "second",
        isUnread: true,
        labelIds: [MAILBOX_LABELS.inbox],
        threadId: "conversation",
      },
      {
        id: "other",
        isUnread: true,
        labelIds: [MAILBOX_LABELS.inbox],
        threadId: "other",
      },
    ];
    const actions = createDemoActions(
      {
        updateMessages: (update) => {
          messages = update(messages);
        },
      },
      vi.fn<() => Promise<void>>().mockResolvedValue()
    );
    await actions.markMessageAsRead("first");
    expect(messages.map((message) => message.isUnread)).toStrictEqual([
      false,
      true,
      true,
    ]);
    await actions.markThreadAsRead("conversation");
    expect(messages.map((message) => message.isUnread)).toStrictEqual([
      false,
      false,
      true,
    ]);
    await actions.moveThreadToTrash("conversation");
    expect(messages.map((message) => message.labelIds)).toStrictEqual([
      [MAILBOX_LABELS.trash],
      [MAILBOX_LABELS.trash],
      [MAILBOX_LABELS.inbox],
    ]);
  });

  test("negated named labels and pagination preserve complete thread labels", () => {
    const messages: MessageListItem[] = [
      {
        id: "first",
        labelIds: [MAILBOX_LABELS.inbox],
        threadId: "conversation",
      },
      {
        id: "second",
        labelIds: [MAILBOX_LABELS.inbox, "client-label"],
        threadId: "conversation",
      },
      { id: "third", labelIds: [MAILBOX_LABELS.inbox], threadId: "other" },
    ];
    const input = {
      category: "inbox" as const,
      historyId: "1",
      labels: [{ id: "client-label", name: "Clients" }],
      maxResults: 1,
      query: "-label:Clients",
    };
    const first = listDemoMail(messages, input);
    expect(first.messages.map((message) => message.id)).toStrictEqual([
      "first",
    ]);
    expect(first.messages[0]?.threadLabelIds).toContain("client-label");
    const second = listDemoMail(messages, {
      ...input,
      pageToken: first.nextPageToken,
    });
    expect(second.messages.map((message) => message.id)).toStrictEqual([
      "third",
    ]);
    expect(second.nextPageToken).toBeUndefined();
  });
});
