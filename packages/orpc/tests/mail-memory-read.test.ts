import type { getThreadWithDetails } from "@quieter/gmail";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { captureMailboxMessageMemory } from "../src/ai-memory-capture";
import { queriesMailOperations } from "../src/mail/queries";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import type { getManagedThread } from "../src/managed-mail/messages/service";

const state = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  capture: vi.fn<typeof captureMailboxMessageMemory>(),
  gmailThread: vi.fn<typeof getThreadWithDetails>(),
  managedThread: vi.fn<typeof getManagedThread>(),
}));
vi.mock(import("../src/ai-memory-capture"), async (original) => ({
  ...(await original()),
  captureMailboxMessageMemory: state.capture,
}));
vi.mock(import("../src/mailbox/service"), async (original) => ({
  ...(await original()),
  assertAccessibleMailbox: state.access,
}));
vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  getThreadWithDetails: state.gmailThread,
}));
vi.mock(import("../src/managed-mail/messages/service"), async (original) => ({
  ...(await original()),
  getManagedThread: state.managedThread,
}));
vi.mock(import("../src/mail-importance"), () => ({
  hydrateMailImportance: async <T extends { id: string }>(
    _mailboxId: string,
    messages: T[]
  ) =>
    await Promise.resolve(
      messages.map((message) => ({
        ...message,
        isImportant: false,
        threadIsImportant: false,
      }))
    ),
  processPendingMailImportance: async () => {
    await Promise.resolve();
  },
}));
vi.mock(import("../src/gmail-compose"), async (original) => ({
  ...(await original()),
  hydrateUnsubscribeStatus: async <T extends { id: string }>(
    _mailboxId: string,
    messages: T[]
  ) => await Promise.resolve(messages),
}));
vi.mock(import("../src/gmail-mailbox-access"), () => ({
  runAuthorizedGmailMailbox: async <T>(
    _input: { mailboxId: string; userId: string },
    request: (accessToken: string) => Promise<T>
  ) => await request("fixture-token"),
}));

const thread = {
  messages: [
    { bodyText: "An update for you.", id: "message", threadId: "thread" },
  ],
  threadId: "thread",
};

describe("thread reads with memory learning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.gmailThread.mockResolvedValue(thread);
    state.managedThread.mockResolvedValue(thread);
  });

  test.each(["gmail", "managed"] as const)(
    "%s returns the thread while scheduled memory capture is pending",
    async (provider) => {
      state.access.mockResolvedValue({
        capabilities: getMailboxCapabilities({ provider }),
        contentRevision: 0,
        id: "mailbox",
        organizationId: "organization",
        provider,
      });
      const capture = Promise.withResolvers<null>();
      state.capture.mockReturnValue(capture.promise);
      const background: Promise<unknown>[] = [];
      const reading = queriesMailOperations.getThread({
        context: {
          scheduleBackgroundTask: (task) => {
            background.push(task);
          },
          userId: "reader",
        },
        input: { mailboxId: "mailbox", threadId: "thread" },
      });
      try {
        await vi.waitFor(() => {
          expect(background.length).toBeGreaterThan(0);
        });
        await expect(reading).resolves.toMatchObject({
          messages: [{ id: "message" }],
        });
      } finally {
        capture.resolve(null);
        await reading;
        await Promise.all(background);
      }
    }
  );

  test("awaits capture when the caller has no background scheduler", async () => {
    state.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: "mailbox",
      organizationId: "organization",
      provider: "gmail",
    });
    const started = Promise.withResolvers<null>();
    const capture = Promise.withResolvers<null>();
    state.capture.mockImplementation(async () => {
      started.resolve(null);
      return await capture.promise;
    });
    let returned = false;
    const reading = queriesMailOperations
      .getThread({
        context: { userId: "reader" },
        input: { mailboxId: "mailbox", threadId: "thread" },
      })
      .then((result) => {
        returned = true;
        return result;
      });
    await started.promise;
    expect(returned).toBeFalsy();
    capture.resolve(null);
    await expect(reading).resolves.toMatchObject({ threadId: "thread" });
  });
});
