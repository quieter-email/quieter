/* oxlint-disable vitest/prefer-import-in-mock -- Only sync dependencies are mocked from the larger query module. */
import { ORPCError } from "@orpc/server";
import type { getMailboxSyncDelta } from "@quieter/gmail";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { hydrateUnsubscribeStatus } from "../src/gmail-compose";
import type { callGmail } from "../src/gmail-request";
import { queriesMailOperations } from "../src/mail/queries";

const fixtures = vi.hoisted(() => ({
  authorize:
    vi.fn<() => Promise<{ contentRevision: number; provider: "gmail" }>>(),
  delta: vi.fn<typeof getMailboxSyncDelta>(),
  hydrate: vi.fn<typeof hydrateUnsubscribeStatus>(),
  provider: vi.fn<typeof callGmail>(),
}));

vi.mock("@quieter/database/client", () => ({}));
vi.mock("@quieter/gmail", () => ({ getMailboxSyncDelta: fixtures.delta }));
vi.mock("@quieter/gmail/compose", () => ({}));
vi.mock("@quieter/observability", () => ({}));
vi.mock("../src/ai-memory-capture", () => ({}));
vi.mock("../src/gmail-compose", () => ({
  hydrateUnsubscribeStatus: fixtures.hydrate,
}));
vi.mock("../src/gmail-open-tracking", () => ({}));
vi.mock("../src/gmail-request", () => ({ callGmail: fixtures.provider }));
vi.mock("../src/mail-capture", () => ({}));
vi.mock("../src/mail-domain/service", () => ({}));
vi.mock("../src/mail-importance", () => ({
  hydrateMailImportance: fixtures.hydrate,
}));
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: fixtures.authorize,
}));
vi.mock("../src/managed-mail/messages/attachments", () => ({}));
vi.mock("../src/managed-mail/messages/get-draft", () => ({}));
vi.mock("../src/managed-mail/messages/service", () => ({}));
vi.mock("../src/organization-api-mail", () => ({
  isOrganizationApiMailboxId: () => false,
}));
vi.mock("../src/reminders/draft-state", () => ({}));

const sync = async (startHistoryId: string) =>
  await queriesMailOperations.syncMailbox({
    context: { userId: "user" },
    input: { category: "inbox", mailboxId: "mailbox", startHistoryId },
  });

describe("mail sync checkpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixtures.authorize.mockResolvedValue({
      contentRevision: 2,
      provider: "gmail",
    });
    fixtures.delta.mockResolvedValue({
      hasChanges: false,
      historyId: "11",
      refreshFirstPage: false,
      removedMessageIds: [],
      requiresFullRefresh: false,
      updatedMessages: [],
    });
    fixtures.hydrate.mockResolvedValue([]);
    fixtures.provider.mockImplementation(
      async (_context, _mailboxId, operation) => await operation("access-token")
    );
  });

  test("a changed app checkpoint requests reconciliation without fetching discarded provider data", async () => {
    fixtures.provider.mockReturnValue(Promise.withResolvers<never>().promise);
    const result = await sync("gmail:10:1");
    expect(result.requiresFullRefresh).toBeTruthy();
    expect(result.hasChanges).toBeTruthy();
    expect(result.historyId).toBeUndefined();
    expect(fixtures.provider).not.toHaveBeenCalled();
    expect(fixtures.hydrate).not.toHaveBeenCalled();
  });

  test.each(["gmail:10:2", "10", "gmail:invalid:1"])(
    "preserves provider recovery for %s",
    async (checkpoint) => {
      await sync(checkpoint);
      expect(fixtures.provider).toHaveBeenCalledOnce();
      expect(fixtures.delta).toHaveBeenCalledWith(
        "access-token",
        expect.objectContaining({
          startHistoryId: checkpoint === "gmail:10:2" ? "10" : checkpoint,
        })
      );
    }
  );

  test("authorization denial prevents all provider work", async () => {
    fixtures.authorize.mockRejectedValue(new ORPCError("FORBIDDEN"));
    await expect(sync("gmail:10:1")).rejects.toThrow(/forbidden/iu);
    expect(fixtures.provider).not.toHaveBeenCalled();
  });

  test("provider failures still propagate when the app checkpoint matches", async () => {
    const failure = new Error("provider unavailable");
    fixtures.provider.mockRejectedValue(failure);
    await expect(sync("gmail:10:2")).rejects.toBe(failure);
  });
});
