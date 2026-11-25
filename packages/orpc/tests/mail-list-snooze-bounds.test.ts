import * as gmail from "@quieter/gmail";
import type { MessageListItem } from "@quieter/mail/messages";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { callGmail } from "../src/gmail-request";
import { queriesMailOperations } from "../src/mail/queries";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import type {
  attachMailSnoozeStates,
  countVisibleMailSnoozes,
  filterMailSnoozeVisibility,
  listMailSnoozePage,
} from "../src/snooze/queries";

const mocks = vi.hoisted(() => ({
  assertAccessibleMailbox: vi.fn<typeof assertAccessibleMailbox>(),
  attachMailSnoozeStates: vi.fn<typeof attachMailSnoozeStates>(),
  callGmailSpy: vi.fn<() => void>(),
  countVisibleMailSnoozes: vi.fn<typeof countVisibleMailSnoozes>(),
  filterMailSnoozeVisibility: vi.fn<typeof filterMailSnoozeVisibility>(),
  listMailSnoozePage: vi.fn<typeof listMailSnoozePage>(),
}));

vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: mocks.assertAccessibleMailbox,
}));
vi.mock(import("../src/gmail-request"), () => ({
  callGmail: (async (context, _mailboxId, operation) => {
    mocks.callGmailSpy();
    return await operation("fixture-token", context.signal);
  }) satisfies typeof callGmail,
}));
vi.mock(import("../src/mail-importance"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    hydrateMailImportance: async <T extends MessageListItem>(
      _mailboxId: string,
      messages: T[]
    ) => await Promise.resolve(messages),
  };
});
vi.mock(import("../src/gmail-compose"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    hydrateUnsubscribeStatus: async <T extends MessageListItem>(
      _mailboxId: string,
      messages: T[]
    ) => await Promise.resolve(messages),
  };
});
vi.mock(import("../src/snooze/queries"), () => ({
  attachMailSnoozeStates: mocks.attachMailSnoozeStates,
  countVisibleMailSnoozes: mocks.countVisibleMailSnoozes,
  filterMailSnoozeVisibility: mocks.filterMailSnoozeVisibility,
  listMailSnoozePage: mocks.listMailSnoozePage,
}));

describe("queriesMailOperations Later short-circuits and scan bounds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.assertAccessibleMailbox.mockResolvedValue({
      capabilities: {
        canDeletePermanently: false,
        canManageKnowledge: true,
        canManageLabels: true,
        canMarkRead: true,
        canMoveToInbox: true,
        canMoveToSpam: true,
        canMoveToTrash: true,
        canSend: true,
        canSetImportance: true,
        canSetPlacement: true,
        canSetSenderName: false,
        categories: ["inbox", "done", "later"],
      },
      contentRevision: 7,
      id: "mbx-1",
      organizationId: "org-1",
      provider: "gmail",
    });
    mocks.attachMailSnoozeStates.mockImplementation(
      async ({ messages }) => await Promise.resolve(messages)
    );
  });

  test("short-circuits empty Later view without calling Gmail or getGmailProfile", async () => {
    mocks.listMailSnoozePage.mockResolvedValue({
      nextPageToken: undefined,
      snoozes: [],
    });

    const result = await queriesMailOperations.listThreads({
      context: { userId: "user-1" },
      input: { category: "later", mailboxId: "mbx-1", maxResults: 20 },
    });

    expect(result).toStrictEqual({ messages: [], nextPageToken: undefined });
    expect(mocks.callGmailSpy).not.toHaveBeenCalled();
  });

  test("short-circuits Later search without calling Gmail when no visible snoozes exist", async () => {
    mocks.countVisibleMailSnoozes.mockResolvedValue(0);

    const result = await queriesMailOperations.listThreads({
      context: { userId: "user-1" },
      input: {
        category: "later",
        mailboxId: "mbx-1",
        maxResults: 20,
        query: "invoice",
      },
    });

    expect(result).toStrictEqual({ messages: [] });
    expect(mocks.callGmailSpy).not.toHaveBeenCalled();
  });

  test.each(["later", "done"] as const)(
    "caps %s search scans at 5 pages and preserves nextPageToken",
    async (category) => {
      mocks.countVisibleMailSnoozes.mockResolvedValue(2);
      mocks.filterMailSnoozeVisibility.mockResolvedValue(new Set());
      const listSpy = vi
        .spyOn(gmail, "listMessagesWithDetails")
        .mockImplementation(async (_token, options) => {
          const next = Number(options?.pageToken ?? "0") + 1;
          const message: MessageListItem = {
            id: `msg-${next}`,
            labelIds: [],
            threadId: `thread-${next}`,
          };
          return await Promise.resolve({
            historyId: "100",
            messages: [message],
            nextPageToken: String(next),
          });
        });

      const result = await queriesMailOperations.listThreads({
        context: { userId: "user-1" },
        input: {
          category,
          mailboxId: "mbx-1",
          maxResults: 20,
          query: "invoice",
        },
      });

      expect(listSpy).toHaveBeenCalledTimes(5);
      expect(result).toMatchObject({
        messages: [],
        nextPageToken: "5",
      });
    }
  );
});
