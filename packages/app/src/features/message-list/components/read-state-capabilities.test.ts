import type { MailboxActions } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { createUnifiedInboxActions } from "@quieter/app/features/mailbox/components/unified-inbox-actions";
import type { MessageListMailboxContext } from "@quieter/app/features/message-list/components/message-list-types";
import { createDemoActions } from "@quieter/app/lib/demo-mail/actions";
import { buildThreadListEntries } from "@quieter/app/lib/gmail/thread-list";
import { describe, expect, it, vi } from "vite-plus/test";

import { createMessageRowHandlers } from "./message-row-handlers";

// oxlint-disable-next-line vitest/prefer-import-in-mock -- No RPC calls are used by these client capability tests.
vi.mock("@quieter/app/lib/orpc", () => ({ rpc: { mail: {} } }));
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: vi.fn<() => void>(),
}));

const createActions = (canMarkRead: boolean) => ({
  ...createDemoActions({ updateMessages: vi.fn<() => void>() }, async () => {
    await Promise.resolve();
  }),
  canMarkRead,
  canSetImportance: canMarkRead,
  markThreadAsRead: vi.fn<MailboxActions["markThreadAsRead"]>(async () => {
    await Promise.resolve();
  }),
  markThreadAsUnread: vi.fn<MailboxActions["markThreadAsUnread"]>(async () => {
    await Promise.resolve();
  }),
  markThreadsAsRead: vi.fn<MailboxActions["markThreadsAsRead"]>(async () => {
    await Promise.resolve();
  }),
});

const [thread] = buildThreadListEntries([
  { id: "message", isUnread: true, threadId: "thread" },
]);

describe("read-state capability compatibility", () => {
  it("rejects mixed inbox read changes before mutating any writer inbox", async () => {
    const writer = createActions(true);
    const reader = createActions(false);
    const readerThread = { ...thread, threadId: "reader-thread" };
    const contexts = new Map<string, MessageListMailboxContext>([
      [
        thread.threadId,
        {
          badge: null,
          emailAddress: "writer@example.test",
          mailboxActions: writer,
          mailboxId: "writer",
          mailboxProvider: "managed",
          originalMessageIds: new Map(),
          originalThreadId: thread.threadId,
          pendingActions: {
            isMessageActionPending: () => false,
            isThreadActionPending: () => false,
          },
        },
      ],
      [
        readerThread.threadId,
        {
          badge: null,
          emailAddress: "reader@example.test",
          mailboxActions: reader,
          mailboxId: "reader",
          mailboxProvider: "managed",
          originalMessageIds: new Map(),
          originalThreadId: readerThread.threadId,
          pendingActions: {
            isMessageActionPending: () => false,
            isThreadActionPending: () => false,
          },
        },
      ],
    ]);
    const { mailboxActions, mailboxContextsByThreadId } =
      createUnifiedInboxActions({
        contextsByThreadId: contexts,
        originalMessageById: new Map(),
        originalThreadById: new Map([
          [thread.threadId, thread],
          [readerThread.threadId, readerThread],
        ]),
      });
    for (const selected of [thread, readerThread]) {
      const actions = mailboxContextsByThreadId.get(
        selected.threadId
      )?.mailboxActions;
      if (!actions) {
        throw new Error("Missing projected mailbox context");
      }
      const open = vi.fn<() => void>();
      createMessageRowHandlers({
        isActionPending: false,
        isActive: false,
        mailboxActions: actions,
        onThreadFocus: vi.fn<() => void>(),
        onThreadIntent: vi.fn<() => void>(),
        onThreadPress: open,
        onThreadSelectionPress: vi.fn<() => void>(),
        showSelectionControl: false,
        thread: selected,
        unread: true,
      }).handleRowClick({
        ctrlKey: false,
        detail: 1,
        metaKey: false,
        shiftKey: false,
      });
      expect(open).toHaveBeenCalledWith(selected, {
        additive: false,
        range: false,
      });
    }
    expect(
      mailboxContextsByThreadId.get(readerThread.threadId)?.mailboxActions
        .canSetImportance
    ).toBeFalsy();
    expect(
      mailboxContextsByThreadId.get(thread.threadId)?.mailboxActions
        .canSetImportance
    ).toBeTruthy();
    expect(reader.markThreadAsRead).not.toHaveBeenCalled();
    expect(writer.markThreadAsRead).toHaveBeenCalledWith(thread.threadId);
    expect(
      [thread, readerThread].every(
        (selected) =>
          mailboxContextsByThreadId.get(selected.threadId)?.mailboxActions
            .canMarkRead === true
      )
    ).toBeFalsy();
    await expect(
      mailboxActions.markThreadsAsRead([thread, readerThread])
    ).rejects.toThrow(/read status/u);
    expect(writer.markThreadsAsRead).not.toHaveBeenCalled();
    expect(reader.markThreadsAsRead).not.toHaveBeenCalled();
    await mailboxActions.markThreadsAsRead([thread]);
    expect(writer.markThreadsAsRead).toHaveBeenCalledWith([thread]);
  });
});
