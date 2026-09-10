import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import type { ThreadMessagesResult } from "@quieter/mail/messages";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { getThreadQueryKey } from "../thread-query-keys";
import {
  applyBulkChangesInMailbox,
  updateMessageInMailbox,
  updateThreadInMailbox,
} from "./actions";
import { getMessagesQueryKey } from "./keys";

const engine = vi.hoisted(() => ({
  command:
    vi.fn<
      (
        mailboxId: string,
        targets: MailMutationTarget[],
        command: MailCommand
      ) => Promise<void>
    >(),
  ready: Promise.resolve<null>(null),
  thread:
    vi.fn<
      (mailboxId: string, threadId: string) => Promise<ThreadMessagesResult>
    >(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Exercise the UI boundary while controlling engine startup and command outcomes.
vi.mock("#/lib/mail-sync/session", () => ({
  MailSyncSession: {
    waitForMailbox: async () => {
      await engine.ready;
      return { client: { thread: engine.thread }, command: engine.command };
    },
  },
}));

describe("mail actions through the sync engine", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    engine.ready = Promise.resolve(null);
  });

  test("waits for startup before submitting a message action", async () => {
    const ready = Promise.withResolvers<null>();
    engine.ready = ready.promise;
    const queryClient = new QueryClient();
    queryClient.setQueryData(getMessagesQueryKey("mailbox", "inbox"), {
      pageParams: [undefined],
      pages: [{ messages: [{ id: "message", threadId: "thread" }] }],
    });
    const action = updateMessageInMailbox(
      {
        mailbox: "inbox",
        mailboxId: "mailbox",
        messageId: "message",
        queryClient,
        searchQuery: undefined,
      },
      "read"
    );
    expect(engine.command).not.toHaveBeenCalled();
    ready.resolve(null);
    await action;
    expect(engine.command).toHaveBeenCalledWith(
      "mailbox",
      [{ messageIds: ["message"], threadId: "thread" }],
      { kind: "set-read", read: true }
    );
    queryClient.clear();
  });

  test("uses the engine's complete thread membership for a thread action", async () => {
    const queryClient = new QueryClient();
    engine.thread.mockResolvedValue({
      messages: [
        { id: "a", threadId: "thread" },
        { id: "b", threadId: "thread" },
      ],
      threadId: "thread",
    });
    await updateThreadInMailbox(
      { mailboxId: "mailbox", queryClient, threadId: "thread" },
      "unread"
    );
    expect(engine.command).toHaveBeenCalledWith(
      "mailbox",
      [{ messageIds: ["a", "b"], threadId: "thread" }],
      { kind: "set-read", read: false }
    );
  });

  test.each([
    ["trash", "trash"],
    ["untrash", "inbox"],
    ["spam", "spam"],
    ["unspam", "inbox"],
    ["archive", "archive"],
  ] as const)(
    "maps %s to a move command using a message cached only in its thread",
    async (operation, destination) => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(getThreadQueryKey("mailbox", "thread"), {
        messages: [{ id: "message", threadId: "thread" }],
        threadId: "thread",
      });
      await updateMessageInMailbox(
        {
          mailbox: "inbox",
          mailboxId: "mailbox",
          messageId: "message",
          queryClient,
          searchQuery: undefined,
        },
        operation
      );
      expect(engine.command).toHaveBeenCalledWith(
        "mailbox",
        [{ messageIds: ["message"], threadId: "thread" }],
        { destination, kind: "move" }
      );
    }
  );

  test("submits repeated actions immediately to the engine", async () => {
    const pending = Promise.withResolvers<null>();
    engine.command.mockImplementationOnce(async () => {
      await pending.promise;
    });
    const targets = [{ messageIds: ["a"], threadId: "thread" }];
    const first = applyBulkChangesInMailbox("mailbox", targets, {
      kind: "set-read",
      read: true,
    });
    const failed = (async () => {
      try {
        await first;
        return null;
      } catch (error) {
        return error;
      }
    })();
    const second = applyBulkChangesInMailbox("mailbox", targets, {
      kind: "set-read",
      read: false,
    });
    await vi.waitFor(() => {
      expect(engine.command).toHaveBeenCalledTimes(2);
    });
    pending.reject(new Error("Command failed"));
    await expect(failed).resolves.toStrictEqual(new Error("Command failed"));
    await second;
    expect(engine.command).toHaveBeenCalledTimes(2);
    expect(engine.command).toHaveBeenLastCalledWith("mailbox", targets, {
      kind: "set-read",
      read: false,
    });
  });

  test("does not issue an untracked mutation when startup fails", async () => {
    engine.ready = Promise.reject(new Error("Startup failed"));
    await expect(
      applyBulkChangesInMailbox(
        "mailbox",
        [{ messageIds: ["a"], threadId: "thread" }],
        { kind: "set-read", read: true }
      )
    ).rejects.toThrow("Startup failed");
    expect(engine.command).not.toHaveBeenCalled();
  });
});
