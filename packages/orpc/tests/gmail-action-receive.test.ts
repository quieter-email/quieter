/* oxlint-disable eslint/require-await -- Provider test doubles keep async contracts without network I/O. */
import type {
  getMessageWithDetails,
  listGmailAddedMessageHistoryPage,
  listGmailMessageIds,
} from "@quieter/gmail";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { captureMailboxMessageMemory } from "../src/ai-memory-capture";
import { processGmailPubSubNotification } from "../src/gmail-sync/service";
import type { enqueueMailAgentMessage } from "../src/mail-agent/inbox";
import type { processMailVerificationCode } from "../src/verification-codes";

const fixtures = vi.hoisted(() => ({
  enqueue: vi.fn<typeof enqueueMailAgentMessage>(),
  history: vi.fn<typeof listGmailAddedMessageHistoryPage>(),
  list: vi.fn<typeof listGmailMessageIds>(),
  message: vi.fn<typeof getMessageWithDetails>(),
  processCode: vi.fn<typeof processMailVerificationCode>(),
  state: {
    historyId: "before-receive",
    historyPageToken: null,
    lastProcessedAt: null,
    mailboxId: "mailbox",
    recoveryAfter: null as Date | null,
    recoveryBefore: null as Date | null,
    recoveryPageToken: null,
  },
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake maintains the single mailbox cursor used by these receive tests.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      insert: () => ({ values: () => ({ onConflictDoNothing: () => {} }) }),
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => {
          const name = getTableName(table);
          const query = {
            limit: () => {
              if (name === "mailbox") {
                return [
                  {
                    id: "mailbox",
                    organizationId: null,
                    ownerUserId: "owner",
                    status: "connected",
                  },
                ];
              }
              return name === "gmailWatchState" ? [fixtures.state] : [];
            },
            orderBy: () => query,
            where: () => query,
          };
          return query;
        },
      }),
      update: () => ({
        set: (values: object) => ({
          where: () => {
            Object.assign(fixtures.state, values);
            return { returning: () => [{ mailboxId: "mailbox" }] };
          },
        }),
      }),
    },
  };
});
vi.mock(import("@quieter/gmail"), async (importOriginal) => ({
  ...(await importOriginal()),
  getMessageWithDetails: fixtures.message,
  listGmailAddedMessageHistoryPage: fixtures.history,
  listGmailMessageIds: fixtures.list,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake supplies an already authorized provider token without OAuth I/O.
vi.mock("../src/gmail-mailbox-access", () => ({
  runAuthorizedGmailMailbox: async <Result>(
    _input: unknown,
    run: (token: string) => Promise<Result>
  ) => await run("mail-token"),
}));
vi.mock(import("../src/mail-agent/inbox"), () => ({
  enqueueMailAgentMessage: fixtures.enqueue,
}));
vi.mock(import("../src/ai-memory-capture"), async (original) => ({
  ...(await original()),
  captureMailboxMessageMemory: vi
    .fn<typeof captureMailboxMessageMemory>()
    .mockResolvedValue(null),
}));
vi.mock(import("../src/verification-codes"), () => ({
  listPendingMailboxVerificationCodeMessageIds: async () => [],
  processMailVerificationCode: fixtures.processCode,
  reportPendingMailboxVerificationCodeUsage: async () => {},
}));

const notification = {
  emailAddress: "owner@example.test",
  historyId: "after-receive",
  pubSubMessageId: "notification",
};

describe("Gmail action receive acknowledgement", () => {
  beforeEach(() => {
    Object.assign(fixtures.state, {
      historyId: "before-receive",
      historyPageToken: null,
      recoveryAfter: null,
      recoveryBefore: null,
      recoveryPageToken: null,
    });
    fixtures.enqueue.mockReset().mockResolvedValue();
    fixtures.history.mockReset().mockResolvedValue({
      hasMore: false,
      historyExpired: false,
      historyId: "after-receive",
      messageIds: ["inbound"],
    });
    fixtures.list.mockReset().mockResolvedValue({ messageIds: ["historical"] });
    const labels: Record<string, string[]> = {
      draft: ["DRAFT"],
      sent: ["SENT"],
    };
    fixtures.message
      .mockReset()
      .mockImplementation(async (_token, messageId) => ({
        id: messageId,
        internalDate: String(Date.now()),
        labelIds: labels[messageId] ?? [],
        threadId: "thread",
      }));
    fixtures.processCode.mockReset().mockResolvedValue();
  });

  afterEach(() => vi.restoreAllMocks());

  test("enqueues new inbound independently of label and code processing, excluding sent and draft mail", async () => {
    fixtures.history.mockResolvedValue({
      hasMore: false,
      historyExpired: false,
      historyId: "after-receive",
      messageIds: ["inbound", "sent", "draft"],
    });
    await expect(
      processGmailPubSubNotification(notification)
    ).resolves.toMatchObject({ ignored: false });
    expect(fixtures.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ mailboxId: "mailbox", messageId: "inbound" })
    );
    expect(fixtures.state.historyId).toBe("after-receive");
  });

  test("preserves the cursor when durable enqueue fails so redelivery can retry", async () => {
    fixtures.enqueue.mockRejectedValueOnce(new Error("Inbox unavailable"));
    await expect(processGmailPubSubNotification(notification)).rejects.toThrow(
      "Inbox unavailable"
    );
    expect(fixtures.state.historyId).toBe("before-receive");
    await expect(
      processGmailPubSubNotification(notification)
    ).resolves.toMatchObject({ ignored: false });
    expect(fixtures.state.historyId).toBe("after-receive");
  });

  test("never treats historical recovery as a newly received message", async () => {
    fixtures.history.mockResolvedValue({
      hasMore: false,
      historyExpired: false,
      historyId: "after-receive",
      messageIds: [],
    });
    fixtures.state.recoveryAfter = new Date(Date.now() - 60_000);
    fixtures.state.recoveryBefore = new Date();
    await expect(
      processGmailPubSubNotification(notification)
    ).resolves.toMatchObject({ ignored: false });
    expect(fixtures.list.mock.calls.length).toBeGreaterThan(0);
    expect(fixtures.enqueue).not.toHaveBeenCalled();
  });
});
