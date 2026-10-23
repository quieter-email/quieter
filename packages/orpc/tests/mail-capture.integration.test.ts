import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  gmailCaptureState,
  mailbox,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  deleteGmailCapturedMessage,
  getMailCaptureStatus,
  processGmailMailCapture,
  writeGmailCapturedMessage,
} from "../src/mail-capture";

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
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: false,
      QUIETER_LOCAL_GMAIL_WATCH_OWNER: "production" as const,
      QUIETER_LOCAL_PROVIDER_MODE: "observe" as const,
    },
  };
});

const drainCapture = async (mailboxId: string) => {
  for (let step = 0; step < 30; step += 1) {
    const result = await processGmailMailCapture({
      accessToken: "synthetic-token",
      mailboxId,
      maxSteps: 10,
    });
    if (!result.busy && !result.needsContinuation) {
      return;
    }
  }
  throw new Error("Synthetic capture did not finish.");
};

describe.skipIf(databaseUrl === undefined)(
  "mail capture on migrated PostgreSQL",
  () => {
    const organizationId = randomUUID();
    const ownerId = randomUUID();
    const teammateId = randomUUID();
    const mailboxes: string[] = [];
    const now = new Date();

    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Capture tests require a disposable loopback database."
        );
      }
      await db.insert(user).values(
        [ownerId, teammateId].map((id) => ({
          createdAt: now,
          email: `${id}@example.com`,
          emailVerified: false,
          id,
          name: "Capture fixture",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Capture fixture",
        slug: organizationId,
      });
      await db.insert(member).values(
        [ownerId, teammateId].map((userId) => ({
          createdAt: now,
          id: randomUUID(),
          organizationId,
          role: "member",
          userId,
        }))
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    afterAll(async () => {
      if (mailboxes.length > 0) {
        await db.delete(mailbox).where(inArray(mailbox.id, mailboxes));
      }
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [ownerId, teammateId]));
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
      mailboxes.push(id);
      return id;
    };

    const installProvider = (state: {
      initialMessageIds: string[];
      arrivalId?: string;
      expiredHistory?: boolean;
      profileHistoryId?: string;
      missingMessageIds?: string[];
      providerRevision?: string;
      labelIds?: string[];
      recoveryQueries?: string[];
    }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          if (
            url.origin !== "https://gmail.googleapis.com" ||
            request.method !== "GET"
          ) {
            throw new Error(
              "Capture attempted an unexpected external operation."
            );
          }
          if (url.pathname.endsWith("/profile")) {
            return Response.json({
              emailAddress: "capture@example.com",
              historyId: state.profileHistoryId ?? "100",
            });
          }
          if (url.pathname.endsWith("/messages")) {
            state.recoveryQueries?.push(url.searchParams.get("q") ?? "");
            return Response.json({
              messages: state.initialMessageIds.map((id) => ({
                id,
                threadId: `thread-${id}`,
              })),
            });
          }
          if (url.pathname.endsWith("/history")) {
            if (
              state.expiredHistory === true &&
              url.searchParams.get("startHistoryId") === "100"
            ) {
              return Response.json(
                { error: { code: 404, message: "History expired" } },
                { status: 404 }
              );
            }
            return Response.json({
              history:
                url.searchParams.get("startHistoryId") === "100" &&
                state.arrivalId
                  ? [
                      {
                        id: "110",
                        messagesAdded: [
                          {
                            message: {
                              id: state.arrivalId,
                              threadId: `thread-${state.arrivalId}`,
                            },
                          },
                        ],
                      },
                    ]
                  : [],
              historyId: state.profileHistoryId ?? "120",
            });
          }
          const id = url.pathname.split("/").at(-1);
          if (!id) {
            throw new Error("Unexpected synthetic message.");
          }
          if (state.missingMessageIds?.includes(id) === true) {
            return Response.json(
              { error: { code: 404, message: "Message deleted" } },
              { status: 404 }
            );
          }
          return await Promise.resolve(
            Response.json({
              historyId:
                state.providerRevision ??
                (id === state.arrivalId ? "110" : "95"),
              id,
              internalDate: String(now.getTime()),
              labelIds: state.labelIds ?? ["INBOX", "UNREAD"],
              payload: {
                body: {
                  data: Buffer.from(`Durable body for ${id}`).toString(
                    "base64url"
                  ),
                },
                headers: [
                  { name: "From", value: "Newsletter <news@example.com>" },
                  { name: "Subject", value: "Synthetic newsletter" },
                  {
                    name: "List-Unsubscribe",
                    value: "<https://example.com/unsubscribe?private=fixture>",
                  },
                ],
                mimeType: "text/plain",
              },
              threadId: `thread-${id}`,
            })
          );
        })
      );
      return state;
    };

    test("prevents stale reads from restoring deleted content and isolates identical message IDs", async () => {
      const mailboxId = await createMailbox();
      const otherMailboxId = await createMailbox();
      const snapshot: CapturedMailSnapshot = {
        attachments: [],
        bodyHtml: null,
        bodyText: "Private retained content",
        headers: [{ name: "From", value: "Private <sender@example.com>" }],
        id: "same-provider-id",
        internalDate: String(now.getTime()),
        labelIds: ["INBOX"],
        providerRevision: "9007199254740993",
        threadId: "private-thread",
        truncation: {
          attachments: false,
          bodyHtml: false,
          bodyText: false,
          headers: false,
        },
      };
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot,
        source: "on_demand",
      });
      await writeGmailCapturedMessage({
        mailboxId: otherMailboxId,
        snapshot,
        source: "on_demand",
      });
      await deleteGmailCapturedMessage({
        mailboxId,
        messageId: snapshot.id,
        providerRevision: "9007199254740995",
      });
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: { ...snapshot, providerRevision: "9007199254740994" },
        source: "on_demand",
      });
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: { ...snapshot, providerRevision: "9007199254740995" },
        source: "on_demand",
      });

      const deleted = await db
        .select()
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxId),
            eq(gmailCapturedMessage.messageId, snapshot.id)
          )
        );
      const isolated = await db
        .select()
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, otherMailboxId),
            eq(gmailCapturedMessage.messageId, snapshot.id)
          )
        );
      expect(deleted[0]).toMatchObject({ analysis: null, snapshot: null });
      expect(deleted[0]?.deletedAt).toBeInstanceOf(Date);
      expect(isolated[0]?.snapshot?.bodyText).toContain(
        "Private retained content"
      );
    });

    test("fences a provider response after its processing lease is replaced", async () => {
      const mailboxId = await createMailbox();
      installProvider({ initialMessageIds: ["delayed-message"] });
      const providerFetch = globalThis.fetch;
      const requested = Promise.withResolvers<null>();
      const releaseResponse = Promise.withResolvers<null>();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input, init).url);
          if (url.pathname.endsWith("/messages/delayed-message")) {
            requested.resolve(null);
            await releaseResponse.promise;
          }
          return await providerFetch(input, init);
        })
      );
      const capture = processGmailMailCapture({
        accessToken: "synthetic-token",
        mailboxId,
        maxSteps: 10,
      });
      await requested.promise;
      await db
        .update(gmailCaptureState)
        .set({
          leaseExpiresAt: new Date(Date.now() + 60_000),
          leaseId: "replacement-owner",
        })
        .where(eq(gmailCaptureState.mailboxId, mailboxId));
      releaseResponse.resolve(null);
      await expect(capture).rejects.toThrow(/lease/iu);
      const captured = await db
        .select()
        .from(gmailCapturedMessage)
        .where(eq(gmailCapturedMessage.mailboxId, mailboxId));
      const [state] = await db
        .select()
        .from(gmailCaptureState)
        .where(eq(gmailCaptureState.mailboxId, mailboxId));
      expect(captured).toHaveLength(0);
      expect(state?.leaseId).toBe("replacement-owner");
      expect(state?.bootstrapOffset).toBe(0);
    });

    test("resumes the frozen import after a database failure without advancing history", async () => {
      const mailboxId = await createMailbox();
      const provider = installProvider({
        initialMessageIds: ["original-first", "capture-blocked-insert"],
      });
      await db.execute(
        sql`ALTER TABLE "gmailCapturedMessage" ADD CONSTRAINT capture_test_reject_insert CHECK ("messageId" <> 'capture-blocked-insert')`
      );
      try {
        await expect(
          processGmailMailCapture({
            accessToken: "synthetic-token",
            mailboxId,
            maxSteps: 10,
          })
        ).rejects.toThrow(/failed query/iu);
        const [failed] = await db
          .select()
          .from(gmailCaptureState)
          .where(eq(gmailCaptureState.mailboxId, mailboxId));
        expect(failed?.bootstrapCompletedAt).toBeNull();
        expect(failed?.historyId).toBe("100");
        provider.initialMessageIds = ["window-shifted"];
      } finally {
        await db.execute(
          sql`ALTER TABLE "gmailCapturedMessage" DROP CONSTRAINT capture_test_reject_insert`
        );
      }
      await drainCapture(mailboxId);
      const retained = await db
        .select()
        .from(gmailCapturedMessage)
        .where(eq(gmailCapturedMessage.mailboxId, mailboxId));
      expect(
        retained.map((message) => message.messageId).toSorted()
      ).toStrictEqual(["capture-blocked-insert", "original-first"]);
      const [completed] = await db
        .select()
        .from(gmailCaptureState)
        .where(eq(gmailCaptureState.mailboxId, mailboxId));
      expect(completed?.bootstrapCompletedAt).toBeInstanceOf(Date);
    });

    test("recovers beyond a history gap and reconciles deletions while preserving stored bodies", async () => {
      const mailboxId = await createMailbox();
      const beforeGap = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
      const oldSnapshot: CapturedMailSnapshot = {
        attachments: [],
        bodyHtml: null,
        bodyText: "Stored before the gap",
        headers: [{ name: "From", value: "Sender <news@example.com>" }],
        id: "known-survives",
        internalDate: String(beforeGap.getTime()),
        labelIds: ["INBOX", "UNREAD"],
        providerRevision: "50",
        threadId: "old-thread",
        truncation: {
          attachments: false,
          bodyHtml: false,
          bodyText: false,
          headers: false,
        },
      };
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: oldSnapshot,
        source: "on_demand",
      });
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: { ...oldSnapshot, id: "known-deleted" },
        source: "on_demand",
      });
      await db.insert(gmailCaptureState).values({
        bootstrapCompletedAt: beforeGap,
        createdAt: beforeGap,
        historyId: "100",
        lastCapturedAt: beforeGap,
        mailboxId,
        phase: "history",
        updatedAt: beforeGap,
      });
      const recoveryQueries: string[] = [];
      installProvider({
        expiredHistory: true,
        initialMessageIds: ["gap-arrival"],
        labelIds: ["TRASH"],
        missingMessageIds: ["known-deleted"],
        profileHistoryId: "300",
        providerRevision: "250",
        recoveryQueries,
      });

      await drainCapture(mailboxId);

      const retained = await db
        .select()
        .from(gmailCapturedMessage)
        .where(eq(gmailCapturedMessage.mailboxId, mailboxId));
      expect(
        retained.find((message) => message.messageId === "gap-arrival")
          ?.snapshot?.bodyText
      ).toContain("Durable body");
      expect(
        retained.find((message) => message.messageId === "known-survives")
          ?.snapshot
      ).toMatchObject({
        bodyText: "Stored before the gap",
        labelIds: ["TRASH"],
      });
      expect(
        retained.find((message) => message.messageId === "known-deleted")
      ).toMatchObject({ analysis: null, snapshot: null });
      const after = Number(
        /after:(?<after>\d+)/u.exec(recoveryQueries[0])?.groups?.after
      );
      expect(after).toBeLessThanOrEqual(beforeGap.getTime() / 1000);
      const status = await getMailCaptureStatus({ mailboxId, userId: ownerId });
      expect(status.coverageGapAt).toBeInstanceOf(Date);
    });

    test("retains bootstrap and concurrent arrivals with AI disabled, and keeps mail private", async () => {
      const mailboxId = await createMailbox();
      installProvider({ arrivalId: "arrival", initialMessageIds: ["initial"] });

      await drainCapture(mailboxId);
      await drainCapture(mailboxId);

      const captured = await db
        .select()
        .from(gmailCapturedMessage)
        .where(eq(gmailCapturedMessage.mailboxId, mailboxId));
      expect(
        captured.map((message) => message.messageId).toSorted()
      ).toStrictEqual(["arrival", "initial"]);
      expect(
        captured.every(
          (message) =>
            message.snapshot?.bodyText?.includes("Durable body") === true
        )
      ).toBeTruthy();
      expect(
        captured.every((message) => message.analysis !== null)
      ).toBeTruthy();
      await expect(
        getMailCaptureStatus({ mailboxId, userId: ownerId })
      ).resolves.toBeDefined();
      await expect(
        getMailCaptureStatus({ mailboxId, userId: teammateId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await db.delete(mailbox).where(eq(mailbox.id, mailboxId));
      const [state] = await db
        .select()
        .from(gmailCaptureState)
        .where(eq(gmailCaptureState.mailboxId, mailboxId));
      const retained = await db
        .select()
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxId),
            eq(gmailCapturedMessage.messageId, "initial")
          )
        );
      expect(state).toBeUndefined();
      expect(retained).toHaveLength(0);
    });
  }
);
