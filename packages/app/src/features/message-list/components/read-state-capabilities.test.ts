import type { MailboxActions } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { createMailboxActionHandlers } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { createUnifiedInboxActions } from "@quieter/app/features/mailbox/components/unified-inbox-actions";
import type { MessageListMailboxContext } from "@quieter/app/features/message-list/components/message-list-types";
import { createMailboxThreadMessageActionHandlers } from "@quieter/app/features/message-thread/components/message-action-handlers";
import { createDemoActions } from "@quieter/app/lib/demo-mail/actions";
import { buildThreadListEntries } from "@quieter/app/lib/gmail/thread-list";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { QueryClient } from "@tanstack/react-query";
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
  it.each([
    { mutations: 0, provider: "managed", role: "reader" },
    { mutations: 1, provider: "managed", role: "responder" },
    { mutations: 1, provider: "managed", role: "manager" },
    { mutations: 1, provider: "gmail", role: null },
    { mutations: 0, provider: "api", role: null },
  ] as const)(
    "opens $provider $role mail with permitted automatic read state",
    ({ provider, role, mutations }) => {
      const actions = createActions(
        getMailboxCapabilities({ provider, role }).canMarkRead
      );
      const open = vi.fn<() => void>();
      const handlers = createMessageRowHandlers({
        isActionPending: false,
        isActive: false,
        mailboxActions: actions,
        onThreadFocus: vi.fn<() => void>(),
        onThreadIntent: vi.fn<() => void>(),
        onThreadPress: open,
        onThreadSelectionPress: vi.fn<() => void>(),
        showSelectionControl: false,
        thread,
        unread: true,
      });
      handlers.handleRowClick({
        ctrlKey: false,
        detail: 1,
        metaKey: false,
        shiftKey: false,
      });
      expect(open).toHaveBeenCalledWith(thread, {
        additive: false,
        range: false,
      });
      expect(actions.markThreadAsRead).toHaveBeenCalledTimes(mutations);
      const manual = createMailboxThreadMessageActionHandlers({
        mailboxActions: actions,
      });
      expect(typeof manual.onMarkAsRead === "function").toBe(mutations === 1);
      expect(typeof manual.onMarkAsUnread === "function").toBe(mutations === 1);
    }
  );

  it("runs explicit writer actions and propagates their failures", async () => {
    const actions = createActions(true);
    const manual = createMailboxThreadMessageActionHandlers({
      mailboxActions: actions,
    });
    await manual.onMarkAsRead?.(thread.threadId);
    expect(actions.markThreadAsRead).toHaveBeenCalledWith(thread.threadId);
    const failure = new Error("rejected");
    actions.markThreadAsUnread.mockRejectedValueOnce(failure);
    await expect(manual.onMarkAsUnread?.(thread.threadId)).rejects.toThrow(
      failure
    );
  });

  it("reads permission from the current mailbox capability instead of the provider", () => {
    const queryClient = new QueryClient();
    const actions = createMailboxActionHandlers({
      activeMailbox: "inbox",
      activeSearchQuery: "",
      isMessageActionPending: () => false,
      isThreadActionPending: () => false,
      mailboxId: "reader",
      queryClient,
      refreshSearchResultsIfNeeded: vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(),
      setMessageActionPending: vi.fn<() => void>(),
      setMessageActionsPending: vi.fn<() => void>(),
      setThreadActionPending: vi.fn<() => void>(),
      setThreadActionsPending: vi.fn<() => void>(),
      unsubscribeFromMessageMutation: vi
        .fn<MailboxActions["unsubscribeFromMessage"]>()
        .mockResolvedValue(false),
    });
    queryClient.setQueryData(["mailboxes"], {
      groups: [
        {
          mailboxes: [
            {
              capabilities: getMailboxCapabilities({
                provider: "managed",
                role: "manager",
              }),
              id: "writer",
            },
            {
              capabilities: getMailboxCapabilities({
                provider: "managed",
                role: "reader",
              }),
              id: "reader",
            },
          ],
        },
      ],
    });
    expect(actions.canMarkRead).toBeFalsy();
    queryClient.setQueryData(["mailboxes"], {
      groups: [
        {
          mailboxes: [
            {
              capabilities: getMailboxCapabilities({
                provider: "managed",
                role: "responder",
              }),
              id: "reader",
            },
          ],
        },
      ],
    });
    expect(actions.canMarkRead).toBeTruthy();
    queryClient.clear();
  });

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
    const { mailboxActions } = createUnifiedInboxActions({
      contextsByThreadId: contexts,
      originalMessageById: new Map(),
      originalThreadById: new Map([
        [thread.threadId, thread],
        [readerThread.threadId, readerThread],
      ]),
    });
    await expect(
      mailboxActions.markThreadsAsRead([thread, readerThread])
    ).rejects.toThrow(/read status/u);
    expect(writer.markThreadsAsRead).not.toHaveBeenCalled();
    expect(reader.markThreadsAsRead).not.toHaveBeenCalled();
    await mailboxActions.markThreadsAsRead([thread]);
    expect(writer.markThreadsAsRead).toHaveBeenCalledWith([thread]);
  });
});
