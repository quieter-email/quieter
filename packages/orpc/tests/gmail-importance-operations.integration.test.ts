import { createHash, randomUUID } from "node:crypto";

import { classifyMailImportance } from "@quieter/ai/mail-importance";
import { db } from "@quieter/database/client";
import {
  gmailComposeOperation,
  mailbox,
  mailMessageImportance,
  organization,
  user,
} from "@quieter/database/schema";
import { getThreadWithDetails, listLabels } from "@quieter/gmail";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { runAuthorizedGmailMailbox } from "../src/gmail-mailbox-access";
import { writeGmailCapturedMessage } from "../src/mail-capture";
import { mutationsMailOperations } from "../src/mail/mutations";
import { queriesMailOperations } from "../src/mail/queries";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
const credentialRequests = vi.hoisted(() =>
  vi.fn<(input: { mailboxId: string; userId: string }) => void>()
);

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      DATABASE_URL: databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});
vi.mock(import("../src/gmail-mailbox-access"), async (importOriginal) => ({
  ...(await importOriginal()),
  runAuthorizedGmailMailbox: async <TValue>(
    input: Parameters<typeof runAuthorizedGmailMailbox>[0],
    operation: (accessToken: string) => Promise<TValue>
  ) => {
    credentialRequests(input);
    return await operation("synthetic-token");
  },
}));
vi.mock(import("@quieter/gmail"), async (importOriginal) => ({
  ...(await importOriginal()),
  getThreadWithDetails: vi.fn<typeof getThreadWithDetails>(),
  listLabels: vi.fn<typeof listLabels>(),
}));
vi.mock(import("@quieter/ai/mail-importance"), () => ({
  classifyMailImportance: vi.fn<typeof classifyMailImportance>(),
}));

