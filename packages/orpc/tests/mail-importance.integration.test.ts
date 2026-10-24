import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";

import { classifyMailImportance } from "@quieter/ai/mail-importance";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  mailbox,
  mailboxGrant,
  mailImportanceAttempt,
  mailMessageImportance,
  managedMailMessage,
  member,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import { analyzeMailMessage } from "@quieter/mail/capture";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import type { MessageListItem } from "@quieter/mail/messages";
import type { reportError } from "@quieter/observability";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { getMailAutomationAiBudgetStatus } from "../src/mail-automation/ai-budget";
import { writeGmailCapturedMessage } from "../src/mail-capture";
import {
  ensureMailImportanceWork,
  hydrateMailImportance,
  listCapturedImportantMessages,
  processPendingMailImportance,
  reportPendingMailImportanceUsage,
  setMailImportance,
} from "../src/mail-importance";
import type { publishMailUpdate } from "../src/mail-updates";
import { listManagedMessages } from "../src/managed-mail/messages/service";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));

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
vi.mock(import("@quieter/ai/mail-importance"), () => ({
  classifyMailImportance: vi.fn<typeof classifyMailImportance>(),
}));
vi.mock(import("@quieter/billing"), () => ({
  reportAiUsage: vi.fn<typeof reportAiUsage>(),
}));
vi.mock(import("../src/mail-automation/ai-budget"), async (importOriginal) => ({
  ...(await importOriginal()),
  getMailAutomationAiBudgetStatus:
    vi.fn<typeof getMailAutomationAiBudgetStatus>(),
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: vi.fn<typeof publishMailUpdate>(),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<typeof reportError>(),
}));

const usage = {
  cacheWriteTokens: 0,
  cachedTokens: 0,
  completionTokens: 12,
  costUsd: 0.001,
  promptTokens: 120,
};

