/* oxlint-disable eslint/require-await -- Provider test doubles keep async contracts without network I/O. */
import type {
  getMessageWithDetails,
  listGmailCaptureHistoryPage,
  listGmailMessageIds,
} from "@quieter/gmail";
import type { MailCaptureHistoryPage } from "@quieter/mail/capture";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { captureMailboxMessageMemory } from "../src/ai-memory-capture";
import { processGmailMessage } from "../src/gmail-sync/message";
import { processGmailPubSubNotification } from "../src/gmail-sync/service";
import type { enqueueGmailMessageWork } from "../src/gmail-sync/work-store";
import type { enqueueMailAgentMessage } from "../src/mail-agent/inbox";
import type { observeReminderMail } from "../src/reminders/service";
import type { processMailVerificationCode } from "../src/verification-codes";

const fixtures = vi.hoisted(() => ({
  capture: {
    historyId: "99",
    historyPageToken: null,
    leaseExpiresAt: null,
    pendingHistoryPage: null as MailCaptureHistoryPage | null,
    phase: "history",
  },
  enqueue: vi.fn<typeof enqueueMailAgentMessage>(),
  enqueueWork: vi.fn<typeof enqueueGmailMessageWork>(),
  history: vi.fn<typeof listGmailCaptureHistoryPage>(),
  list: vi.fn<typeof listGmailMessageIds>(),
  message: vi.fn<typeof getMessageWithDetails>(),
  processCode: vi.fn<typeof processMailVerificationCode>(),
  state: {
    historyId: "101",
    historyPageToken: null,
    lastProcessedAt: null,
    lastReconciledAt: null,
    mailboxId: "mailbox",
    recoveryAfter: null as Date | null,
    recoveryBefore: null as Date | null,
    recoveryPageToken: null,
  },
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake models rollback of the mailbox checkpoint writes.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const db = {
    insert: () => ({ values: () => ({ onConflictDoNothing: () => {} }) }),
    select: (fields?: Record<string, unknown>) => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        const query = {
          leftJoin: () => query,
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
            if (name !== "gmailWatchState") {
              return [];
            }
            return fields?.capture === undefined
              ? [fixtures.state]
              : [{ capture: fixtures.capture, watch: fixtures.state }];
          },
          orderBy: () => query,
          where: () => query,
        };
        return query;
      },
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: object) => ({
        where: () => {
          const state =
            getTableName(table) === "gmailCaptureState"
              ? fixtures.capture
              : fixtures.state;
          Object.assign(state, values);
          return { returning: () => [{ mailboxId: "mailbox" }] };
        },
      }),
    }),
  };
  return {
    db: {
      ...db,
      transaction: async (run: (tx: typeof db) => Promise<unknown>) => {
        const capture = { ...fixtures.capture };
        const watch = { ...fixtures.state };
        try {
          return await run(db);
        } catch (error) {
          Object.assign(fixtures.capture, capture);
          Object.assign(fixtures.state, watch);
          throw error;
        }
      },
    },
  };
});
vi.mock(import("@quieter/gmail"), async (importOriginal) => ({
  ...(await importOriginal()),
  getMessageWithDetails: fixtures.message,
  listGmailCaptureHistoryPage: fixtures.history,
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
vi.mock(import("../src/gmail-sync/work-store"), () => ({
  deferGmailMailboxProvider: async (_mailboxId: string, retryAt: Date) =>
    retryAt,
  enqueueGmailMessageWork: fixtures.enqueueWork,
  getGmailMailboxProviderRetryAt: async () => null,
  hasPendingFreshGmailWork: async () => false,
}));
vi.mock(import("../src/mail-capture"), () => ({
  processGmailMailCapture: async () => ({
    busy: false,
    needsContinuation: false,
  }),
}));
vi.mock(import("../src/mailbox-changes"), () => ({
  appendMailboxChange: async (_tx, { mailboxId }) => ({
    queued: true,
    recipientUserIds: undefined,
    update: {
      eventId: crypto.randomUUID(),
      mailboxId,
      type: "mailbox.changed",
    },
  }),
  publishMailboxChange: async () => {},
}));
vi.mock(import("../src/reminders/service"), () => ({
  observeReminderMail: vi.fn<typeof observeReminderMail>().mockResolvedValue(),
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
  historyId: "105",
  pubSubMessageId: "notification",
};

describe("Gmail action receive acknowledgement", () => {
  beforeEach(() => {
    Object.assign(fixtures.capture, {
      historyId: "99",
      historyPageToken: null,
      pendingHistoryPage: null,
    });
    Object.assign(fixtures.state, {
      historyId: "101",
      historyPageToken: null,
      lastProcessedAt: null,
      lastReconciledAt: null,
      recoveryAfter: null,
      recoveryBefore: null,
      recoveryPageToken: null,
    });
    fixtures.enqueue.mockReset().mockResolvedValue();
    fixtures.enqueueWork.mockReset().mockResolvedValue();
    fixtures.history.mockReset().mockResolvedValue({
      changes: [
        { kind: "added", messageId: "inbound", providerRevision: "105" },
      ],
      historyExpired: false,
      historyId: "105",
      lastRecordHistoryId: "105",
      nextPageToken: null,
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
    fixtures.processCode.mockReset().mockResolvedValue({ status: "complete" });
  });

  afterEach(() => vi.restoreAllMocks());

  test("enqueues new inbound independently of label and code processing, excluding sent and draft mail", async () => {
    fixtures.history.mockResolvedValue({
      changes: [
        {
          kind: "added",
          messageId: "before-automation-cursor",
          providerRevision: "100",
        },
        ...["inbound", "sent", "draft"].map((messageId) => ({
          kind: "added" as const,
          messageId,
          providerRevision: "105",
        })),
      ],
      historyExpired: false,
      historyId: "105",
      lastRecordHistoryId: "105",
      nextPageToken: null,
    });
    await expect(
      processGmailPubSubNotification(notification)
    ).resolves.toMatchObject({ ignored: false });
    for (const [job] of fixtures.enqueueWork.mock.calls) {
      for (const messageId of job.messageIds) {
        await processGmailMessage({
          accessToken: "mail-token",
          autoLabelEnabled: false,
          automationRuntime: {
            getAutoLabelContext: async () => ({
              availableLabelIds: new Set<string>(),
              getMemoryCandidates: async () => await Promise.resolve(null),
              historyLabels: [],
              labels: [],
              model: "unused",
            }),
            getBudgetStatus: async () => ({ allowed: true, reason: "allowed" }),
          },
          extractCodes: false,
          gmailMessageId: messageId,
          mailboxId: job.mailboxId,
          organizationId: null,
          recovering: job.source === "catchup",
          triggerActions: job.triggerActions,
          userId: "owner",
        });
      }
    }
    expect(fixtures.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ mailboxId: "mailbox", messageId: "inbound" })
    );
    expect(
      fixtures.capture.pendingHistoryPage?.changes.map(
        (change) => change.messageId
      )
    ).toContain("before-automation-cursor");
    expect(fixtures.state.historyId).toBe("105");
  });

  test("preserves the cursor when durable enqueue fails so redelivery can retry", async () => {
    fixtures.enqueueWork.mockRejectedValueOnce(new Error("Inbox unavailable"));
    await expect(processGmailPubSubNotification(notification)).rejects.toThrow(
      "Inbox unavailable"
    );
    expect(fixtures.state.historyId).toBe("101");
    expect(fixtures.capture.pendingHistoryPage).toBeNull();
    await expect(
      processGmailPubSubNotification(notification)
    ).resolves.toMatchObject({ ignored: false });
    expect(fixtures.state.historyId).toBe("105");
  });

  test("never treats historical recovery as a newly received message", async () => {
    fixtures.history.mockResolvedValue({
      changes: [],
      historyExpired: false,
      historyId: "105",
      lastRecordHistoryId: null,
      nextPageToken: null,
    });
    fixtures.state.recoveryAfter = new Date(Date.now() - 60_000);
    fixtures.state.recoveryBefore = new Date();
    await expect(
      processGmailPubSubNotification(notification)
    ).resolves.toMatchObject({ ignored: false });
    expect(fixtures.list.mock.calls.length).toBeGreaterThan(0);
    expect(
      fixtures.enqueueWork.mock.calls.some(([job]) =>
        job.messageIds.includes("historical")
      )
    ).toBeTruthy();
    expect(
      fixtures.enqueueWork.mock.calls
        .filter(([job]) => job.messageIds.length > 0)
        .every(([job]) => job.triggerActions !== true)
    ).toBeTruthy();
    expect(fixtures.enqueue).not.toHaveBeenCalled();
  });
});
