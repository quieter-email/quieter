import { ORPCError } from "@orpc/server";
import { mailbox, mailboxAutomationSettings } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { labelExistingMailboxInboxBatch } from "../src/mail-automation/backfill";
import { queueRows, resetQueues } from "./helpers/fake-database";

type BatchResult = {
  labeled: number;
  nextPageToken: string | null;
  scanned: number;
};

const services = vi.hoisted(() => ({
  access:
    vi.fn<
      () => Promise<{ organizationId: string; provider: "gmail" | "managed" }>
    >(),
  budget: vi.fn<() => Promise<void>>(),
  gmail: vi.fn<(input: { onApplied?: () => void }) => Promise<BatchResult>>(),
  managed: vi.fn<(input: { onApplied?: () => void }) => Promise<BatchResult>>(),
  manager: vi.fn<() => Promise<void>>(),
  publish: vi.fn<() => Promise<void>>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake intentionally implements only the database methods used by this operation.
vi.mock("@quieter/database/client", async () => {
  const { createFakeDatabaseModule } = await import("./helpers/fake-database");
  return createFakeDatabaseModule();
});
vi.mock(import("../src/gmail-sync/service"), () => ({
  labelExistingGmailInboxBatch: services.gmail,
}));
vi.mock(import("../src/managed-mail/automation"), () => ({
  labelExistingManagedInboxBatch: services.managed,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Authorization mocks return the relevant access fields only.
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: services.access,
  getAuthorizedManagedMailbox: services.manager,
}));
vi.mock(import("../src/mail-automation/ai-budget"), () => ({
  assertMailAutomationAiBudget: services.budget,
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: services.publish,
}));

describe("existing Inbox automatic labeling authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetQueues();
    services.access.mockResolvedValue({
      organizationId: "team-1",
      provider: "gmail",
    });
    services.gmail.mockResolvedValue({
      labeled: 0,
      nextPageToken: "next",
      scanned: 10,
    });
  });

  test("rejects an inaccessible mailbox before processing messages", async () => {
    services.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      labelExistingMailboxInboxBatch({ mailboxId: "private", userId: "other" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(services.gmail).not.toHaveBeenCalled();
    expect(services.publish).not.toHaveBeenCalled();
    expect(services.managed).not.toHaveBeenCalled();
  });

  test("requires manager access to managed mailboxes", async () => {
    services.access.mockResolvedValue({
      organizationId: "team-1",
      provider: "managed",
    });
    services.manager.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      labelExistingMailboxInboxBatch({ mailboxId: "shared", userId: "reader" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(services.managed).not.toHaveBeenCalled();
    expect(services.manager).toHaveBeenCalledWith(
      expect.objectContaining({ requiredRoles: ["manager"] })
    );
  });

  test("does not label messages when automation is disabled", async () => {
    queueRows(mailboxAutomationSettings, [{ enabled: false }]);
    await expect(
      labelExistingMailboxInboxBatch({
        mailboxId: "mailbox-1",
        userId: "owner",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(services.gmail).not.toHaveBeenCalled();
  });

  test("preserves a budget failure before invoking the classifier", async () => {
    queueRows(mailboxAutomationSettings, [{ enabled: true }]);
    services.budget.mockRejectedValue(
      new ORPCError("FORBIDDEN", { message: "Usage balance is exhausted." })
    );
    await expect(
      labelExistingMailboxInboxBatch({
        mailboxId: "mailbox-1",
        userId: "owner",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Usage balance is exhausted.",
    });
    expect(services.gmail).not.toHaveBeenCalled();
  });

  test("keeps the scan cutoff across batches while advancing pagination", async () => {
    queueRows(mailboxAutomationSettings, [{ enabled: true }]);
    const cursor = {
      before: new Date(Date.now() - 1000).toISOString(),
      pageToken: "previous",
      scanned: 20,
    };
    const result = await labelExistingMailboxInboxBatch({
      cursor,
      mailboxId: "mailbox-1",
      userId: "owner",
    });
    expect(result.cursor).toMatchObject({
      before: cursor.before,
      pageToken: "next",
    });
    expect(services.gmail).toHaveBeenCalledWith(
      expect.objectContaining({
        before: cursor.before,
        mailboxId: "mailbox-1",
        pageToken: "previous",
      })
    );
  });

  test.each(["gmail", "managed"] as const)(
    "publishes completed applications after a later %s batch failure",
    async (provider) => {
      services.access.mockResolvedValue({ organizationId: "team-1", provider });
      queueRows(mailboxAutomationSettings, [{ enabled: true }]);
      if (provider === "managed") {
        queueRows(mailbox, []);
      }
      const failure = new Error("Next message could not be labeled.");
      const process = provider === "gmail" ? services.gmail : services.managed;
      process.mockImplementation((input: { onApplied?: () => void }) => {
        input.onApplied?.();
        throw failure;
      });
      await expect(
        labelExistingMailboxInboxBatch({
          mailboxId: "mailbox-1",
          userId: "owner",
        })
      ).rejects.toBe(failure);
      expect(services.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          mailboxId: "mailbox-1",
          type: "mailbox.changed",
        })
      );
    }
  );

  test("does not publish when a batch fails before applying any label", async () => {
    queueRows(mailboxAutomationSettings, [{ enabled: true }]);
    services.gmail.mockRejectedValue(new Error("No messages changed."));
    await expect(
      labelExistingMailboxInboxBatch({
        mailboxId: "mailbox-1",
        userId: "owner",
      })
    ).rejects.toThrow(/No messages changed/u);
    expect(services.publish).not.toHaveBeenCalled();
  });

  test("ends a run at its scan cap even when the provider has another page", async () => {
    queueRows(mailboxAutomationSettings, [{ enabled: true }]);
    services.gmail.mockResolvedValue({
      labeled: 0,
      nextPageToken: "more",
      scanned: 3,
    });
    const result = await labelExistingMailboxInboxBatch({
      cursor: {
        before: new Date().toISOString(),
        pageToken: "last",
        scanned: 97,
      },
      mailboxId: "mailbox-1",
      userId: "owner",
    });
    expect(result.cursor).toBeNull();
    expect(services.gmail).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 })
    );
  });

  test("rejects historical cursors before scanning messages", async () => {
    queueRows(mailboxAutomationSettings, [{ enabled: true }]);
    await expect(
      labelExistingMailboxInboxBatch({
        cursor: {
          before: "2020-01-01T00:00:00.000Z",
          pageToken: "old",
          scanned: 0,
        },
        mailboxId: "mailbox-1",
        userId: "owner",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(services.gmail).not.toHaveBeenCalled();
  });
});
