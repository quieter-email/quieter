import { ORPCError } from "@orpc/server";
import type * as DatabaseClientModule from "@quieter/database/client";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { composeMailOperations } from "../src/mail/compose";
import { labelsMailOperations } from "../src/mail/labels";
import { mutationsMailOperations } from "../src/mail/mutations";
import { resolveComposeSourceDraftId } from "../src/scheduled-send/reservation";
import {
  createScheduledSend,
  recoverScheduledSendAttempt,
} from "../src/scheduled-send/service";

const fixture = vi.hoisted(() => ({
  access: vi.fn<() => Promise<unknown>>(),
  gmail: vi.fn<() => Promise<never>>(),
  importance: vi.fn<() => Promise<never>>(),
  query: vi.fn<() => Promise<{ rows: unknown[][] }>>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- This authorization boundary includes the provider that the staged schema does not yet admit.
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: fixture.access,
}));
vi.mock(import("../src/gmail-request"), () => ({ callGmail: fixture.gmail }));
vi.mock(import("../src/mail-importance"), async (original) => ({
  ...(await original()),
  setMailImportance: fixture.importance,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy observes SQL without a database connection.
vi.mock("@quieter/database/client", async (original) => {
  const actual = await original<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(fixture.query) };
});

const context = { userId: "owner" };
const message = {
  attachments: [],
  bodyHtml: "<p>Draft</p>",
  bodyText: "Draft",
  inlineImages: [],
  localId: "local",
  recipients: { bcc: "", cc: "", to: "recipient@example.test" },
  saveStatus: "saved",
  subject: "Subject",
  updatedAt: Date.now(),
};
const cases = [
  async () =>
    await recoverScheduledSendAttempt({
      mailboxId: "private",
      sendOperationId: "send",
      userId: "owner",
    }),
  async () =>
    await createScheduledSend({
      mailboxId: "private",
      message,
      sendAt: new Date(Date.now() + 3_600_000).toISOString(),
      timeZone: "UTC",
      userId: "owner",
    }),
  async () =>
    await labelsMailOperations.createLabel({
      context,
      input: { mailboxId: "private", name: "Example" },
    }),
  async () =>
    await labelsMailOperations.deleteLabel({
      context,
      input: { labelId: "Example", mailboxId: "private" },
    }),
  async () =>
    await labelsMailOperations.updateLabel({
      context,
      input: { labelId: "Example", mailboxId: "private", name: "Updated" },
    }),

  async () =>
    await mutationsMailOperations.markMessageAsRead({
      context,
      input: { mailboxId: "private", messageId: "message" },
    }),
  async () =>
    await mutationsMailOperations.markThreadAsRead({
      context,
      input: { mailboxId: "private", threadId: "thread" },
    }),
  async () =>
    await mutationsMailOperations.applyChanges({
      context,
      input: {
        command: { important: true, kind: "set-importance" },
        mailboxId: "private",
        targets: [{ messageIds: ["message"], threadId: "thread" }],
      },
    }),
  async () =>
    await composeMailOperations.deleteDraft({
      context,
      input: { draftId: "draft", mailboxId: "private" },
    }),
  async () =>
    await composeMailOperations.saveDraft({
      context,
      input: { draft: message, mailboxId: "private" },
    }),
  async () =>
    await composeMailOperations.sendMessage({
      context,
      input: { mailboxId: "private", message },
    }),
  async () =>
    await composeMailOperations.sendDraft({
      context,
      input: { draft: message, mailboxId: "private" },
    }),
  async () =>
    await composeMailOperations.getComposeSendStatus({
      context,
      input: { mailboxId: "private", sendOperationId: "send" },
    }),
  async () =>
    await composeMailOperations.unsubscribeFromMessage({
      context,
      input: { mailboxId: "private", messageId: "message" },
    }),
];

describe("Outlook read-only application boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "outlook" }),
      contentRevision: 0,
      id: "private",
      organizationId: "team",
      provider: "outlook",
    });
    fixture.query.mockResolvedValue({ rows: [] });
  });

  test("rejects unsupported draft reservation before looking up an existing identity", async () => {
    await expect(
      resolveComposeSourceDraftId({
        draftId: "existing",
        localId: "local",
        mailboxId: "private",
        provider: "outlook",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.query).not.toHaveBeenCalled();
  });

  test.each(cases)(
    "rejects an authorized unsupported action before SQL, importance or Gmail processing",
    async (run) => {
      await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.gmail).not.toHaveBeenCalled();
      expect(fixture.importance).not.toHaveBeenCalled();
      expect(fixture.query).not.toHaveBeenCalled();
    }
  );

  test.each(cases)(
    "preserves private denial before revealing provider capabilities",
    async (run) => {
      fixture.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
      await expect(run()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fixture.gmail).not.toHaveBeenCalled();
      expect(fixture.query).not.toHaveBeenCalled();
    }
  );
});
