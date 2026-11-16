/* oxlint-disable vitest/prefer-import-in-mock -- Transport and capture boundaries isolate the canonical query paths from external services. */
import { ORPCError } from "@orpc/server";
import type * as DatabaseClientModule from "@quieter/database/client";
import type { managedMailMessage } from "@quieter/database/schema";
import type {
  getThreadWithDetails,
  listDraftsWithDetails,
  listMessagesWithDetails,
} from "@quieter/gmail";
import type { MessageListItem } from "@quieter/mail/messages";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { captureMailboxMessageMemory } from "../src/ai-memory-capture";
import type { callGmail } from "../src/gmail-request";
import type { processPendingMailImportance } from "../src/mail-importance";
import { mailInputSchemas } from "../src/mail/inputs";
import { queriesMailOperations } from "../src/mail/queries";
import type { getAuthorizedManagedMailbox } from "../src/mailbox/access";
import { listManagedMessages } from "../src/managed-mail/messages/service";
import type { listOrganizationApiMailMessages } from "../src/organization-api-mail";

const managedRecord = (
  id: string,
  options: Partial<
    Pick<
      typeof managedMailMessage.$inferSelect,
      "bcc" | "cc" | "direction" | "from" | "mailboxState" | "threadId" | "to"
    >
  > & { time?: number } = {}
) => ({
  bcc: options.bcc ?? null,
  cc: options.cc ?? null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  direction: options.direction ?? "inbound",
  from: options.from ?? "Other <other@example.test>",
  headers: [],
  id,
  inReplyTo: null,
  isRead: false,
  mailboxState: options.mailboxState ?? "active",
  messageHeaderId: `<${id}@example.test>`,
  providerMessageId: `provider-${id}`,
  references: null,
  replyTo: "reply@example.test",
  sentAt: new Date(options.time ?? 1),
  snippet: `Snippet for ${id}`,
  subject: `Subject for ${id}`,
  threadId: options.threadId ?? "conversation",
  to: options.to ?? "owner@example.test",
  updatedAt: new Date("2026-10-02T00:00:00Z"),
});

type ManagedRecord = ReturnType<typeof managedRecord>;

const fixtures = vi.hoisted(() => ({
  authorize:
    vi.fn<
      () => Promise<{ contentRevision: number; provider: "gmail" | "managed" }>
    >(),
  authorizeManaged: vi.fn<typeof getAuthorizedManagedMailbox>(),
  candidates: [] as ManagedRecord[],
  capture: vi.fn<typeof captureMailboxMessageMemory>(),
  databaseScope: vi.fn<typeof DatabaseClientModule.withRequestDatabaseClient>(),
  drafts: vi.fn<typeof listDraftsWithDetails>(),
  importance:
    vi.fn<
      (
        mailboxId: string,
        messages: MessageListItem[]
      ) => Promise<MessageListItem[]>
    >(),
  importantList: vi.fn<() => Promise<{ messages: MessageListItem[] }>>(),
  list: vi.fn<typeof listMessagesWithDetails>(),
  organizationList: vi.fn<typeof listOrganizationApiMailMessages>(),
  processImportance: vi.fn<typeof processPendingMailImportance>(),
  provider: vi.fn<typeof callGmail>(),
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  states: [] as ManagedRecord[],
  thread: vi.fn<typeof getThreadWithDetails>(),
  unsubscribe:
    vi.fn<
      (
        mailboxId: string,
        messages: MessageListItem[]
      ) => Promise<MessageListItem[]>
    >(),
}));

vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    ...actual,
    db: drizzle(fixtures.query),
    withRequestDatabaseClient: fixtures.databaseScope,
  };
});
vi.mock("@quieter/gmail", () => ({
  getThreadWithDetails: fixtures.thread,
  listDraftsWithDetails: fixtures.drafts,
  listMessagesWithDetails: fixtures.list,
}));
vi.mock("@quieter/gmail/compose", () => ({}));
vi.mock("@quieter/observability", () => ({}));
vi.mock("../src/ai-memory-capture", () => ({
  captureMailboxMessageMemory: fixtures.capture,
}));
vi.mock("../src/gmail-compose", () => ({
  hydrateUnsubscribeStatus: fixtures.unsubscribe,
}));
vi.mock("../src/gmail-open-tracking", () => ({}));
vi.mock("../src/gmail-request", () => ({ callGmail: fixtures.provider }));
vi.mock("../src/mail-capture", () => ({}));
vi.mock("../src/mail-domain/service", () => ({}));
vi.mock("../src/mail-importance", () => ({
  hydrateMailImportance: fixtures.importance,
  listCapturedImportantMessages: fixtures.importantList,
  parseCapturedImportanceSearch: () => {},
  processPendingMailImportance: fixtures.processImportance,
}));
vi.mock("../src/mailbox/access", () => ({
  getAuthorizedManagedMailbox: fixtures.authorizeManaged,
}));
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: fixtures.authorize,
}));
vi.mock("../src/managed-mail/messages/attachments", () => ({}));
vi.mock("../src/managed-mail/messages/get-draft", () => ({}));
vi.mock("../src/organization-api-mail", () => ({
  isOrganizationApiMailboxId: (id: string) => id.startsWith("api:"),
  listOrganizationApiMailMessages: fixtures.organizationList,
}));
vi.mock("../src/reminders/draft-state", () => ({}));

