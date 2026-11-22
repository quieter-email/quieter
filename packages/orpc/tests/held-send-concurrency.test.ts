import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { composeMailOperations } from "../src/mail/compose";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import type { readRawMailObject } from "../src/managed-mail/messages/raw-object";
import type { storeRawMailObject } from "../src/managed-mail/messages/raw-object-lifecycle";
import { assertComposeSendAttemptActive } from "../src/scheduled-send/reservation";
import {
  cancelScheduledSend,
  createHeldSend,
  createScheduledSend,
  dispatchScheduledSend,
  getHeldSend,
  getScheduledSendByOperation,
  undoHeldSend,
} from "../src/scheduled-send/service";
import {
  canRunHeldSendDatabase,
  createHeldSendDatabase,
} from "./held-send-database";

const fixture = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  database: vi.fn<() => PostgresJsDatabase>(),
  deleteDraft: vi.fn<typeof composeMailOperations.deleteDraft>(),
  getStatus: vi.fn<typeof composeMailOperations.getComposeSendStatus>(),
  readObject: vi.fn<typeof readRawMailObject>(),
  saveDraft:
    vi.fn<
      (
        input: Parameters<typeof composeMailOperations.saveDraft>[0]
      ) => Promise<{ draftId: string }>
    >(),
  send: vi.fn<typeof composeMailOperations.sendMessage>(),
  storeObject: vi.fn<typeof storeRawMailObject>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The real driver is supplied after the disposable database starts.
