import type { MailboxActions } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { createUnifiedInboxActions } from "@quieter/app/features/mailbox/components/unified-inbox-actions";
import type { MessageListMailboxContext } from "@quieter/app/features/message-list/components/message-list-types";
import { createDemoActions } from "@quieter/app/lib/demo-mail/actions";
import type { DemoSnoozeSchedule } from "@quieter/app/lib/demo-mail/actions";
import { buildThreadListEntries } from "@quieter/app/lib/gmail/thread-list";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { describe, expect, it, vi } from "vite-plus/test";

import { createMessageRowHandlers } from "./message-row-handlers";

// oxlint-disable-next-line vitest/prefer-import-in-mock -- No RPC calls are used by these client capability tests.
vi.mock("@quieter/app/lib/orpc", () => ({ rpc: { mail: {} } }));
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: vi.fn<() => void>(),
}));

const createActions = (canMarkRead: boolean) => ({
  ...createDemoActions(
    {
      mailboxId: "demo-test",
      updateMessages: vi.fn<() => void>(),
      updateSnoozes: vi.fn<() => void>(),
    },
    async () => {
      await Promise.resolve();
    }
  ),
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

describe("unified Snooze source snapshots", () => {
  it("rejects a frozen older schedule after refresh and delegates current source identities", async () => {
    let state: {
      messages: MessageListItem[];
      snoozes: Partial<Record<string, DemoSnoozeSchedule>>;
    } = {
      messages: [{ id: "message", labelIds: ["INBOX"], threadId: "thread" }],
      snoozes: {},
    };
    const actions = createDemoActions(
      {
        mailboxId: "demo-test",
        updateMessages: (update) => {
          state = { ...state, messages: update(state.messages) };
        },
        updateSnoozes: (update) => {
          state = update(state);
        },
      },
      async () => {
        await Promise.resolve();
      }
    );
    const schedule = {
      returnAt: new Date(Date.now() + 86_400_000).toISOString(),
      timeZone: "America/New_York",
    };
    await actions.applyThreadSnooze("thread", { ...schedule, kind: "snooze" });
    const selected = buildThreadListEntries(
      state.messages.map((message) => ({
        ...message,
        id: JSON.stringify(["demo-test", message.id]),
        threadId: JSON.stringify(["demo-test", message.threadId]),
      }))
    );
    const newerReturnAt = new Date(Date.now() + 172_800_000).toISOString();
    await actions.applyThreadSnooze("thread", {
      ...schedule,
      kind: "reschedule",
      returnAt: newerReturnAt,
    });
    const newerVersion = state.snoozes.thread?.state.version;
    const [currentThread] = buildThreadListEntries(state.messages);
    const { mailboxActions } = createUnifiedInboxActions({
      contextsByThreadId: new Map([
        [
          selected[0].threadId,
          {
            badge: null,
            emailAddress: "demo@example.test",
            mailboxActions: actions,
            mailboxId: "demo-test",
            mailboxProvider: "managed",
            originalMessageIds: new Map([
              [selected[0].anchorMessage.id, "message"],
            ]),
            originalThreadId: "thread",
            pendingActions: {
              isMessageActionPending: () => false,
              isThreadActionPending: () => false,
            },
          },
        ],
      ]),
      originalMessageById: new Map([
        [selected[0].anchorMessage.id, currentThread.anchorMessage],
      ]),
      originalThreadById: new Map([[selected[0].threadId, currentThread]]),
    });
    await expect(
      mailboxActions.applyThreadsSnooze(selected, {
        ...schedule,
        kind: "reschedule",
      })
    ).rejects.toThrow(/changed/u);
    expect(state.snoozes.thread?.state).toMatchObject({
      returnAt: newerReturnAt,
      status: "active",
      version: newerVersion,
    });
    const refreshed = buildThreadListEntries(
      state.messages.map((message) => ({
        ...message,
        id: JSON.stringify(["demo-test", message.id]),
        threadId: JSON.stringify(["demo-test", message.threadId]),
      }))
    );
    await mailboxActions.applyThreadsSnooze(refreshed, { kind: "return-now" });
    const returnedMessage = state.messages.find(
      (message) => message.id === "message"
    );
    expect(returnedMessage).toMatchObject({
      id: "message",
      snooze: { status: "returned" },
      threadId: "thread",
    });
    expect(returnedMessage?.labelIds).toContain("INBOX");
  });
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
