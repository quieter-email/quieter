/* oxlint-disable eslint/require-await -- Provider test doubles keep async contracts without network I/O. */
import type {
  getMessageWithDetails,
  listGmailAddedMessageHistoryPage,
  listGmailMessageIds,
} from "@quieter/gmail";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
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
import type { writeGmailCapturedMessage } from "../src/mail-capture";
import type { observeReminderMail } from "../src/reminders/service";
import type { handleSnoozeInbound } from "../src/snooze/service";
import type { processMailVerificationCode } from "../src/verification-codes";

const fixtures = vi.hoisted(() => ({
  enqueue: vi.fn<typeof enqueueMailAgentMessage>(),
  enqueueWork: vi.fn<typeof enqueueGmailMessageWork>(),
  history: vi.fn<typeof listGmailAddedMessageHistoryPage>(),
  list: vi.fn<typeof listGmailMessageIds>(),
  message: vi.fn<typeof getMessageWithDetails>(),
  processCode: vi.fn<typeof processMailVerificationCode>(),
  snooze: vi.fn<typeof handleSnoozeInbound>(),
  state: {
    historyId: "before-receive",
    historyPageToken: null,
    lastProcessedAt: null,
    mailboxId: "mailbox",
    recoveryAfter: null as Date | null,
    recoveryBefore: null as Date | null,
    recoveryPageToken: null,
  },
  writeCapture: vi.fn<typeof writeGmailCapturedMessage>(),
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
    input: { mailboxId: string },
    run: (
      token: string,
      identity: { googleSubject: string; mailboxId: string }
    ) => Promise<Result>
  ) =>
    await run("mail-token", {
      googleSubject: "fixture-subject",
      mailboxId: input.mailboxId,
    }),
}));
vi.mock(import("../src/mail-agent/inbox"), () => ({
  enqueueMailAgentMessage: fixtures.enqueue,
}));
vi.mock(import("../src/gmail-sync/work-store"), () => ({
  deferGmailMailboxProvider: async (_mailboxId: string, retryAt: Date) =>
    retryAt,
  enqueueGmailMessageWork: fixtures.enqueueWork,
  getGmailMailboxProviderRetryAt: async () => null,
  hasPendingFreshGmailWorkForAccount: async () => false,
}));
vi.mock(import("../src/mail-capture"), () => ({
  processGmailMailCapture: async () => ({
    busy: false,
    needsContinuation: false,
  }),
  writeGmailCapturedMessage: fixtures.writeCapture,
}));
vi.mock(import("../src/snooze/service"), () => ({
  handleSnoozeInbound: fixtures.snooze,
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
    fixtures.enqueue
      .mockReset()
      .mockResolvedValue({ admitted: 1, status: "handed_off" });
    fixtures.enqueueWork.mockReset().mockResolvedValue();
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
    fixtures.processCode.mockReset().mockResolvedValue({ status: "complete" });
    fixtures.snooze.mockReset().mockResolvedValue();
    fixtures.writeCapture.mockReset().mockResolvedValue();
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
    for (const [job] of fixtures.enqueueWork.mock.calls) {
      for (const messageId of job.messageIds) {
        await processGmailMessage({
          accessToken: "mail-token",
          autoLabelEnabled: false,
          automationRuntime: {
            getAutoLabelContext: async () => ({
              availableLabelIds: new Set<string>(),
              historyLabels: [],
              labels: [],
              memoryCandidates: null,
              model: "unused",
            }),
            getBudgetStatus: async () => ({ allowed: true, reason: "allowed" }),
          },
          extractCodes: false,
          gmailMessageId: messageId,
          identity: {
            googleSubject: "fixture-subject",
            mailboxId: job.mailboxId,
          },
          mailboxId: job.mailboxId,
          organizationId: null,
          triggerActions: job.triggerActions,
          userId: "owner",
        });
      }
    }
    expect(fixtures.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ mailboxId: "mailbox", messageId: "inbound" })
    );
    expect(fixtures.state.historyId).toBe("after-receive");
  });

  test("preserves the cursor when durable enqueue fails so redelivery can retry", async () => {
    fixtures.enqueueWork.mockRejectedValueOnce(new Error("Inbox unavailable"));
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

  test.each([true, false])(
    "requires successful canonical capture before observing Snooze when capture succeeds: %s",
    async (succeeds) => {
      const snapshot: CapturedMailSnapshot = {
        attachments: [],
        bodyHtml: null,
        bodyText: "New reply",
        headers: [],
        id: "inbound",
        internalDate: String(Date.now()),
        labelIds: ["INBOX"],
        providerRevision: "2",
        threadId: "thread",
        truncation: {
          attachments: false,
          bodyHtml: false,
          bodyText: false,
          headers: false,
        },
      };
      fixtures.message.mockImplementation(
        async (_token, _messageId, _options, capture) => {
          await capture?.(snapshot);
          return {
            id: snapshot.id,
            internalDate: snapshot.internalDate ?? undefined,
            labelIds: snapshot.labelIds,
            threadId: snapshot.threadId,
          };
        }
      );
      const started = Promise.withResolvers<boolean>();
      const persistence = Promise.withResolvers<boolean>();
      let persisted = false;
      fixtures.writeCapture.mockImplementation(async () => {
        started.resolve(true);
        await persistence.promise;
        persisted = true;
      });
      const observed: string[] = [];
      fixtures.snooze.mockImplementation(async ({ messageId }) => {
        if (!persisted) {
          throw new Error("Snooze observed before persistence.");
        }
        observed.push(messageId);
      });

      const processing = processGmailMessage({
        accessToken: "mail-token",
        autoLabelEnabled: false,
        automationRuntime: {
          getAutoLabelContext: async () => ({
            availableLabelIds: new Set<string>(),
            historyLabels: [],
            labels: [],
            memoryCandidates: null,
            model: "unused",
          }),
          getBudgetStatus: async () => {
            throw new Error("AI credits are unavailable.");
          },
        },
        extractCodes: false,
        gmailMessageId: snapshot.id,
        identity: { googleSubject: "fixture-subject", mailboxId: "mailbox" },
        mailboxId: "mailbox",
        organizationId: null,
        triggerActions: false,
        userId: "owner",
      });
      await started.promise;
      expect(observed).toHaveLength(0);
      if (succeeds) {
        persistence.resolve(true);
      } else {
        persistence.reject(new Error("Capture unavailable"));
      }
      const result = await processing.then(
        () => "success",
        () => "capture-failed"
      );
      expect(result).toBe(succeeds ? "success" : "capture-failed");
      expect(observed).toHaveLength(succeeds ? 1 : 0);
    }
  );
});