vi.mock("@quieter/database/client", () => ({
  get db() {
    return fixture.database();
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- All database lifecycle predicates remain real.
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
// oxlint-disable-next-line vitest/prefer-import-in-mock -- No provider draft read is needed for an unsaved compose fixture.
vi.mock("../src/mail/queries", () => ({
  queriesMailOperations: { getDraft: vi.fn<() => Promise<never>>() },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Snapshot bytes are retained in memory at the storage boundary.
vi.mock("../src/managed-mail/messages/raw-object", () => ({
  readRawMailObject: fixture.readObject,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The lifecycle being tested is the scheduled send, not object retention.
vi.mock("../src/managed-mail/messages/raw-object-lifecycle", () => ({
  storeRawMailObject: fixture.storeObject,
}));
vi.mock(import("../src/scheduled-send/wake"), () => ({
  requestScheduledSendWake: vi.fn<() => Promise<boolean>>(),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<() => void>(),
}));

type Database = Awaited<ReturnType<typeof createHeldSendDatabase>>;
let database: Database;
let message: Parameters<typeof createHeldSend>[0]["message"];
const scope = { mailboxId: "mailbox", userId: "owner" };
const objects = new Map<string, Uint8Array>();

describe.skipIf(!canRunHeldSendDatabase())("held-send concurrency", () => {
  beforeAll(async () => {
    database = await createHeldSendDatabase();
    fixture.database.mockReturnValue(database.database);
  }, 30_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await database?.dispose();
  });

  describe.each(["gmail", "managed"] as const)(
    "%s held delivery with real database arbitration",
    (provider) => {
      beforeEach(async () => {
        vi.clearAllMocks();
        await database.client`
        TRUNCATE "scheduledMailSend", "scheduledMailSendAbandonment",
          "gmailComposeOperation", "managedMailMessage"
      `;
        objects.clear();
        message = {
          attachments: [],
          bodyHtml: "<p>Hello</p>",
          bodyText: "Hello",
          inlineImages: [],
          localId: crypto.randomUUID(),
          recipients: { bcc: "", cc: "", to: "recipient@example.test" },
          saveStatus: "idle",
          sendOperationId: crypto.randomUUID(),
          subject: "A held message",
          updatedAt: Date.now(),
        };
        fixture.access.mockResolvedValue({
          capabilities: getMailboxCapabilities({ provider, role: "responder" }),
          contentRevision: 0,
          id: scope.mailboxId,
          organizationId: "organization",
          provider,
        });
        fixture.getStatus.mockResolvedValue({ status: "rejected" });
        fixture.send.mockResolvedValue({
          draftCleanupHandled: true,
          id: "sent-message",
          idempotent: false,
        });
        fixture.saveDraft.mockResolvedValue({ draftId: "restored-draft" });
        // oxlint-disable-next-line eslint/require-await -- The storage transport retains the actual captured payload without remote I/O.
        fixture.storeObject.mockImplementation(async (raw) => {
          const key = crypto.randomUUID();
          objects.set(key, raw);
          return { bucket: "test", key, provider: "r2" };
        });
        // oxlint-disable-next-line eslint/require-await -- The storage transport returns the actual captured payload without remote I/O.
        fixture.readObject.mockImplementation(async ({ rawObjectKey }) => {
          const raw =
            rawObjectKey === null ? undefined : objects.get(rawObjectKey);
          if (raw === undefined) {
            throw new Error("The test snapshot is missing.");
          }
          return new Uint8Array(raw);
        });
      });

      test("undo before the deadline restores the draft and prevents delivery", async () => {
        const attachment = new File(["Review notes with café"], "notes.txt", {
          type: "text/plain",
        });
        message.attachments = [
          {
            file: attachment,
            id: crypto.randomUUID(),
            isInline: false,
            mimeType: attachment.type,
            name: attachment.name,
            size: attachment.size,
          },
        ];
        const held = await createHeldSend({ ...scope, message });
        const [precision] = await database.client<{ subMs: number }[]>`
          SELECT (EXTRACT(MICROSECONDS FROM "sendAt")::integer % 1000) AS "subMs"
          FROM "scheduledMailSend"
          WHERE id = ${held.id}
        `;
        expect(precision?.subMs).toBe(0);
        const operation = { ...scope, sendOperationId: held.sendOperationId };
        await expect(undoHeldSend(operation)).resolves.toMatchObject({
          draftId: "restored-draft",
          status: "canceled",
        });
        const restoredAttachment =
          fixture.saveDraft.mock.calls[0]?.[0].input.draft.attachments[0]?.file;
        await expect(restoredAttachment?.text()).resolves.toBe(
          await attachment.text()
        );
        await dispatchScheduledSend({ ...scope, id: held.id });
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          canUndo: false,
          draftId: "restored-draft",
          status: "canceled",
        });
        await expect(
          assertComposeSendAttemptActive(operation)
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(fixture.send).not.toHaveBeenCalled();
      });

      test("the database deadline prevents early delivery despite a fast application clock", async () => {
        const held = await createHeldSend({ ...scope, message });
        const operation = { ...scope, sendOperationId: held.sendOperationId };
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_000);
        await dispatchScheduledSend({ ...scope, id: held.id });
        expect(fixture.send).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        await expect(undoHeldSend(operation)).resolves.toMatchObject({
          status: "canceled",
        });
      });

      test("a passed cutoff refuses cancellation and allows one delivery", async () => {
        const held = await createHeldSend({ ...scope, message });
        const operation = { ...scope, sendOperationId: held.sendOperationId };
        await database.client`
        UPDATE "scheduledMailSend"
        SET "sendAt" = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
        WHERE id = ${held.id}
      `;
        await expect(undoHeldSend(operation)).rejects.toMatchObject({
          code: "CONFLICT",
        });
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          canUndo: false,
          status: "dispatching",
        });
        expect(fixture.saveDraft).not.toHaveBeenCalled();
        await dispatchScheduledSend({ ...scope, id: held.id });
        await dispatchScheduledSend({ ...scope, id: held.id });
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          status: "accepted",
        });
        expect(fixture.send).toHaveBeenCalledOnce();
      });

      test("undo waiting on a row lock cannot cancel after the deadline", async () => {
        const held = await createHeldSend({ ...scope, message });
        const operation = { ...scope, sendOperationId: held.sendOperationId };
        await database.client`
          UPDATE "scheduledMailSend"
          SET "sendAt" = date_trunc('milliseconds', clock_timestamp()) + interval '2 seconds'
          WHERE id = ${held.id}
        `;
        const pending = await database.client.begin(async (transaction) => {
          await transaction`
            SELECT id FROM "scheduledMailSend" WHERE id = ${held.id} FOR UPDATE
          `;
          const cancellation = Promise.allSettled([undoHeldSend(operation)]);
          let blocked = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            await transaction`SELECT pg_stat_clear_snapshot()`;
            const [waiting] = await transaction<{ blocked: boolean }[]>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity
                WHERE datname = current_database()
                  AND query LIKE '%"scheduledMailSend"%'
                  AND wait_event_type = 'Lock'
              ) AS blocked
            `;
            if (waiting?.blocked) {
              blocked = true;
              break;
            }
            await transaction`SELECT pg_sleep(0.01)`;
          }
          expect(blocked).toBeTruthy();
          await transaction`
            SELECT pg_sleep(
              GREATEST(0, EXTRACT(EPOCH FROM ("sendAt" - clock_timestamp()))) + 0.05
            ) FROM "scheduledMailSend" WHERE id = ${held.id}
          `;
          return { cancellation };
        });
        await expect(pending.cancellation).resolves.toMatchObject([
          { reason: { code: "CONFLICT" }, status: "rejected" },
        ]);
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          canUndo: false,
          status: "dispatching",
        });
        expect(fixture.saveDraft).not.toHaveBeenCalled();
      });

      test("ambiguous submission reconciles without submitting the message again", async () => {
        const held = await createHeldSend({ ...scope, message });
        const operation = { ...scope, sendOperationId: held.sendOperationId };
        await database.client`
        UPDATE "scheduledMailSend"
        SET "sendAt" = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
        WHERE id = ${held.id}
      `;
        fixture.send.mockRejectedValueOnce(
          new Error("Provider connection lost")
        );
        await dispatchScheduledSend({ ...scope, id: held.id });
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          canUndo: false,
          status: "uncertain",
        });
        await expect(undoHeldSend(operation)).rejects.toMatchObject({
          code: "CONFLICT",
        });
        fixture.getStatus.mockResolvedValueOnce({ status: "pending" });
        await dispatchScheduledSend({ ...scope, id: held.id });
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          status: "uncertain",
        });
        fixture.getStatus.mockResolvedValueOnce({
          id: "sent-message",
          status: "sent",
        });
        await dispatchScheduledSend({ ...scope, id: held.id });
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          status: "accepted",
        });
        expect(fixture.send).toHaveBeenCalledOnce();
      });

      test("mailbox and user scope isolate lookup, undo, and dispatch", async () => {
        const held = await createHeldSend({ ...scope, message });
        const operation = { ...scope, sendOperationId: held.sendOperationId };
        for (const otherScope of [
          { ...scope, mailboxId: "other-mailbox" },
          { ...scope, userId: "other-user" },
        ]) {
          await expect(
            getHeldSend({
              ...otherScope,
              sendOperationId: held.sendOperationId,
            })
          ).resolves.toBeNull();
          await undoHeldSend({
            ...otherScope,
            sendOperationId: held.sendOperationId,
          });
          await dispatchScheduledSend({ ...otherScope, id: held.id });
        }
        await expect(getHeldSend(operation)).resolves.toMatchObject({
          canUndo: true,
          status: "held",
        });
        expect(fixture.send).not.toHaveBeenCalled();
        expect(fixture.saveDraft).not.toHaveBeenCalled();
      });

      test("read-only mailbox readers cannot undo or abandon a send operation", async () => {
        fixture.access.mockResolvedValueOnce({
          capabilities: getMailboxCapabilities({ provider, role: "reader" }),
          contentRevision: 0,
          id: scope.mailboxId,
          organizationId: "organization",
          provider,
        });
        await expect(
          undoHeldSend({
            ...scope,
            sendOperationId: message.sendOperationId ?? "",
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const abandonments = await database.client`
          SELECT "sendOperationId" FROM "scheduledMailSendAbandonment"
        `;
        expect(abandonments).toHaveLength(0);
      });

      test("an undo arriving during snapshot storage fences the late enqueue", async () => {
        const stored = Promise.withResolvers<"paused">();
        const resume = Promise.withResolvers<boolean>();
        const store = fixture.storeObject.getMockImplementation();
        if (store === undefined || message.sendOperationId === undefined) {
          throw new Error(
            "The test storage and operation must be initialized."
          );
        }
        fixture.storeObject.mockImplementationOnce(async (raw) => {
          stored.resolve("paused");
          await resume.promise;
          return await store(raw);
        });
        const creation = createHeldSend({ ...scope, message });
        const settled = Promise.allSettled([creation]);
        try {
          await expect(Promise.race([stored.promise, creation])).resolves.toBe(
            "paused"
          );
          await expect(
            undoHeldSend({ ...scope, sendOperationId: message.sendOperationId })
          ).resolves.toMatchObject({ status: "abandoned" });
        } finally {
          resume.resolve(true);
          await settled;
        }
        await expect(settled).resolves.toMatchObject([
          { reason: { code: "CONFLICT" }, status: "rejected" },
        ]);
        await expect(
          getHeldSend({
            ...scope,
            sendOperationId: message.sendOperationId,
          })
        ).resolves.toBeNull();
        expect(fixture.send).not.toHaveBeenCalled();
      });

      test("undo cancels a preparing send while preparation holds an active lease", async () => {
        const reading = Promise.withResolvers<"paused">();
        const resume = Promise.withResolvers<boolean>();
        const read = fixture.readObject.getMockImplementation();
        if (read === undefined || message.sendOperationId === undefined) {
          throw new Error(
            "The test storage and operation must be initialized."
          );
        }
        fixture.readObject.mockImplementationOnce(async (...input) => {
          reading.resolve("paused");
          await resume.promise;
          return await read(...input);
        });
        const creation = createHeldSend({ ...scope, message });
        const settled = Promise.allSettled([creation]);
        try {
          await expect(Promise.race([reading.promise, creation])).resolves.toBe(
            "paused"
          );
          await expect(
            undoHeldSend({ ...scope, sendOperationId: message.sendOperationId })
          ).resolves.toMatchObject({
            draftId: "restored-draft",
            status: "canceled",
          });
        } finally {
          resume.resolve(true);
          await settled;
        }
        await expect(
          getHeldSend({ ...scope, sendOperationId: message.sendOperationId })
        ).resolves.toMatchObject({
          canUndo: false,
          draftId: "restored-draft",
          status: "canceled",
        });
        expect(fixture.send).not.toHaveBeenCalled();
      });

      test("cancellation fences an expired dispatcher lease before provider submission", async () => {
        const scheduled = await createScheduledSend({
          ...scope,
          message,
          sendAt: new Date(Date.now() + 3_600_000).toISOString(),
          timeZone: "UTC",
        });
        await database.client`
        UPDATE "scheduledMailSend"
        SET "sendAt" = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
        WHERE id = ${scheduled.id}
      `;
        const reading = Promise.withResolvers<"paused">();
        const resume = Promise.withResolvers<boolean>();
        const read = fixture.readObject.getMockImplementation();
        if (read === undefined) {
          throw new Error("The test storage must be initialized.");
        }
        fixture.readObject.mockImplementationOnce(async (...input) => {
          reading.resolve("paused");
          await resume.promise;
          return await read(...input);
        });
        const dispatch = dispatchScheduledSend({ ...scope, id: scheduled.id });
        try {
          await expect(Promise.race([reading.promise, dispatch])).resolves.toBe(
            "paused"
          );
          await database.client`
          UPDATE "scheduledMailSend"
          SET "leaseUntil" = clock_timestamp() - interval '1 second'
          WHERE id = ${scheduled.id}
        `;
          await cancelScheduledSend({ ...scope, id: scheduled.id });
        } finally {
          resume.resolve(true);
          await dispatch;
        }
        await expect(
          getScheduledSendByOperation({
            ...scope,
            sendOperationId: scheduled.sendOperationId,
          })
        ).resolves.toMatchObject({
          restoredDraftId: "restored-draft",
          status: "cancelled",
        });
        expect(fixture.send).not.toHaveBeenCalled();
      });

      test("an expired lease does not allow cancellation once provider submission starts", async () => {
        const scheduled = await createScheduledSend({
          ...scope,
          message,
          sendAt: new Date(Date.now() + 3_600_000).toISOString(),
          timeZone: "UTC",
        });
        await database.client`
          UPDATE "scheduledMailSend"
          SET "sendAt" = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
          WHERE id = ${scheduled.id}
        `;
        const submitting = Promise.withResolvers<"paused">();
        const resume = Promise.withResolvers<boolean>();
        fixture.send.mockImplementationOnce(async () => {
          submitting.resolve("paused");
          await resume.promise;
          return {
            draftCleanupHandled: true,
            id: "sent-message",
            idempotent: false,
          };
        });
        const dispatch = dispatchScheduledSend({ ...scope, id: scheduled.id });
        try {
          await expect(
            Promise.race([submitting.promise, dispatch])
          ).resolves.toBe("paused");
          await database.client`
            UPDATE "scheduledMailSend"
            SET "leaseUntil" = clock_timestamp() - interval '1 second'
            WHERE id = ${scheduled.id}
          `;
          await expect(
            cancelScheduledSend({ ...scope, id: scheduled.id })
          ).rejects.toMatchObject({
            code: "CONFLICT",
          });
          expect(fixture.saveDraft).not.toHaveBeenCalled();
        } finally {
          resume.resolve(true);
          await dispatch;
        }
        await expect(
          getScheduledSendByOperation({
            ...scope,
            sendOperationId: scheduled.sendOperationId,
          })
        ).resolves.toMatchObject({ status: "sent" });
        expect(fixture.send).toHaveBeenCalledOnce();
      });
    }
  );
});
