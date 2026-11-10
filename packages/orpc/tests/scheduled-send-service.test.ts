import { ORPCError } from "@orpc/server";
import { scheduledMailSend } from "@quieter/database/schema";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { getTableColumns } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { composeMailOperations } from "../src/mail/compose";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import {
  cancelScheduledSend,
  createScheduledSend,
  dispatchScheduledSend,
  validateScheduledSendTime,
} from "../src/scheduled-send/service";

const fixture = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  deleteDraft: vi.fn<typeof composeMailOperations.deleteDraft>(),
  getStatus: vi.fn<typeof composeMailOperations.getComposeSendStatus>(),
  originalDraft:
    vi.fn<() => Promise<{ messageId: string; baseRevision: string }>>(),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  readObject: vi.fn<() => Promise<Uint8Array>>(),
  saveDraft: vi.fn<typeof composeMailOperations.saveDraft>(),
  send: vi.fn<typeof composeMailOperations.sendMessage>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy replaces the driver for focused state-flow tests.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { db: drizzle(fixture.query) };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only provider boundaries used by scheduling are mocked.
vi.mock("../src/mail/compose", () => ({
  composeMailOperations: {
    deleteDraft: fixture.deleteDraft,
    getComposeSendStatus: fixture.getStatus,
    saveDraft: fixture.saveDraft,
    sendMessage: fixture.send,
  },
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: fixture.access,
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: vi.fn<() => Promise<void>>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the original-draft read boundary is needed.
vi.mock("../src/mail/queries", () => ({
  queriesMailOperations: { getDraft: fixture.originalDraft },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- This test replaces only the snapshot storage read.
vi.mock("../src/managed-mail/messages/raw-object", () => ({
  readRawMailObject: fixture.readObject,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the snapshot writer is needed.
vi.mock("../src/managed-mail/messages/raw-object-lifecycle", () => ({
  storeRawMailObject: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("../src/scheduled-send/wake"), () => ({
  requestScheduledSendWake: vi.fn<() => Promise<boolean>>(),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<() => void>(),
}));

const scope = {
  id: "861ba0bf-0069-410d-9ced-7881a5273464",
  mailboxId: "mailbox",
  userId: "owner",
};
let row: typeof scheduledMailSend.$inferSelect;

describe("scheduled send execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = {
      ...scope,
      createdAt: new Date(),
      draftRemovedAt: new Date(),
      errorMessage: null,
      leaseToken: null,
      leaseUntil: null,
      nextWakeAt: new Date(),
      payloadRetiredAt: null,
      rawObjectBucket: "fixture",
      rawObjectKey: "snapshot",
      rawObjectProvider: "r2",
      requestHash: "fixture-hash",
      restoredDraftId: null,
      sendAt: new Date(Date.now() + 86_400_000),
      sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
      sentAt: null,
      sourceDraftId: "draft",
      sourceLocalId: "local",
      status: "scheduled",
      subject: "Message",
      timeZone: "Europe/Berlin",
      to: "person@example.test",
      updatedAt: new Date(),
    };
    fixture.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: "mailbox",
      organizationId: "org",
      provider: "gmail",
    });
    fixture.getStatus.mockResolvedValue({ status: "pending" });
    fixture.readObject.mockRejectedValue(new Error("Storage unavailable"));
    // oxlint-disable-next-line eslint/require-await -- The asynchronous driver returns fixture rows without I/O.
    fixture.query.mockImplementation(async (query, params) => {
      if (query.startsWith('update "scheduledMailSend"')) {
        const assignment = query.split(" where ")[0] ?? "";
        for (const match of assignment.matchAll(
          /"(?<column>\w+)" = \$(?<position>\d+)/gu
        )) {
          const column = match.groups?.column;
          const position = Number(match.groups?.position);
          if (column) {
            const value = params[position - 1];
            const date = column.endsWith("At") || column.endsWith("Until");
            Reflect.set(
              row,
              column,
              date && typeof value === "string" ? new Date(value) : value
            );
          }
        }
      }
      const rows =
        query.startsWith("select") || query.includes(" returning ")
          ? [
              Object.keys(getTableColumns(scheduledMailSend)).map(
                (key) => Object.entries(row).find(([name]) => name === key)?.[1]
              ),
            ]
          : [];
      return { rows };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("does not submit a message before its due time", async () => {
    const result = await dispatchScheduledSend(scope);
    expect(result.nextWakeAt).toBeGreaterThan(Date.now());
    expect(fixture.send).not.toHaveBeenCalled();
    expect(row.status).toBe("scheduled");
  });

  test("retries unfinished preparation without falling through to sending early", async () => {
    row.status = "preparing";
    row.draftRemovedAt = null;
    const result = await dispatchScheduledSend(scope);
    expect(result.nextWakeAt).toBeGreaterThan(Date.now());
    expect(row.status).toBe("preparing");
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("keeps a missing original draft recoverable instead of activating another send", async () => {
    row.status = "preparing";
    row.draftRemovedAt = null;
    fixture.readObject.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          attachments: [],
          baseRevision: "revision",
          bodyHtml: "<p>Hello</p>",
          bodyText: "Hello",
          draftId: "original-draft",
          inlineImages: [],
          localId: "source",
          recipients: { bcc: "", cc: "", to: "person@example.test" },
          saveStatus: "saved",
          subject: "Message",
          updatedAt: Date.now(),
        })
      )
    );
    // oxlint-disable-next-line eslint/require-await -- The provider boundary reports the missing draft without I/O.
    fixture.deleteDraft.mockImplementation(async ({ requireExistingDraft }) => {
      if (requireExistingDraft === true) {
        throw new ORPCError("CONFLICT", {
          message: "The original draft is no longer available.",
        });
      }
      return { deleted: true };
    });
    const result = await dispatchScheduledSend(scope);
    expect(row.status).toBe("failed");
    expect(row.payloadRetiredAt).toBeNull();
    expect(result.nextWakeAt).toBeNull();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("keeps an uncertain submission reserved when access is later revoked", async () => {
    row.status = "uncertain";
    fixture.access.mockRejectedValue(new ORPCError("FORBIDDEN"));
    const result = await dispatchScheduledSend(scope);
    expect(row.status).toBe("uncertain");
    expect(result.nextWakeAt).toBeGreaterThan(Date.now());
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("reconciles pending delivery without submitting again", async () => {
    row.status = "sending";
    row.sendAt = new Date(Date.now() - 60_000);
    await dispatchScheduledSend(scope);
    expect(row.status).toBe("uncertain");
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("keeps ambiguous missing or prepared receipts reserved", async () => {
    row.status = "uncertain";
    fixture.getStatus.mockResolvedValue({
      definitiveRejection: false,
      status: "rejected",
    });
    await dispatchScheduledSend(scope);
    expect(row.status).toBe("uncertain");
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("allows recovery only after a confirmed provider rejection", async () => {
    row.status = "uncertain";
    fixture.getStatus.mockResolvedValue({
      definitiveRejection: true,
      status: "rejected",
    });
    await dispatchScheduledSend(scope);
    expect(row.status).toBe("failed");
    expect(row.nextWakeAt).toBeNull();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("records confirmed delivery without requiring the old payload", async () => {
    row.status = "uncertain";
    fixture.getStatus.mockResolvedValue({ id: "sent-message", status: "sent" });
    await dispatchScheduledSend(scope);
    expect(row.status).toBe("sent");
    expect(row.payloadRetiredAt).toBeInstanceOf(Date);
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.readObject).not.toHaveBeenCalled();
  });

  test("rejects scheduling a managed draft whose earlier send was accepted under another operation", async () => {
    fixture.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({
        provider: "managed",
        role: "responder",
      }),
      contentRevision: 0,
      id: scope.mailboxId,
      organizationId: "org",
      provider: "managed",
    });
    fixture.getStatus.mockResolvedValue({ status: "rejected" });
    fixture.originalDraft.mockResolvedValue({
      baseRevision: "2026-11-10T12:00:00.000Z",
      messageId: "internal-draft",
    });
    // oxlint-disable-next-line eslint/require-await -- The driver returns the existing source receipt without I/O.
    fixture.query.mockImplementation(async (query) => {
      if (
        query.startsWith('update "gmailComposeOperation"') &&
        query.includes(" returning ")
      ) {
        return { rows: [["source-lock"]] };
      }
      if (query.includes('from "organizationMailSendIdempotency"')) {
        return { rows: [["previously-accepted-send"]] };
      }
      return { rows: [] };
    });
    await expect(
      createScheduledSend({
        mailboxId: scope.mailboxId,
        message: {
          attachments: [],
          bodyHtml: "<p>Hello</p>",
          bodyText: "Hello",
          draftId: "provider-draft",
          inlineImages: [],
          localId: "new-editor",
          recipients: { bcc: "", cc: "", to: "person@example.test" },
          saveStatus: "saved",
          sendOperationId: crypto.randomUUID(),
          subject: "Reply",
          updatedAt: Date.now(),
        },
        sendAt: new Date(Date.now() + 86_400_000).toISOString(),
        timeZone: "UTC",
        userId: scope.userId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.deleteDraft).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("rejects cancellation once submission can have started", async () => {
    row.status = "sending";
    // A real database refuses this conditional update once status has changed.
    // oxlint-disable-next-line eslint/require-await -- The driver refuses the state transition without I/O.
    fixture.query.mockImplementation(async (query) => ({
      rows: query.startsWith("select")
        ? [
            Object.keys(getTableColumns(scheduledMailSend)).map(
              (key) => Object.entries(row).find(([name]) => name === key)?.[1]
            ),
          ]
        : [],
    }));
    await expect(cancelScheduledSend(scope)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(fixture.saveDraft).not.toHaveBeenCalled();
  });
});

describe("scheduled time validation", () => {
  test("rejects past times, out-of-range dates, and reminders before the message", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(() =>
      validateScheduledSendTime("2026-11-10T11:00:00Z", undefined, now)
    ).toThrow(ORPCError);
    expect(() =>
      validateScheduledSendTime("2040-01-01T12:00:00Z", undefined, now)
    ).toThrow(ORPCError);
    expect(() =>
      validateScheduledSendTime(
        "2026-11-11T12:00:00Z",
        "2026-11-11T11:00:00Z",
        now
      )
    ).toThrow(ORPCError);
    expect(
      validateScheduledSendTime("2030-01-01T12:00:00Z", undefined, now)
    ).toBeInstanceOf(Date);
  });
});