describe.skipIf(databaseUrl === undefined)(
  "mail importance on migrated PostgreSQL",
  () => {
    const organizationId = randomUUID();
    const ownerId = randomUUID();
    const readerId = randomUUID();
    const responderId = randomUUID();
    const mailboxIds: string[] = [];
    const now = new Date();

    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Importance tests require a disposable loopback database."
        );
      }
      await db.insert(user).values(
        [ownerId, readerId, responderId].map((id) => ({
          createdAt: now,
          email: `${id}@example.com`,
          emailVerified: false,
          id,
          name: "Importance fixture",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        billingOwnerUserId: ownerId,
        createdAt: now,
        id: organizationId,
        name: "Importance fixture",
        slug: organizationId,
      });
      await db.insert(member).values(
        [ownerId, readerId, responderId].map((userId) => ({
          createdAt: now,
          id: randomUUID(),
          organizationId,
          role: "member",
          userId,
        }))
      );
    });

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(classifyMailImportance)
        .mockReset()
        .mockResolvedValue({ important: true });
      vi.mocked(reportAiUsage).mockReset().mockResolvedValue();
      vi.mocked(getMailAutomationAiBudgetStatus).mockResolvedValue({
        allowed: true,
        reason: "allowed",
      });
    });

    afterAll(async () => {
      if (mailboxIds.length > 0) {
        await db.delete(mailbox).where(inArray(mailbox.id, mailboxIds));
      }
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db
        .delete(user)
        .where(inArray(user.id, [ownerId, readerId, responderId]));
      await db.$client.end();
    });

    const createMailbox = async (provider: "gmail" | "managed" = "gmail") => {
      const id = randomUUID();
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${id}@example.com`,
        id,
        organizationId,
        ownerUserId: provider === "gmail" ? ownerId : null,
        provider,
        status: "connected",
        updatedAt: now,
      });
      mailboxIds.push(id);
      return id;
    };

    const capture = async (
      mailboxId: string,
      overrides: Partial<CapturedMailSnapshot> = {}
    ) => {
      const id = randomUUID();
      const snapshot: CapturedMailSnapshot = {
        attachments: [],
        bodyHtml: null,
        bodyText: "Please review the launch decision.",
        headers: [
          { name: "fRoM", value: "Colleague <colleague@example.com>" },
          { name: "TO", value: "Owner <owner@example.com>" },
          { name: "Subject", value: "Launch decision" },
        ],
        id,
        internalDate: String(now.getTime()),
        labelIds: ["INBOX", "UNREAD"],
        providerRevision: "100",
        threadId: `thread-${id}`,
        truncation: {
          attachments: false,
          bodyHtml: false,
          bodyText: false,
          headers: false,
        },
        ...overrides,
      };
      await db
        .insert(gmailCapturedMessage)
        .values({
          analysis: analyzeMailMessage(snapshot),
          capturedAt: now,
          mailboxId,
          messageId: snapshot.id,
          providerRevision: snapshot.providerRevision,
          snapshot,
          source: "on_demand",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: { providerRevision: snapshot.providerRevision, snapshot },
          target: [
            gmailCapturedMessage.mailboxId,
            gmailCapturedMessage.messageId,
          ],
        });
      await ensureMailImportanceWork(db, {
        mailboxId,
        message: snapshot,
        messageId: snapshot.id,
        receivedAt: new Date(Number(snapshot.internalDate)),
        threadId: snapshot.threadId,
      });
      return snapshot;
    };

    test.each([true, false])(
      "manual importance %s survives delayed classification",
      async (important) => {
        const mailboxId = await createMailbox();
        const snapshot = await capture(mailboxId);
        const started = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        vi.mocked(classifyMailImportance).mockImplementationOnce(async () => {
          started.resolve(null);
          await release.promise;
          return { important: !important };
        });
        const work = processPendingMailImportance({ limit: 1, mailboxId });
        await started.promise;
        try {
          await setMailImportance({
            actorUserId: ownerId,
            important,
            mailboxId,
            targets: [
              { messageIds: [snapshot.id], threadId: snapshot.threadId },
            ],
          });
        } finally {
          release.resolve(null);
        }
        await work;
        const [hydrated] = await hydrateMailImportance<MessageListItem>(
          mailboxId,
          [{ id: snapshot.id, threadId: snapshot.threadId }]
        );
        expect(hydrated).toMatchObject({
          isImportant: important,
          threadIsImportant: important,
        });
        expect(
          vi.mocked(classifyMailImportance).mock.calls[0]?.[0].message
        ).toMatchObject({
          from: "Colleague <colleague@example.com>",
          subject: "Launch decision",
          to: "Owner <owner@example.com>",
        });
      }
    );

    test.each(["replaced lease", "expired lease", "changed content"])(
      "rejects delayed decisions after %s",
      async (change) => {
        const mailboxId = await createMailbox();
        const snapshot = await capture(mailboxId);
        const started = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        vi.mocked(classifyMailImportance).mockImplementationOnce(async () => {
          started.resolve(null);
          await release.promise;
          return { important: true };
        });
        const work = processPendingMailImportance({ limit: 1, mailboxId });
        await started.promise;
        try {
          if (change === "changed content") {
            await capture(mailboxId, {
              ...snapshot,
              bodyText: "The earlier request was withdrawn.",
              providerRevision: "101",
            });
          } else {
            await db
              .update(mailMessageImportance)
              .set(
                change === "replaced lease"
                  ? { leaseId: randomUUID() }
                  : { leaseExpiresAt: new Date(Date.now() - 1000) }
              )
              .where(eq(mailMessageImportance.mailboxId, mailboxId));
          }
        } finally {
          release.resolve(null);
        }
        await work;
        const [hydrated] = await hydrateMailImportance<MessageListItem>(
          mailboxId,
          [{ id: snapshot.id, threadId: snapshot.threadId }]
        );
        expect(hydrated?.isImportant).toBeFalsy();
        const [selected] = await db
          .select()
          .from(mailbox)
          .where(eq(mailbox.id, mailboxId));
        expect(selected?.contentRevision).toBe(0);
      }
    );

    test("read and label recapture preserves classification without another paid request", async () => {
      const mailboxId = await createMailbox();
      const snapshot = await capture(mailboxId);
      await processPendingMailImportance({ limit: 1, mailboxId });
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: { ...snapshot, labelIds: [], providerRevision: "101" },
        source: "history",
      });
      await processPendingMailImportance({ limit: 1, mailboxId });
      expect(classifyMailImportance).toHaveBeenCalledOnce();
      const page = await listCapturedImportantMessages({ mailboxId });
      expect(page.messages).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: snapshot.id,
            isImportant: true,
            isUnread: false,
          }),
        ])
      );
    });

    test.each(["valid", "invalid"])(
      "retries accounting without repeating %s model generation",
      async (output) => {
        const mailboxId = await createMailbox();
        await capture(mailboxId);
        vi.mocked(classifyMailImportance).mockImplementationOnce(
          async ({ onUsage }) => {
            onUsage(usage);
            await setImmediate();
            if (output === "invalid") {
              throw new Error("Model output failed schema validation.");
            }
            return { important: true };
          }
        );
        vi.mocked(reportAiUsage).mockRejectedValueOnce(
          new Error("Billing temporarily unavailable.")
        );
        await processPendingMailImportance({ limit: 1, mailboxId });
        await reportPendingMailImportanceUsage(mailboxId);
        await reportPendingMailImportanceUsage(mailboxId);
        await processPendingMailImportance({ limit: 1, mailboxId });
        expect(classifyMailImportance).toHaveBeenCalledOnce();
        expect(reportAiUsage).toHaveBeenCalledTimes(2);
        const externalIds = vi
          .mocked(reportAiUsage)
          .mock.calls.map(([input]) => input.externalId);
        expect(new Set(externalIds).size).toBe(1);
        const attempts = await db
          .select()
          .from(mailImportanceAttempt)
          .where(eq(mailImportanceAttempt.mailboxId, mailboxId));
        expect(attempts).toHaveLength(1);
        expect(attempts[0]?.usageReportedAt).toBeInstanceOf(Date);
        const page = await listCapturedImportantMessages({ mailboxId });
        expect(page.messages.length > 0).toBe(output === "valid");
      }
    );

    test("failed accounting records cannot starve later billable usage", async () => {
      const mailboxId = await createMailbox();
      const billableId = randomUUID();
      const missingCost = { ...usage, costUsd: undefined };
      await db.insert(mailImportanceAttempt).values([
        ...Array.from({ length: 100 }, () => ({
          createdAt: new Date(now.getTime() - 1000),
          id: randomUUID(),
          mailboxId,
          messageId: randomUUID(),
          model: "fixture-model",
          organizationId,
          usage: missingCost,
          userId: ownerId,
        })),
        {
          createdAt: now,
          id: billableId,
          mailboxId,
          messageId: randomUUID(),
          model: "fixture-model",
          organizationId,
          usage,
          userId: ownerId,
        },
      ]);
      vi.mocked(reportAiUsage).mockImplementation(async (input) => {
        await setImmediate();
        if (input.costUsd === undefined) {
          throw new Error("Usage cost is unavailable.");
        }
      });
      let reportedAt: Date | null = null;
      for (let pass = 0; pass < 110 && reportedAt === null; pass += 1) {
        await reportPendingMailImportanceUsage(mailboxId);
        const [attempt] = await db
          .select()
          .from(mailImportanceAttempt)
          .where(eq(mailImportanceAttempt.id, billableId));
        reportedAt = attempt.usageReportedAt;
      }
      expect(reportedAt).toBeInstanceOf(Date);
      expect(classifyMailImportance).not.toHaveBeenCalled();
      const retained = await db
        .select()
        .from(mailImportanceAttempt)
        .where(eq(mailImportanceAttempt.mailboxId, mailboxId));
      expect(
        retained.some(
          (attempt) =>
            attempt.usage?.costUsd === undefined &&
            attempt.usageReportAttemptedAt !== null &&
            attempt.usageReportedAt === null
        )
      ).toBeTruthy();
    });

    test("enforces Gmail ownership and managed reader versus responder permissions", async () => {
      const gmailId = await createMailbox();
      const snapshot = await capture(gmailId);
      const targets = [
        { messageIds: [snapshot.id], threadId: snapshot.threadId },
      ];
      await expect(
        setMailImportance({
          actorUserId: readerId,
          important: true,
          mailboxId: gmailId,
          targets,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        setMailImportance({
          actorUserId: ownerId,
          important: true,
          mailboxId: gmailId,
          targets,
        })
      ).resolves.toMatchObject({
        targets: [expect.objectContaining({ status: "applied" })],
      });
      const managedId = await createMailbox("managed");
      await db.insert(mailboxGrant).values([
        {
          createdAt: now,
          id: randomUUID(),
          mailboxId: managedId,
          role: "reader",
          updatedAt: now,
          userId: readerId,
        },
        {
          createdAt: now,
          id: randomUUID(),
          mailboxId: managedId,
          role: "responder",
          updatedAt: now,
          userId: responderId,
        },
      ]);
      const messageId = randomUUID();
      const threadId = randomUUID();
      await db.insert(managedMailMessage).values({
        createdAt: now,
        direction: "inbound",
        from: "sender@example.com",
        id: messageId,
        mailboxId: managedId,
        providerMessageId: randomUUID(),
        sentAt: now,
        threadId,
        updatedAt: now,
      });
      const managedTargets = [{ messageIds: [messageId], threadId }];
      await expect(
        setMailImportance({
          actorUserId: readerId,
          important: true,
          mailboxId: managedId,
          targets: managedTargets,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        setMailImportance({
          actorUserId: responderId,
          important: true,
          mailboxId: managedId,
          targets: managedTargets,
        })
      ).resolves.toMatchObject({
        targets: [expect.objectContaining({ status: "applied" })],
      });
      const [hydrated] = await hydrateMailImportance<MessageListItem>(
        managedId,
        [{ id: messageId, threadId }]
      );
      expect(hydrated?.isImportant).toBeTruthy();
    });

    test("rejects cross-thread and cross-mailbox targets without revisions or learning", async () => {
      const mailboxId = await createMailbox();
      const otherMailboxId = await createMailbox();
      const local = await capture(mailboxId);
      const remote = await capture(otherMailboxId);
      const result = await setMailImportance({
        actorUserId: ownerId,
        important: true,
        mailboxId,
        targets: [
          { messageIds: [local.id], threadId: "wrong-thread" },
          { messageIds: [remote.id], threadId: remote.threadId },
        ],
      });
      expect(
        result.targets.every((target) => target.status === "failed")
      ).toBeTruthy();
      const revisions = await db
        .select({ value: mailbox.contentRevision })
        .from(mailbox)
        .where(inArray(mailbox.id, [mailboxId, otherMailboxId]));
      expect(revisions.every((row) => row.value === 0)).toBeTruthy();
      const events = await db
        .select()
        .from(userAiContextEvent)
        .where(
          inArray(userAiContextEvent.mailboxId, [mailboxId, otherMailboxId])
        );
      expect(events).toHaveLength(0);
      const hydrated = await hydrateMailImportance<MessageListItem>(mailboxId, [
        { id: local.id, threadId: local.threadId },
        { id: remote.id, threadId: remote.threadId },
      ]);
      expect(
        hydrated.every((message) => message.isImportant === false)
      ).toBeTruthy();
    });

    test("pages archived Important threads while excluding deleted, trash, spam and sent mail", async () => {
      const mailboxId = await createMailbox();
      const otherMailboxId = await createMailbox();
      const archived = await capture(mailboxId, {
        id: "archived",
        internalDate: String(now.getTime() - 1000),
        labelIds: [],
        threadId: "archive-thread",
      });
      const anchor = await capture(mailboxId, {
        id: "latest-anchor",
        labelIds: ["INBOX", "UNREAD"],
        threadId: archived.threadId,
      });
      await capture(mailboxId, {
        id: "older",
        internalDate: String(now.getTime() - 2000),
        labelIds: ["INBOX"],
      });
      for (const label of ["TRASH", "SPAM", "SENT"]) {
        await capture(mailboxId, {
          id: label.toLowerCase(),
          labelIds: [label],
        });
      }
      const deleted = await capture(mailboxId, { id: "deleted" });
      await db
        .update(gmailCapturedMessage)
        .set({ analysis: null, deletedAt: now, snapshot: null })
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxId),
            eq(gmailCapturedMessage.messageId, deleted.id)
          )
        );
      await capture(otherMailboxId, { id: "foreign" });
      await db
        .update(mailMessageImportance)
        .set({ aiImportant: true, state: "completed" })
        .where(
          inArray(mailMessageImportance.mailboxId, [mailboxId, otherMailboxId])
        );
      await db
        .update(mailMessageImportance)
        .set({ aiImportant: false })
        .where(
          and(
            eq(mailMessageImportance.mailboxId, mailboxId),
            eq(mailMessageImportance.messageId, anchor.id)
          )
        );
      const [hydrated] = await hydrateMailImportance<MessageListItem>(
        mailboxId,
        [{ id: anchor.id, threadId: anchor.threadId }]
      );
      expect(hydrated).toMatchObject({
        isImportant: false,
        threadIsImportant: true,
      });
      const first = await listCapturedImportantMessages({
        mailboxId,
        maxResults: 1,
      });
      expect(first.messages).toMatchObject([
        {
          isUnread: true,
          threadId: archived.threadId,
          threadIsImportant: true,
          threadMessageCount: 2,
        },
      ]);
      expect(first.nextPageToken).toBeDefined();
      const second = await listCapturedImportantMessages({
        mailboxId,
        maxResults: 1,
        pageToken: first.nextPageToken,
      });
      expect(second.messages.map((message) => message.id)).toStrictEqual([
        "older",
      ]);
      expect(second.nextPageToken).toBeUndefined();
      const filtered = await listCapturedImportantMessages({
        mailboxId,
        matchingMessageIds: [anchor.id],
      });
      expect(filtered.messages.map((message) => message.threadId)).toContain(
        archived.threadId
      );
      const dated = await listCapturedImportantMessages({
        mailboxId,
        query: "after:2020/01/01 before:2030/01/01 from:colleague@example.com",
      });
      expect(dated.messages.map((message) => message.threadId)).toContain(
        archived.threadId
      );
    });

    test.each([
      ["alice forecast approval", ["launch"]],
      ['"budget approval"', ["reversed"]],
      ['"approval budget"', []],
      ['"launch decision"', ["launch"]],
      ["budget OR picnic", ["launch", "reversed", "picnic"]],
      ["alice AND (budget OR picnic)", ["launch", "picnic"]],
      ["{budget picnic} -review", ["reversed", "picnic"]],
      ['budget NOT "launch decision"', ["reversed"]],
      ['budget -"launch decision"', ["reversed"]],
      [
        "(from:alice OR subject:picnic) label:Label_work -content:cancelled",
        ["launch"],
      ],
      ["fileName", []],
      ["attachments", []],
      ["itinerary", ["picnic"]],
      ["headersecret", ["launch"]],
      ["alice@example.com", ["launch", "picnic"]],
      ["https://example.com/roadmap", ["launch"]],
      ['"https://example.com/roadmap"', ["launch"]],
      ['"said \\"yes\\" today"', ["launch"]],
      ['"today alice"', []],
    ])(
      "Important free-text expression %s searches message content",
      async (query, expected) => {
        const mailboxId = await createMailbox();
        const otherMailboxId = await createMailbox();
        const snapshots = [
          await capture(mailboxId, {
            bodyText:
              'Please review the approval for this budget. Launch decision. He said "yes" today. https://example.com/roadmap',
            headers: [
              { name: "From", value: "alice@example.com" },
              { name: "Subject", value: "Forecast" },
              { name: "X-Reference", value: "headersecret" },
            ],
            labelIds: ["INBOX", "Label_work"],
            threadId: "launch",
          }),
          await capture(mailboxId, {
            bodyText: "Budget approval arrived.",
            headers: [{ name: "From", value: "Bob <bob@example.com>" }],
            threadId: "reversed",
          }),
          await capture(mailboxId, {
            attachments: [
              {
                attachmentId: "fixture",
                fileName: "itinerary.pdf",
                mimeType: "application/pdf",
                size: 10,
              },
            ],
            bodyText: "The picnic was cancelled.",
            headers: [{ name: "From", value: "alice@example.com" }],
            threadId: "picnic",
          }),
        ];
        for (const label of ["SPAM", "TRASH", "SENT", "DRAFT"]) {
          await capture(mailboxId, {
            ...snapshots[0],
            id: randomUUID(),
            labelIds: [label],
            threadId: randomUUID(),
          });
        }
        const deleted = await capture(mailboxId, {
          ...snapshots[0],
          id: randomUUID(),
          threadId: randomUUID(),
        });
        await db
          .update(gmailCapturedMessage)
          .set({ analysis: null, deletedAt: now, snapshot: null })
          .where(
            and(
              eq(gmailCapturedMessage.mailboxId, mailboxId),
              eq(gmailCapturedMessage.messageId, deleted.id)
            )
          );
        await capture(otherMailboxId, {
          ...snapshots[0],
          id: randomUUID(),
          threadId: randomUUID(),
        });
        await db
          .update(mailMessageImportance)
          .set({ aiImportant: true })
          .where(
            inArray(mailMessageImportance.mailboxId, [
              mailboxId,
              otherMailboxId,
            ])
          );
        const unimportant = await capture(mailboxId, {
          ...snapshots[0],
          id: randomUUID(),
          threadId: randomUUID(),
        });
        const page = await listCapturedImportantMessages({ mailboxId, query });
        expect(
          page.messages.map((item) => item.threadId).toSorted()
        ).toStrictEqual(expected.toSorted());
        expect(page.messages.map((item) => item.id)).not.toContain(
          unimportant.id
        );
      }
    );

    test.each([
      "%%",
      "-%%",
      "in:anywhere",
      "from:(alice OR bob)",
      "launch OR",
      "(launch",
    ])(
      "Important search rejects malformed or unsupported expressions %s",
      async (query) => {
        const mailboxId = await createMailbox();
        await expect(
          listCapturedImportantMessages({ mailboxId, query })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    );

    test("managed Important uses the latest eligible anchor for an important archived member", async () => {
      const mailboxId = await createMailbox("managed");
      const threadId = randomUUID();
      const earlierId = randomUUID();
      const latestId = randomUUID();
      await db.insert(mailboxGrant).values({
        createdAt: now,
        id: randomUUID(),
        mailboxId,
        role: "responder",
        updatedAt: now,
        userId: responderId,
      });
      await db.insert(managedMailMessage).values([
        {
          createdAt: now,
          direction: "inbound",
          from: "client@example.com",
          id: earlierId,
          mailboxId,
          mailboxState: "archived",
          providerMessageId: randomUUID(),
          sentAt: new Date(now.getTime() - 1000),
          subject: "Please approve the launch",
          threadId,
          updatedAt: now,
        },
        {
          createdAt: now,
          direction: "inbound",
          from: "client@example.com",
          id: latestId,
          mailboxId,
          providerMessageId: randomUUID(),
          sentAt: now,
          subject: "One more detail",
          threadId,
          updatedAt: now,
        },
      ]);
      await setMailImportance({
        actorUserId: responderId,
        important: true,
        mailboxId,
        targets: [{ messageIds: [earlierId], threadId }],
      });
      const page = await listManagedMessages({
        category: "important",
        mailboxId,
        userId: responderId,
      });
      expect(page.messages).toMatchObject([
        {
          id: latestId,
          isImportant: false,
          threadIsImportant: true,
          threadMessageCount: 2,
        },
      ]);
      await db
        .update(managedMailMessage)
        .set({ mailboxState: "trash" })
        .where(eq(managedMailMessage.id, earlierId));
      const removed = await listManagedMessages({
        category: "important",
        mailboxId,
        userId: responderId,
      });
      expect(removed.messages).toHaveLength(0);
    });
  }
);
