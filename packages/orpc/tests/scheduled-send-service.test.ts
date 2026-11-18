import { ORPCError } from "@orpc/server";
import { scheduledMailSend } from "@quieter/database/schema";
import { buildComposeMessageQuotes } from "@quieter/mail/compose/message-quote";
import { composeMessageEnvelopeSchema } from "@quieter/mail/compose/schema";
import { getAuthoredSnippetContent } from "@quieter/mail/compose/snippet-quotes";
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

import type { assertMailEffectAllowed } from "../src/gmail-request";
import type { composeMailOperations } from "../src/mail/compose";
import { hashComposeSnippetBody } from "../src/mail/snippet-quote-provenance";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import type { storeRawMailObject } from "../src/managed-mail/messages/raw-object-lifecycle";
import {
  captureScheduledSendPayload,
  hashScheduledSendPayload,
  scheduledSendPayloadSchema,
} from "../src/scheduled-send/payload";
import {
  cancelScheduledSend,
  createHeldSend,
  createScheduledSend,
  dispatchScheduledSend,
  validateScheduledSendTime,
} from "../src/scheduled-send/service";

const fixture = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  deleteDraft: vi.fn<typeof composeMailOperations.deleteDraft>(),
  getStatus: vi.fn<typeof composeMailOperations.getComposeSendStatus>(),
  guard: vi.fn<typeof assertMailEffectAllowed>(),
  originalDraft:
    vi.fn<() => Promise<{ messageId: string; baseRevision: string }>>(),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  readObject: vi.fn<() => Promise<Uint8Array>>(),
  saveDraft: vi.fn<typeof composeMailOperations.saveDraft>(),
  send: vi.fn<typeof composeMailOperations.sendMessage>(),
  storeObject: vi.fn<typeof storeRawMailObject>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy replaces the driver for focused state-flow tests.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  Object.defineProperty(database, "transaction", {
    value: async <T>(run: (transaction: typeof database) => Promise<T>) =>
      await run(database),
  });
  return { db: database };
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
vi.mock(import("../src/gmail-request"), () => ({
  assertMailEffectAllowed: fixture.guard,
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
  storeRawMailObject: fixture.storeObject,
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

const storeSnapshot = (value: unknown) => {
  const payload = scheduledSendPayloadSchema.parse(value);
  row.requestHash = hashScheduledSendPayload(payload);
  fixture.readObject.mockResolvedValue(
    new TextEncoder().encode(JSON.stringify(payload))
  );
};

const mockExistingDelivery = () => {
  fixture.query.mockImplementation(async (query) => {
    await Promise.resolve();
    if (
      query.startsWith("select") &&
      query.includes('from "scheduledMailSend"')
    ) {
      return {
        rows: [
          Object.keys(getTableColumns(scheduledMailSend)).map(
            (key) => Object.entries(row).find(([name]) => name === key)?.[1]
          ),
        ],
      };
    }
    return {
      rows:
        query.startsWith('update "gmailComposeOperation"') &&
        query.includes(" returning ")
          ? [["source-lock"]]
          : [],
    };
  });
};

describe("scheduled send execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.guard.mockResolvedValue();
    row = {
      ...scope,
      cancellationOrigin: null,
      createdAt: new Date(),
      deliveryKind: "scheduled",
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
            let persistedValue: unknown = value;
            if (column === "cancellationOrigin" && typeof value === "string") {
              persistedValue = JSON.parse(value);
            } else if (date && typeof value === "string") {
              persistedValue = new Date(value);
            }
            Reflect.set(row, column, persistedValue);
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

  test.each(["scheduled", "sent", "cancelled"] as const)(
    "a matching %s quote retry retains its captured attempt without reloading the source",
    async (status) => {
      const source = {
        bodyHtml: "<p>Received {{?source}}</p>",
        bodyText: "Received {{?source}}",
        from: "sender@example.test",
        id: "original",
        threadId: "thread",
      };
      const quotes = buildComposeMessageQuotes(source);
      const message = composeMessageEnvelopeSchema.parse({
        attachments: [],
        bodyHtml: `<p>My reply.</p>${quotes.replyHtml}`,
        bodyText: `My reply.\n\n${quotes.replyText}`,
        draftAnchor: {
          seededBy: "reply",
          sourceMessageId: source.id,
          sourceThreadId: source.threadId,
        },
        inlineImages: [],
        localId: row.sourceLocalId,
        recipients: { bcc: "", cc: "", to: "person@example.test" },
        saveStatus: "idle",
        sendOperationId: row.sendOperationId,
        subject: "Reply",
        updatedAt: Date.now(),
      });
      const payload = await captureScheduledSendPayload(message);
      row.requestHash = hashScheduledSendPayload(payload);
      row.deliveryKind = "undo";
      row.status = status;
      row.payloadRetiredAt = status === "scheduled" ? null : new Date();
      const projection = getAuthoredSnippetContent(message, source);
      fixture.readObject.mockResolvedValue(
        new TextEncoder().encode(
          JSON.stringify({
            actorUserId: scope.userId,
            formatVersion: 1,
            mailboxId: scope.mailboxId,
            message: payload,
            origin: { kind: "human" },
            privateContext: false,
            requestHash: row.requestHash,
            sendOperationId: row.sendOperationId,
            snippetQuote: {
              actorUserId: scope.userId,
              ...projection,
              bodyHash: hashComposeSnippetBody(message),
              mailboxId: scope.mailboxId,
              sendOperationId: row.sendOperationId,
              source: {
                mailboxId: scope.mailboxId,
                messageId: source.id,
                seededBy: "reply",
                threadId: source.threadId,
              },
              version: 1,
            },
          })
        )
      );
      mockExistingDelivery();
      await expect(
        createHeldSend({
          mailboxId: scope.mailboxId,
          message,
          userId: scope.userId,
        })
      ).resolves.toMatchObject({
        sendOperationId: row.sendOperationId,
        status: { cancelled: "canceled", scheduled: "held", sent: "accepted" }[
          status
        ],
      });
      expect(fixture.readObject).toHaveBeenCalledTimes(
        status === "scheduled" ? 1 : 0
      );
      expect(fixture.originalDraft).not.toHaveBeenCalled();
      expect(fixture.storeObject).not.toHaveBeenCalled();
      expect(fixture.deleteDraft).not.toHaveBeenCalled();
      expect(fixture.send).not.toHaveBeenCalled();
    }
  );

  test("an active quote retry without trusted proof fails before reading new attachment bytes", async () => {
    const file = new File(["contents"], "notes.txt", { type: "text/plain" });
    const message = composeMessageEnvelopeSchema.parse({
      attachments: [
        {
          file,
          id: "attachment",
          isInline: false,
          mimeType: file.type,
          name: file.name,
          size: file.size,
        },
      ],
      bodyHtml: "<p>{{?unproven}}</p>",
      bodyText: "{{?unproven}}",
      inlineImages: [],
      localId: row.sourceLocalId,
      recipients: { bcc: "", cc: "", to: "person@example.test" },
      saveStatus: "idle",
      sendOperationId: row.sendOperationId,
      subject: "Reply",
      updatedAt: Date.now(),
    });
    storeSnapshot(await captureScheduledSendPayload(message));
    row.deliveryKind = "undo";
    row.status = "scheduled";
    const bytes = vi.spyOn(file, "arrayBuffer");
    mockExistingDelivery();
    await expect(
      createHeldSend({
        mailboxId: scope.mailboxId,
        message,
        userId: scope.userId,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { sendNotStarted: true },
    });
    expect(bytes).not.toHaveBeenCalled();
    expect(fixture.storeObject).not.toHaveBeenCalled();
    expect(fixture.deleteDraft).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test.each(["capture", "storage"])(
    "does not admit a held send aborted during %s",
    async (phase) => {
      const controller = new AbortController();
      const file = new File(["contents"], "note.txt", { type: "text/plain" });
      if (phase === "capture") {
        vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
          await Promise.resolve();
          controller.abort();
          return new TextEncoder().encode("contents").buffer;
        });
      }
      let queued = 0;
      fixture.query.mockImplementation(async (query) => {
        await Promise.resolve();
        if (query.startsWith('insert into "scheduledMailSend"')) {
          queued += 1;
        }
        return {
          rows:
            query.startsWith('update "gmailComposeOperation"') &&
            query.includes(" returning ")
              ? [["source-lock"]]
              : [],
        };
      });
      fixture.storeObject.mockImplementation(async () => {
        await Promise.resolve();
        if (phase === "storage") {
          controller.abort();
        }
        return { bucket: "fixture", key: "payload", provider: "r2" };
      });
      fixture.getStatus.mockResolvedValue({ status: "rejected" });
      fixture.guard.mockImplementation(async (context) => {
        try {
          context.signal?.throwIfAborted();
          await context.beforeEffect?.();
          context.signal?.throwIfAborted();
        } catch (error) {
          throw new ORPCError("CONFLICT", {
            cause: error,
            data: { sendNotStarted: true },
          });
        }
      });
      await expect(
        createHeldSend({
          mailboxId: scope.mailboxId,
          message: {
            attachments: [
              {
                file,
                id: "file",
                isInline: false,
                mimeType: file.type,
                name: file.name,
                size: file.size,
              },
            ],
            bodyHtml: "<p>Hello</p>",
            bodyText: "Hello",
            inlineImages: [],
            localId: "source",
            recipients: { bcc: "", cc: "", to: "person@example.test" },
            saveStatus: "saved",
            sendOperationId: crypto.randomUUID(),
            subject: "Message",
            updatedAt: Date.now(),
          },
          signal: controller.signal,
          userId: scope.userId,
        })
      ).rejects.toMatchObject({ data: { sendNotStarted: true } });
      expect(queued).toBe(0);
      expect(fixture.deleteDraft).not.toHaveBeenCalled();
      expect(fixture.send).not.toHaveBeenCalled();
    }
  );

  test.each(["proven guard", "unproven storage"] as const)(
    "retains %s failure evidence during preparation",
    async (failure) => {
      let queued = 0;
      fixture.query.mockImplementation(async (query) => {
        await Promise.resolve();
        if (query.startsWith('insert into "scheduledMailSend"')) {
          queued += 1;
        }
        return {
          rows:
            query.startsWith('update "gmailComposeOperation"') &&
            query.includes(" returning ")
              ? [["source-lock"]]
              : [],
        };
      });
      fixture.storeObject.mockRejectedValue(new Error("Storage unavailable"));
      if (failure === "proven guard") {
        fixture.guard.mockRejectedValue(
          new ORPCError("INTERNAL_SERVER_ERROR", {
            data: { sendNotStarted: true },
          })
        );
      }
      fixture.getStatus.mockResolvedValue({ status: "rejected" });
      await expect(
        createHeldSend({
          mailboxId: scope.mailboxId,
          message: {
            attachments: [],
            bodyHtml: "<p>Hello</p>",
            bodyText: "Hello",
            inlineImages: [],
            localId: "source",
            recipients: { bcc: "", cc: "", to: "person@example.test" },
            saveStatus: "saved",
            sendOperationId: crypto.randomUUID(),
            subject: "Message",
            updatedAt: Date.now(),
          },
          userId: scope.userId,
        })
      ).rejects.toMatchObject({
        data:
          failure === "proven guard"
            ? { sendNotStarted: true }
            : { deliveryUncertain: true },
      });
      expect(queued).toBe(0);
      expect(fixture.deleteDraft).not.toHaveBeenCalled();
      expect(fixture.send).not.toHaveBeenCalled();
    }
  );

  test("keeps committed AI cancellation authority during background retry and permits a fresh human recovery", async () => {
    const origin = {
      kind: "ai",
      mailboxId: scope.mailboxId,
      mode: "interactive",
      policyVersion: 3,
      userId: scope.userId,
    } as const;
    storeSnapshot({
      attachments: [],
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      inlineImages: [],
      localId: "source",
      recipients: { bcc: "", cc: "", to: "person@example.test" },
      saveStatus: "saved",
      subject: "Message",
      updatedAt: Date.now(),
    });
    const legacy = await fixture.readObject();
    const payload: unknown = JSON.parse(new TextDecoder().decode(legacy));
    fixture.readObject.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          actorUserId: row.userId,
          formatVersion: 1,
          mailboxId: row.mailboxId,
          message: payload,
          origin,
          privateContext: false,
          requestHash: row.requestHash,
          sendOperationId: row.sendOperationId,
        })
      )
    );
    let writtenDrafts = 0;
    fixture.guard.mockImplementation(async (context) => {
      await Promise.resolve();
      if (row.status === "cancelled" && context.origin?.kind === "ai") {
        throw new ORPCError("FORBIDDEN");
      }
    });
    fixture.saveDraft.mockImplementation(async ({ context, input }) => {
      await fixture.guard(context, row.mailboxId);
      writtenDrafts += 1;
      return {
        ...input.draft,
        attachments: [],
        baseRevision: "restored",
        draftAnchor: input.draft.draftAnchor ?? null,
        draftId: "restored",
        inlineImages: [],
        messageId: "restored",
        replyContext: input.draft.replyContext ?? null,
      };
    });
    const originalIdentity = {
      rawObjectKey: row.rawObjectKey,
      requestHash: row.requestHash,
      sendOperationId: row.sendOperationId,
    };
    await expect(
      cancelScheduledSend({ ...scope, origin, privateContext: false })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { heldCancelCommitted: true, sendNotStarted: false },
    });
    expect(row).toMatchObject({
      ...originalIdentity,
      cancellationOrigin: { origin, privateContext: false },
      status: "cancelled",
    });
    await expect(dispatchScheduledSend(scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(writtenDrafts).toBe(0);
    expect(row.payloadRetiredAt).toBeNull();
    const recovered = await cancelScheduledSend(scope);
    expect(recovered.draftId).toBe("restored");
    expect(writtenDrafts).toBe(1);
    expect(row).toMatchObject({
      ...originalIdentity,
      cancellationOrigin: { origin: { kind: "human" }, privateContext: false },
    });
    expect(row.payloadRetiredAt).toBeInstanceOf(Date);
    expect(fixture.send).not.toHaveBeenCalled();
  });

  test("does not restore a bound cancelled snapshot with no persisted cancellation authority", async () => {
    storeSnapshot({
      attachments: [],
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      inlineImages: [],
      localId: "source",
      recipients: { bcc: "", cc: "", to: "person@example.test" },
      saveStatus: "saved",
      subject: "Message",
      updatedAt: Date.now(),
    });
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(await fixture.readObject())
    );
    fixture.readObject.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          actorUserId: row.userId,
          formatVersion: 1,
          mailboxId: row.mailboxId,
          message: payload,
          origin: { kind: "human" },
          privateContext: false,
          requestHash: row.requestHash,
          sendOperationId: row.sendOperationId,
        })
      )
    );
    row.status = "cancelled";
    await expect(dispatchScheduledSend(scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.saveDraft).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
    expect(row.payloadRetiredAt).toBeNull();
    expect(row.nextWakeAt).toBeNull();
  });

  test("retains a malformed captured payload without dispatching or retrying it as a human message", async () => {
    row.sendAt = new Date(Date.now() - 60_000);
    fixture.readObject.mockResolvedValue(
      new TextEncoder().encode('{"origin":{"kind":"ai"}')
    );
    const result = await dispatchScheduledSend(scope);
    expect(fixture.send).not.toHaveBeenCalled();
    expect(row.status).toBe("failed");
    expect(row.payloadRetiredAt).toBeNull();
    expect(result.nextWakeAt).toBeNull();
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
    storeSnapshot({
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
    });
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

  test("retries a definite failure before submission using the same send operation", async () => {
    row.sendAt = new Date(Date.now() - 60_000);
    storeSnapshot({
      attachments: [],
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      inlineImages: [],
      localId: "source",
      recipients: { bcc: "", cc: "", to: "person@example.test" },
      saveStatus: "saved",
      subject: "Message",
      updatedAt: Date.now(),
    });
    fixture.send.mockRejectedValueOnce(
      new ORPCError("INTERNAL_SERVER_ERROR", {
        data: { sendNotStarted: true },
        message: "Temporary authorization failure",
      })
    );
    const first = await dispatchScheduledSend(scope);
    expect(row.status).toBe("scheduled");
    expect(first.nextWakeAt).toBeGreaterThan(Date.now());
    fixture.send.mockResolvedValue({
      draftCleanupHandled: true,
      id: "sent-message",
      idempotent: false,
    });
    await dispatchScheduledSend(scope);
    expect(row.status).toBe("sent");
    expect(
      fixture.send.mock.calls.map(
        ([input]) => input.input.message.sendOperationId
      )
    ).toStrictEqual([row.sendOperationId, row.sendOperationId]);
  });

  test("does not erase an earlier uncertain submission on a later preparation failure", async () => {
    row.status = "uncertain";
    fixture.getStatus.mockRejectedValue(
      new ORPCError("INTERNAL_SERVER_ERROR", {
        data: { sendNotStarted: true },
      })
    );
    await dispatchScheduledSend(scope);
    expect(row.status).toBe("uncertain");
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
