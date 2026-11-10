import type { gmailMessageWork } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { runAuthorizedGmailMailbox } from "../src/gmail-mailbox-access";
import type { processGmailMessage } from "../src/gmail-sync/message";
import {
  discoverFreshGmailMessages,
  processNextGmailMessageWork,
} from "../src/gmail-sync/work";
import type {
  claimGmailMessageWork,
  deferGmailMailboxProvider,
  enqueueGmailMessageWork,
  hasPendingFreshGmailWorkForAccount,
  listGmailMessageWorkWakeJobs,
  finishGmailMessageWork,
  getGmailMessageWorkWake,
  getGmailMailboxProviderRetryAt,
} from "../src/gmail-sync/work-store";

const fixtures = vi.hoisted(() => ({
  authorize: vi.fn<() => void>(),
  claim: vi.fn<typeof claimGmailMessageWork>(),
  deferProvider: vi.fn<typeof deferGmailMailboxProvider>(),
  finish: vi.fn<typeof finishGmailMessageWork>(),
  process: vi.fn<typeof processGmailMessage>(),
  providerRetryAt: vi.fn<typeof getGmailMailboxProviderRetryAt>(),
  wake: vi.fn<typeof getGmailMessageWorkWake>(),
}));

vi.mock(import("../src/gmail-sync/work-store"), () => ({
  claimGmailMessageWork: fixtures.claim,
  deferGmailMailboxProvider: fixtures.deferProvider,
  enqueueGmailMessageWork: vi.fn<typeof enqueueGmailMessageWork>(),
  finishGmailMessageWork: fixtures.finish,
  getGmailMailboxProviderRetryAt: fixtures.providerRetryAt,
  getGmailMessageWorkWake: fixtures.wake,
  hasPendingFreshGmailWorkForAccount:
    vi.fn<typeof hasPendingFreshGmailWorkForAccount>(),
  listGmailMessageWorkWakeJobs: vi.fn<typeof listGmailMessageWorkWakeJobs>(),
}));
vi.mock(import("../src/gmail-sync/message"), () => ({
  processGmailMessage: fixtures.process,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the query methods used by this orchestration boundary are replaced.
vi.mock("@quieter/database/client", () => ({
  db: {
    select: () => {
      const query = {
        from: () => query,
        leftJoin: () => query,
        limit: () => [
          {
            account: {
              id: "mailbox",
              organizationId: "organization",
              ownerUserId: "current-owner",
              status: "connected",
            },
            id: "mailbox",
            ownerUserId: "current-owner",
            settings: { autoLabelEnabled: true },
          },
        ],
        where: () => query,
      };
      return query;
    },
  },
}));
vi.mock(import("../src/gmail-mailbox-access"), () => ({
  runAuthorizedGmailMailbox: async <T>(
    _input: Parameters<typeof runAuthorizedGmailMailbox>[0],
    operation: (accessToken: string) => Promise<T>
  ) => {
    fixtures.authorize();
    return await operation("current-token");
  },
}));

const work = (): typeof gmailMessageWork.$inferSelect => ({
  actionsCompletedAt: null,
  attempts: 1,
  completedAt: null,
  createdAt: new Date(),
  dueAt: new Date(),
  gmailMessageId: "message",
  id: "work",
  lastError: null,
  leaseToken: "claim-token",
  leaseUntil: new Date(Date.now() + 60_000),
  mailboxId: "mailbox",
  notificationReceivedAt: new Date(),
  position: 0,
  priorityAt: new Date(),
  source: "fresh",
  triggerActions: true,
  updatedAt: new Date(),
});

describe("Gmail message work", () => {
  beforeEach(() => {
    fixtures.claim
      .mockReset()
      .mockResolvedValue({ status: "claimed", work: work() });
    fixtures.deferProvider.mockReset().mockResolvedValue(new Date());
    fixtures.providerRetryAt.mockReset().mockResolvedValue(null);
    fixtures.authorize.mockReset();
    fixtures.finish.mockReset().mockResolvedValue();
    fixtures.wake
      .mockReset()
      .mockResolvedValue({ moreReady: false, nextWakeAt: null });
    fixtures.process.mockReset().mockResolvedValue({
      autoLabel: { status: "complete" },
      verificationCode: { status: "complete" },
    });
  });

  test("does not execute or finish a message claimed by another worker", async () => {
    fixtures.claim.mockResolvedValue({ status: "empty" });
    await expect(
      processNextGmailMessageWork({ priority: "fresh" })
    ).resolves.toMatchObject({ status: "idle" });
    expect(fixtures.process).not.toHaveBeenCalled();
    expect(fixtures.finish).not.toHaveBeenCalled();
  });

  test("retains a future capacity rescue without authorizing or reading ready work", async () => {
    const retryAt = new Date(Date.now() + 5000);
    fixtures.claim.mockResolvedValue({
      activeLeases: 4,
      retryAt,
      status: "capacity_busy",
    });
    fixtures.wake.mockResolvedValue({
      moreReady: true,
      nextWakeAt: new Date(),
    });
    const result = await processNextGmailMessageWork({ priority: "fresh" });
    expect(result).toMatchObject({
      moreReady: false,
      nextWakeAt: retryAt,
      status: "capacity_busy",
    });
    expect(result.nextWakeAt?.getTime()).toBeGreaterThan(Date.now());
    expect(fixtures.authorize).not.toHaveBeenCalled();
    expect(fixtures.process).not.toHaveBeenCalled();
    expect(fixtures.finish).not.toHaveBeenCalled();
    expect(fixtures.wake).not.toHaveBeenCalled();
  });

  test("runs pending work with the current owner and settings", async () => {
    await processNextGmailMessageWork({ priority: "fresh" });
    expect(fixtures.process).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "current-token",
        autoLabelEnabled: true,
        extractCodes: true,
        userId: "current-owner",
      })
    );
    expect(fixtures.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        actionsComplete: true,
        criticalComplete: true,
        leaseToken: "claim-token",
      })
    );
  });

  test("wakes for the earliest independent critical retry", async () => {
    const retryAt = new Date(Date.now() + 5000);
    fixtures.process.mockResolvedValue({
      autoLabel: {
        reason: "budget",
        retryAt: new Date(Date.now() + 6 * 60 * 60_000),
        status: "retry",
      },
      verificationCode: {
        reason: "in_progress",
        retryAt,
        status: "retry",
      },
    });
    await expect(
      processNextGmailMessageWork({ priority: "fresh" })
    ).resolves.toMatchObject({ status: "retry" });
    expect(fixtures.finish).toHaveBeenCalledWith(
      expect.objectContaining({ criticalComplete: false, retryAt })
    );
  });

  test("publishes a mailbox provider cooldown when a message is throttled", async () => {
    const failure = Object.assign(new Error("Provider throttled"), {
      retryAfterMs: 60_000,
      status: 429,
    });
    const longerCooldown = new Date(Date.now() + 120_000);
    fixtures.process.mockRejectedValue(failure);
    fixtures.deferProvider.mockResolvedValue(longerCooldown);
    await expect(
      processNextGmailMessageWork({ priority: "fresh" })
    ).rejects.toBe(failure);
    expect(fixtures.deferProvider).toHaveBeenCalledWith(
      "mailbox",
      expect.any(Date)
    );
    expect(fixtures.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        criticalComplete: false,
        retryAt: longerCooldown,
      })
    );
  });

  test("defers fresh discovery before authorization while its mailbox is throttled", async () => {
    fixtures.providerRetryAt.mockResolvedValue(new Date(Date.now() + 60_000));
    await expect(
      discoverFreshGmailMessages({
        emailAddress: "owner@example.invalid",
        historyId: "1",
        pubSubMessageId: "notification",
      })
    ).rejects.toMatchObject({ status: 429 });
    expect(fixtures.authorize).not.toHaveBeenCalled();
  });

  test("finishes late action observations without rerunning completed critical work", async () => {
    fixtures.claim.mockResolvedValue({
      status: "claimed",
      work: { ...work(), completedAt: new Date() },
    });
    await processNextGmailMessageWork({ priority: "fresh" });
    expect(fixtures.process).toHaveBeenCalledWith(
      expect.objectContaining({
        autoLabelEnabled: false,
        extractCodes: false,
        triggerActions: true,
      })
    );
    expect(fixtures.finish).toHaveBeenCalledWith(
      expect.objectContaining({ actionsComplete: true, criticalComplete: true })
    );
  });

  test.each([false, true])(
    "preserves critical completion after a failed followup, actions requested %s",
    async (triggerActions) => {
      fixtures.claim.mockResolvedValue({
        status: "claimed",
        work: { ...work(), triggerActions },
      });
      const failure = new Error("Ancillary failure");
      fixtures.process.mockImplementation(async ({ onCriticalComplete }) => {
        await onCriticalComplete?.({
          autoLabelMs: 0,
          totalMs: 0,
          verificationCodeMs: 0,
        });
        throw failure;
      });
      await expect(
        processNextGmailMessageWork({ priority: "fresh" })
      ).rejects.toBe(failure);
      expect(fixtures.finish).toHaveBeenCalledWith(
        expect.objectContaining({
          actionsComplete: false,
          criticalComplete: true,
          lastError: failure.message,
        })
      );
      expect(fixtures.finish.mock.calls[0]?.[0].retryAt).toBeInstanceOf(Date);
      fixtures.claim.mockResolvedValue({
        status: "claimed",
        work: {
          ...work(),
          completedAt: new Date(),
          lastError: failure.message,
          triggerActions,
        },
      });
      fixtures.process.mockReset().mockResolvedValue({
        autoLabel: { status: "disabled" },
        verificationCode: { status: "disabled" },
      });
      await processNextGmailMessageWork({ priority: "catchup" });
      expect(fixtures.process).toHaveBeenCalledWith(
        expect.objectContaining({
          autoLabelEnabled: false,
          extractCodes: false,
          triggerActions,
        })
      );
      expect(fixtures.finish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          criticalComplete: true,
          lastError: null,
          retryAt: null,
        })
      );
    }
  );
});