describe.skipIf(databaseUrl === undefined)(
  "Gmail importance operation boundaries on migrated PostgreSQL",
  () => {
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    const organizationId = randomUUID();
    const mailboxIds: string[] = [];
    const now = new Date();
    const context = { userId: ownerId };
    const providerThreads = new Map<string, CapturedMailSnapshot[]>();

    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Operation tests require a disposable loopback database."
        );
      }
      await db.insert(user).values(
        [ownerId, otherUserId].map((id) => ({
          createdAt: now,
          email: `${id}@example.com`,
          emailVerified: false,
          id,
          name: "Importance operation fixture",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Importance operation fixture",
        slug: organizationId,
      });
    });

    beforeEach(() => {
      vi.clearAllMocks();
      providerThreads.clear();
      vi.mocked(listLabels).mockResolvedValue([
        { id: "Label_987", name: "Project Updates", type: "user" },
      ]);
      vi.mocked(getThreadWithDetails).mockImplementation(
        async (_token, threadId, _signal, onSnapshot) => {
          const snapshots = providerThreads.get(threadId);
          if (!snapshots) {
            throw Object.assign(new Error("Provider thread missing"), {
              status: 404,
            });
          }
          for (const snapshot of snapshots) {
            await onSnapshot?.(snapshot);
          }
          return {
            messages: snapshots.map((snapshot) => ({
              id: snapshot.id,
              labelIds: snapshot.labelIds,
              threadId: snapshot.threadId,
            })),
            threadId,
          };
        }
      );
    });

    afterAll(async () => {
      await db.delete(mailbox).where(inArray(mailbox.id, mailboxIds));
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [ownerId, otherUserId]));
      await db.$client.end();
    });

    const createMailbox = async () => {
      const id = randomUUID();
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${id}@example.com`,
        id,
        organizationId,
        ownerUserId: ownerId,
        provider: "gmail",
        status: "connected",
        updatedAt: now,
      });
      mailboxIds.push(id);
      return id;
    };

    const message = (
      threadId: string,
      overrides: Partial<CapturedMailSnapshot> = {}
    ): CapturedMailSnapshot => ({
      attachments: [],
      bodyHtml: null,
      bodyText: "Please review the project.",
      headers: [{ name: "From", value: "sender@example.com" }],
      id: randomUUID(),
      internalDate: String(now.getTime()),
      labelIds: ["INBOX", "Label_987"],
      providerRevision: "100",
      threadId,
      truncation: {
        attachments: false,
        bodyHtml: false,
        bodyText: false,
        headers: false,
      },
      ...overrides,
    });

    test("marks an uncaptured older message without running classification", async () => {
      const mailboxId = await createMailbox();
      const snapshot = message("older-thread");
      providerThreads.set(snapshot.threadId, [snapshot]);
      const result = await mutationsMailOperations.applyChanges({
        context,
        input: {
          command: { important: true, kind: "set-importance" },
          mailboxId,
          targets: [{ messageIds: [snapshot.id], threadId: snapshot.threadId }],
        },
      });
      expect(result.targets).toMatchObject([{ status: "applied" }]);
      const page = await queriesMailOperations.listThreads({
        context,
        input: { category: "important", mailboxId },
      });
      expect(page.messages).toContainEqual(
        expect.objectContaining({ id: snapshot.id, isImportant: true })
      );
      expect(classifyMailImportance).not.toHaveBeenCalled();
      expect(listLabels).not.toHaveBeenCalled();
    });

    test.each([
      {
        headers: [{ name: "List-Id", value: "Updates <updates.example.com>" }],
        key: "list:updates.example.com",
      },
      { headers: [], key: "sender:updates@example.com" },
    ])(
      "Important retains unsubscribe targets and scopes remembered $key to its mailbox",
      async ({ headers, key }) => {
        const mailboxId = await createMailbox();
        const otherMailboxId = await createMailbox();
        const snapshot = message(randomUUID(), {
          headers: [
            { name: "From", value: "Updates <updates@example.com>" },
            ...headers,
            {
              name: "List-Unsubscribe",
              value:
                "<mailto:remove@example.com?subject=Stop>, <https://example.com/unsubscribe>",
            },
          ],
        });
        providerThreads.set(snapshot.threadId, [snapshot]);
        for (const id of [mailboxId, otherMailboxId]) {
          await queriesMailOperations.getThread({
            context,
            input: { mailboxId: id, threadId: snapshot.threadId },
          });
          await db
            .update(mailMessageImportance)
            .set({ manualImportant: true })
            .where(eq(mailMessageImportance.mailboxId, id));
        }
        credentialRequests.mockClear();
        const available = await queriesMailOperations.listThreads({
          context,
          input: { category: "important", mailboxId },
        });
        expect(available.messages).toContainEqual(
          expect.objectContaining({
            id: snapshot.id,
            isImportant: true,
            unsubscribeKey: key,
            unsubscribeMailto: "mailto:remove@example.com?subject=Stop",
            unsubscribeUrl: "https://example.com/unsubscribe",
          })
        );
        expect(available.messages[0]?.unsubscribeStatus).toBeUndefined();
        const operationKey = `unsubscribe:v1:${createHash("sha256").update(key).digest("hex")}`;
        await db.insert(gmailComposeOperation).values({
          createdAt: now,
          id: randomUUID(),
          kind: "send",
          mailboxId,
          messageHeaderId: `<${randomUUID()}@example.com>`,
          operationKey,
          requestHash: operationKey,
          response: { id: "accepted-unsubscribe", threadId: "receipt-thread" },
          status: "accepted",
          updatedAt: now,
        });
        const remembered = await queriesMailOperations.listThreads({
          context,
          input: { category: "important", mailboxId },
        });
        expect(remembered.messages).toContainEqual(
          expect.objectContaining({
            id: snapshot.id,
            unsubscribeStatus: "requested",
          })
        );
        const other = await queriesMailOperations.listThreads({
          context,
          input: { category: "important", mailboxId: otherMailboxId },
        });
        expect(other.messages[0]?.unsubscribeStatus).toBeUndefined();
        expect(other.messages[0]?.unsubscribeKey).toBe(key);
        expect(credentialRequests).not.toHaveBeenCalled();
      }
    );

    test("whole-thread changes include every current incoming member of a partial capture", async () => {
      const mailboxId = await createMailbox();
      const retained = message("partial-thread");
      const uncaptured = message(retained.threadId);
      const sent = message(retained.threadId, { labelIds: ["SENT"] });
      const omitted = message(retained.threadId);
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: omitted,
        source: "on_demand",
      });
      await db
        .update(mailMessageImportance)
        .set({ manualImportant: false })
        .where(eq(mailMessageImportance.mailboxId, mailboxId));
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: retained,
        source: "on_demand",
      });
      providerThreads.set(retained.threadId, [retained, uncaptured, sent]);
      await mutationsMailOperations.applyChanges({
        context,
        input: {
          command: { important: true, kind: "set-importance" },
          mailboxId,
          targets: [
            { messageIds: [], threadId: retained.threadId },
            { messageIds: [uncaptured.id], threadId: retained.threadId },
          ],
        },
      });
      const rows = await db
        .select()
        .from(mailMessageImportance)
        .where(eq(mailMessageImportance.mailboxId, mailboxId));
      expect(
        rows
          .filter((row) => row.manualImportant === true)
          .map((row) => row.messageId)
      ).toStrictEqual(expect.arrayContaining([retained.id, uncaptured.id]));
      expect(
        rows.find((row) => row.messageId === sent.id)?.manualImportant
      ).not.toBeTruthy();
      expect(rows.find((row) => row.messageId === omitted.id)).toMatchObject({
        manualImportant: false,
      });
      expect(getThreadWithDetails).toHaveBeenCalledOnce();
      expect(classifyMailImportance).not.toHaveBeenCalled();
    });

    test("whole-thread updates reject threads with no current incoming members without changing retained flags", async () => {
      const mailboxId = await createMailbox();
      const omitted = message("outgoing-thread");
      const sent = message(omitted.threadId, { labelIds: ["SENT"] });
      const valid = message("incoming-thread");
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: omitted,
        source: "on_demand",
      });
      await db
        .update(mailMessageImportance)
        .set({ manualImportant: false })
        .where(eq(mailMessageImportance.mailboxId, mailboxId));
      providerThreads.set(omitted.threadId, [sent]);
      providerThreads.set(valid.threadId, [valid]);
      await expect(
        mutationsMailOperations.applyChanges({
          context,
          input: {
            command: { important: true, kind: "set-importance" },
            mailboxId,
            targets: [
              { messageIds: [], threadId: valid.threadId },
              { messageIds: [], threadId: omitted.threadId },
            ],
          },
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const rows = await db
        .select()
        .from(mailMessageImportance)
        .where(eq(mailMessageImportance.mailboxId, mailboxId));
      expect(rows.find((row) => row.messageId === omitted.id)).toMatchObject({
        manualImportant: false,
      });
      expect(rows.some((row) => row.manualImportant === true)).toBeFalsy();
    });

    test("a missing thread rejects bulk preflight without applying flags to another valid thread", async () => {
      const mailboxId = await createMailbox();
      const snapshot = message("valid-thread");
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot,
        source: "on_demand",
      });
      providerThreads.set(snapshot.threadId, [snapshot]);
      await expect(
        mutationsMailOperations.applyChanges({
          context,
          input: {
            command: { important: true, kind: "set-importance" },
            mailboxId,
            targets: [
              { messageIds: [snapshot.id], threadId: snapshot.threadId },
              { messageIds: [], threadId: "missing-thread" },
            ],
          },
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const rows = await db
        .select()
        .from(mailMessageImportance)
        .where(eq(mailMessageImportance.mailboxId, mailboxId));
      expect(rows.some((row) => row.manualImportant === true)).toBeFalsy();
    });

    test("exact message targets are verified after capture and never expand to the whole thread", async () => {
      const mailboxId = await createMailbox();
      const snapshot = message("exact-thread");
      const sibling = message(snapshot.threadId);
      providerThreads.set(snapshot.threadId, [snapshot, sibling]);
      const result = await mutationsMailOperations.applyChanges({
        context,
        input: {
          command: { important: true, kind: "set-importance" },
          mailboxId,
          targets: [
            { messageIds: ["foreign-id"], threadId: snapshot.threadId },
          ],
        },
      });
      expect(result.targets).toMatchObject([{ status: "failed" }]);
      await mutationsMailOperations.applyChanges({
        context,
        input: {
          command: { important: true, kind: "set-importance" },
          mailboxId,
          targets: [{ messageIds: [snapshot.id], threadId: snapshot.threadId }],
        },
      });
      const rows = await db
        .select()
        .from(mailMessageImportance)
        .where(eq(mailMessageImportance.mailboxId, mailboxId));
      expect(
        rows.find((row) => row.messageId === snapshot.id)?.manualImportant
      ).toBeTruthy();
      expect(
        rows.find((row) => row.messageId === sibling.id)?.manualImportant
      ).not.toBeTruthy();
    });

    test("mailbox ownership is checked before provider access", async () => {
      const mailboxId = await createMailbox();
      await expect(
        mutationsMailOperations.applyChanges({
          context: { userId: otherUserId },
          input: {
            command: { important: true, kind: "set-importance" },
            mailboxId,
            targets: [{ messageIds: [], threadId: "private-thread" }],
          },
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(credentialRequests).not.toHaveBeenCalled();
      expect(getThreadWithDetails).not.toHaveBeenCalled();
    });

    test("bulk preflight bounds provider concurrency and completes all requested threads", async () => {
      const mailboxId = await createMailbox();
      const snapshots = Array.from({ length: 9 }, () => message(randomUUID()));
      let active = 0;
      let peak = 0;
      vi.mocked(getThreadWithDetails).mockImplementation(
        async (_token, threadId, _signal, onSnapshot) => {
          active += 1;
          peak = Math.max(peak, active);
          const snapshot = snapshots.find((item) => item.threadId === threadId);
          if (!snapshot) {
            throw new Error("Unexpected fixture thread");
          }
          await onSnapshot?.(snapshot);
          active -= 1;
          return { messages: [{ id: snapshot.id, threadId }], threadId };
        }
      );
      const result = await mutationsMailOperations.applyChanges({
        context,
        input: {
          command: { important: true, kind: "set-importance" },
          mailboxId,
          targets: snapshots.map((snapshot) => ({
            messageIds: [snapshot.id],
            threadId: snapshot.threadId,
          })),
        },
      });
      expect(result.targets).toHaveLength(snapshots.length);
      expect(
        result.targets.every((target) => target.status === "applied")
      ).toBeTruthy();
      expect(peak).toBeLessThan(snapshots.length);
      expect(active).toBe(0);
    });

    test.each([
      ['label:"pRoJeCt UpDaTeS"', true],
      ["label:Label_987", true],
      ['-label:"Project Updates"', false],
      ["label:Unknown", false],
      ["-label:Unknown", true],
      ['(label:"Project Updates" OR label:Other) review', true],
      ['NOT (label:"Project Updates" OR label:Other)', false],
      ['{label:Other label:"Project Updates"} -missing', true],
    ])(
      "Important search resolves label names and preserves negation for %s",
      async (query, included) => {
        const mailboxId = await createMailbox();
        const snapshot = message(randomUUID());
        await writeGmailCapturedMessage({
          mailboxId,
          snapshot,
          source: "on_demand",
        });
        await db
          .update(mailMessageImportance)
          .set({ manualImportant: true })
          .where(eq(mailMessageImportance.mailboxId, mailboxId));
        const page = await queriesMailOperations.listThreads({
          context,
          input: { category: "important", mailboxId, query },
        });
        expect(page.messages.some((item) => item.id === snapshot.id)).toBe(
          included
        );
        expect(listLabels).toHaveBeenCalledOnce();
        expect(credentialRequests).toHaveBeenCalledWith({
          mailboxId,
          userId: ownerId,
        });
      }
    );
  }
);