const context = { userId: "owner" };
const mailboxId = "mailbox";
const canonicalMessage: MessageListItem = {
  from: "Alex <alex@example.test>",
  id: "anchor",
  sourceRevision: "source-revision",
  threadAttachmentNames: ["notes.pdf"],
  threadId: "conversation",
  threadLabelIds: ["custom-label"],
  threadMessageCount: 4,
};

describe("canonical mail boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixtures.candidates = [];
    fixtures.states = [];
    fixtures.authorize.mockResolvedValue({
      contentRevision: 12,
      provider: "gmail",
    });
    fixtures.authorizeManaged.mockResolvedValue({
      contentRevision: 12,
      displayName: "Test mailbox",
      emailAddress: "owner@example.test",
      id: mailboxId,
      organizationId: "organization",
      ownerUserId: "owner",
      provider: "managed",
      role: "reader",
    });
    fixtures.provider.mockImplementation(
      async (_context, _mailboxId, operation) =>
        await operation("fixture-token")
    );
    fixtures.importance.mockImplementation(async (_id, messages) => {
      await Promise.resolve();
      return messages.map((item) => ({ ...item, threadIsImportant: true }));
    });
    fixtures.unsubscribe.mockImplementation(async (_id, messages) => {
      await Promise.resolve();
      return messages.map((item) => ({
        ...item,
        unsubscribeStatus: "requested",
      }));
    });
    fixtures.list.mockResolvedValue({
      historyId: "provider-revision",
      messages: [canonicalMessage],
      nextPageToken: "provider-next",
    });
    fixtures.thread.mockResolvedValue({
      messages: [canonicalMessage],
      threadId: canonicalMessage.threadId,
    });
    fixtures.importantList.mockResolvedValue({ messages: [canonicalMessage] });
    fixtures.databaseScope.mockImplementation(async (run) => {
      const { db } = await import("@quieter/database/client");
      return await run(db);
    });
    fixtures.query.mockImplementation(async (query) => {
      await Promise.resolve();
      if (query.includes("group by")) {
        return {
          rows: [
            [
              1,
              [{ fileName: "notes.pdf", id: "attachment" }],
              ["custom-label"],
              fixtures.states.length,
              "conversation",
            ],
          ],
        };
      }
      const records = query.includes("select distinct on")
        ? fixtures.candidates
        : fixtures.states;
      const fields = [
        ...query
          .slice(0, query.indexOf(" from "))
          .matchAll(/"(?<field>[^"]+)"/gu),
      ].map((match) => match[1]);
      return {
        rows: records.map((record) => {
          const transportRecord: Record<string, unknown> = record;
          return fields.map((field) => transportRecord[field]);
        }),
      };
    });
  });

  describe("canonical all mail queries", () => {
    test.each(["important", "drafts"] as const)(
      "all mail bypasses the %s adapter and preserves canonical metadata and cursor",
      async (category) => {
        const page = await queriesMailOperations.listThreads({
          context,
          input: {
            category,
            correspondentEmail: "alex@example.test",
            mailboxId,
            scope: "all_mail",
          },
        });
        expect(page.messages[0]).toMatchObject({
          ...canonicalMessage,
          threadIsImportant: true,
          unsubscribeStatus: "requested",
        });
        expect(page.historyId).toBe("gmail:provider-revision:12");
        expect(page.nextPageToken).toBe("provider-next");
        expect(fixtures.list).toHaveBeenCalledWith(
          "fixture-token",
          expect.objectContaining({
            correspondentEmail: "alex@example.test",
            excludeProtected: true,
            mailbox: undefined,
          })
        );
        expect(fixtures.drafts).not.toHaveBeenCalled();
        expect(fixtures.importantList).not.toHaveBeenCalled();
      }
    );

    test("retains existing category behavior when scope is omitted", async () => {
      await queriesMailOperations.listThreads({
        context,
        input: { category: "important", mailboxId },
      });
      expect(fixtures.importantList).toHaveBeenCalledOnce();
      expect(fixtures.list).not.toHaveBeenCalled();
    });

    test("rejects unsupported and malformed scopes without broadening a mailbox", async () => {
      expect(
        mailInputSchemas.listThreads.safeParse({
          category: "inbox",
          correspondentEmail: "alex@example.test",
          mailboxId,
        }).success
      ).toBeFalsy();
      await expect(
        queriesMailOperations.listThreads({
          context,
          input: {
            category: "inbox",
            mailboxId: "api:team",
            scope: "all_mail",
          },
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixtures.organizationList).not.toHaveBeenCalled();
      fixtures.authorize.mockRejectedValue(new ORPCError("FORBIDDEN"));
      await expect(
        queriesMailOperations.listThreads({
          context,
          input: { category: "inbox", mailboxId, scope: "all_mail" },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixtures.provider).not.toHaveBeenCalled();
    });

    test("a passive read keeps authorized hydration and skips all open activity", async () => {
      const result = await queriesMailOperations.getThread({
        context,
        input: { mailboxId, threadId: canonicalMessage.threadId },
        recordActivity: false,
      });
      expect(result.messages[0]).toMatchObject({
        ...canonicalMessage,
        threadIsImportant: true,
        unsubscribeStatus: "requested",
      });
      expect(fixtures.authorize).toHaveBeenCalledWith({
        mailboxId,
        userId: context.userId,
      });
      expect(fixtures.capture).not.toHaveBeenCalled();
      expect(fixtures.processImportance).not.toHaveBeenCalled();
      expect(fixtures.databaseScope).not.toHaveBeenCalled();

      await queriesMailOperations.getThread({
        context,
        input: { mailboxId, threadId: canonicalMessage.threadId },
      });
      expect(fixtures.capture).toHaveBeenCalledOnce();
      expect(fixtures.processImportance).toHaveBeenCalledOnce();
    });
  });

  describe("managed canonical correspondent anchors", () => {
    test.each(["from", "to", "cc", "bcc"] as const)(
      "finds exact %s history behind a newer substring match without losing summaries",
      async (addressHeader) => {
        fixtures.candidates = [
          managedRecord("substring", {
            [addressHeader]: '"alex@example.test" <alex@example.test.invalid>',
            time: 10,
          }),
          managedRecord("next-thread", {
            threadId: "next-conversation",
            time: 0,
          }),
        ];
        fixtures.states = [
          managedRecord("anchor", {
            [addressHeader]: "Alex <ALEX@example.test>",
            direction: "outbound",
            mailboxState: "done",
            time: 2,
          }),
          fixtures.candidates[0],
          ...(["draft", "spam", "trash"] as const).map((mailboxState) =>
            managedRecord(mailboxState, {
              [addressHeader]: "alex@example.test",
              mailboxState,
              time: 20,
            })
          ),
        ];
        const result = await listManagedMessages({
          category: "important",
          correspondentEmail: "alex@example.test",
          mailboxId,
          maxResults: 1,
          scope: "all_mail",
          userId: context.userId,
        });
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]).toMatchObject({
          id: "anchor",
          replyTo: "reply@example.test",
          sourceRevision: "2026-10-02T00:00:00.000Z",
          threadAttachmentCount: 1,
          threadIsImportant: true,
          threadMessageCount: 5,
        });
        expect(result.messages[0]?.threadAttachmentNames).toContain(
          "notes.pdf"
        );
        expect(result.messages[0]?.threadLabelIds).toContain("custom-label");
        expect(result.historyId).toBe("12");
        expect(result.nextPageToken).toBeDefined();
        expect(
          JSON.parse(
            Buffer.from(result.nextPageToken ?? "", "base64url").toString()
          )
        ).toMatchObject({ id: "substring" });
        const candidateQuery = fixtures.query.mock.calls.find(([query]) =>
          query.includes("select distinct on")
        );
        expect(candidateQuery?.[1]).toContain("active");
        expect(candidateQuery?.[1]).toContain("done");
        expect(candidateQuery?.[0]).not.toMatch(/"direction"\s*=/u);
        expect(candidateQuery?.[0]).toContain(" or ");
      }
    );

    test("preserves continuation after all candidate anchors fail exact matching", async () => {
      fixtures.candidates = [
        managedRecord("substring", { from: "alex@example.test.invalid" }),
        managedRecord("next", { threadId: "next-conversation" }),
      ];
      fixtures.states = [fixtures.candidates[0]];
      const result = await listManagedMessages({
        category: "inbox",
        correspondentEmail: "alex@example.test",
        mailboxId,
        maxResults: 1,
        scope: "all_mail",
        userId: context.userId,
      });
      expect(result.messages).toHaveLength(0);
      expect(result.nextPageToken).toBeDefined();
    });
  });
});
