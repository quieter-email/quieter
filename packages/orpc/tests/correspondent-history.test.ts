/* oxlint-disable eslint/require-await -- External boundary fixtures preserve asynchronous contracts. */
import { createRouterClient, ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type { MessageListItem } from "@quieter/mail/messages";
import type { Reminder } from "@quieter/mail/reminders";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type {
  AiCorrespondentMemoryInput,
  AiCorrespondentMemoryPage,
} from "../src/ai-memory-context";
import {
  correspondentHistoryInputSchema,
  openCorrespondentSourceSchema,
} from "../src/correspondent-history/contracts";
import type { CorrespondentHistoryInput } from "../src/correspondent-history/contracts";
import {
  listCorrespondentHistory,
  openCorrespondentSource,
} from "../src/correspondent-history/service";
import type { queriesMailOperations } from "../src/mail/queries";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import type { listReminders } from "../src/reminders/service";
import { correspondentHistoryRouter } from "../src/routers/correspondent-history";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  list: vi.fn<(typeof queriesMailOperations)["listThreads"]>(),
  memory:
    vi.fn<
      (input: AiCorrespondentMemoryInput) => Promise<AiCorrespondentMemoryPage>
    >(),
  reminders: vi.fn<typeof listReminders>(),
  thread: vi.fn<(typeof queriesMailOperations)["getThread"]>(),
}));

vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: mocks.access,
}));
vi.mock(import("../src/mail/queries"), async (original) => {
  const actual = await original();
  return {
    queriesMailOperations: {
      ...actual.queriesMailOperations,
      getThread: mocks.thread,
      listThreads: mocks.list,
    },
  };
});
vi.mock(import("../src/reminders/service"), () => ({
  listReminders: mocks.reminders,
}));
vi.mock(import("@quieter/auth/session"), async (original) => ({
  ...(await original()),
  getSessionWithOrganization: async (headers: Headers) => {
    const id = headers.get("x-fixture-user");
    const createdAt = new Date("2026-11-01T00:00:00.000Z");
    return id === null
      ? null
      : {
          session: {
            activeOrganizationId: "organization-a",
            createdAt,
            expiresAt: new Date("2099-01-01T00:00:00.000Z"),
            id: `session-${id}`,
            token: "fixture-session-token",
            updatedAt: createdAt,
            userId: id,
          },
          user: {
            createdAt,
            email: `${id}@example.test`,
            emailVerified: true,
            id,
            name: id,
            role: "member",
            updatedAt: createdAt,
          },
        };
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- This double models only the correspondent overload exercised by this suite.
vi.mock("../src/ai-memory-context", () => ({
  loadAiAgentContext: mocks.memory,
}));

const selection = {
  correspondentEmail: "correspondent@example.test",
  mailboxId: "mailbox-a",
};
const context = { userId: "actor-a" };
const source = {
  kind: "mail",
  messageId: "message-a",
  revision: "revision-a",
  threadId: "thread-a",
} satisfies Parameters<typeof openCorrespondentSource>[0]["input"]["source"];

const message = (
  overrides: Partial<MessageListItem> = {}
): MessageListItem => ({
  from: "A Person <correspondent@example.test>",
  id: "message-a",
  labelIds: ["INBOX"],
  sourceRevision: "revision-a",
  threadId: "thread-a",
  ...overrides,
});

const reminder = (
  index: number,
  overrides: Partial<Reminder> = {}
): Reminder => {
  const createdAt = "2026-11-01T00:00:00.000Z";
  return {
    createdAt,
    dueAt: "2026-11-20T10:00:00.000Z",
    evaluationStatus: "none",
    evaluationSummary: null,
    firedAt: null,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    mailboxId: selection.mailboxId,
    resolution: null,
    scheduleVersion: 1,
    source: null,
    status: "active",
    target: {
      anchorMessageId: "message-a",
      condition: null,
      kind: "thread",
      threadId: "thread-a",
    },
    timeZone: "UTC",
    title: "Confirm the next step",
    updatedAt: createdAt,
    version: 1,
    ...overrides,
  };
};

const memoryItem: AiCorrespondentMemoryPage["items"][number] = {
  category: "relationships",
  content: "The correspondent prefers a written confirmation.",
  correspondents: [selection.correspondentEmail],
  id: "memory-a",
  kind: "learned",
  provenance: {
    confidence: 0.8,
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: null,
    lastConfirmedAt: "2026-11-02T00:00:00.000Z",
    reinforcementCount: 2,
    source: "explicit",
  },
  source: "explicit",
  summary: "Send a written confirmation",
  updatedAt: "2026-11-02T00:00:00.000Z",
  version: 3,
};

const collectCommitments = async (cursor: string) => {
  const items: Reminder[] = [];
  const visited = new Set<string>();
  let continuation: string | null = cursor;
  while (continuation !== null) {
    if (visited.has(continuation)) {
      throw new Error("History continuation did not advance.");
    }
    visited.add(continuation);
    const page = await listCorrespondentHistory({
      context,
      input: { ...selection, cursor: continuation, section: "commitments" },
    });
    if (page.section !== "commitments") {
      throw new Error("Unexpected history section.");
    }
    items.push(...page.items.map((item) => item.reminder));
    continuation = page.nextCursor;
  }
  return items;
};

describe("correspondent history access and continuation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 1,
      id: selection.mailboxId,
      organizationId: "organization-a",
      provider: "gmail",
    });
    mocks.list.mockResolvedValue({ messages: [message()] });
    mocks.memory.mockResolvedValue({
      hasMore: false,
      items: [memoryItem],
      nextCursor: null,
      total: 1,
    });
    mocks.reminders.mockResolvedValue({
      items: [reminder(1)],
      nextCursor: null,
    });
    mocks.thread.mockResolvedValue({
      messages: [message()],
      threadId: "thread-a",
    });
  });

  test("protects the actual RPC boundary and requires an explicit valid selection", async () => {
    const anonymous = createRouterClient(correspondentHistoryRouter, {
      context: { db, headers: new Headers() },
    });
    await expect(
      anonymous.list({ ...selection, section: "mail" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous.openSource({ ...selection, source })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const authenticated = createRouterClient(correspondentHistoryRouter, {
      context: {
        db,
        headers: new Headers({ "x-fixture-user": context.userId }),
      },
    });
    await expect(
      authenticated.list({ ...selection, mailboxId: "", section: "memory" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      authenticated.openSource({
        ...selection,
        correspondentEmail: "invalid",
        source,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const injected = {
      ...selection,
      section: "mail",
      userId: "actor-b",
    } satisfies CorrespondentHistoryInput & { userId: string };
    await expect(authenticated.list(injected)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.memory).not.toHaveBeenCalled();
    expect(mocks.thread).not.toHaveBeenCalled();
  });

  test("uses the authenticated RPC actor and keeps history responses private", async () => {
    const responseHeaders = new Headers();
    const suppliedContext = {
      db,
      headers: new Headers({ "x-fixture-user": "actor-b" }),
      resHeaders: responseHeaders,
      userId: "spoofed-actor",
    };
    const history = createRouterClient(correspondentHistoryRouter, {
      context: suppliedContext,
    });
    await expect(
      history.list({ ...selection, section: "memory" })
    ).resolves.toMatchObject({
      items: [{ id: memoryItem.id, version: memoryItem.version }],
    });
    expect(mocks.memory).toHaveBeenCalledWith({
      mailboxId: selection.mailboxId,
      overview: {
        correspondentEmail: selection.correspondentEmail,
        cursor: undefined,
      },
      userId: "actor-b",
    });
    await expect(
      history.openSource({ ...selection, source })
    ).resolves.toMatchObject({
      messageId: source.messageId,
      thread: { threadId: source.threadId },
    });
    expect(mocks.thread.mock.calls.at(-1)?.[0].context.userId).toBe("actor-b");
    expect(responseHeaders.get("Cache-Control")).toContain("private");
    expect(responseHeaders.get("Cache-Control")).toContain("no-store");
  });

  test("accepts normalized selections and rejects client-supplied actors", () => {
    expect(
      correspondentHistoryInputSchema.parse({
        ...selection,
        correspondentEmail: " Correspondent@Example.Test ",
        section: "mail",
      })
    ).toMatchObject({ correspondentEmail: selection.correspondentEmail });
    expect(
      correspondentHistoryInputSchema.safeParse({
        ...selection,
        section: "memory",
        userId: "another-actor",
      }).success
    ).toBeFalsy();
    expect(
      openCorrespondentSourceSchema.safeParse({
        ...selection,
        source,
        userId: "another-actor",
      }).success
    ).toBeFalsy();
  });

  test("keeps the same correspondent isolated across mailboxes and actors", async () => {
    mocks.list.mockImplementation(async ({ context: actor, input }) => ({
      messages: [
        message({
          id: `${actor.userId}/${input.mailboxId}`,
          threadId: "thread-a",
        }),
      ],
    }));
    const first = await listCorrespondentHistory({
      context,
      input: { ...selection, section: "mail" },
    });
    const otherMailbox = await listCorrespondentHistory({
      context,
      input: { ...selection, mailboxId: "mailbox-b", section: "mail" },
    });
    const otherActor = await listCorrespondentHistory({
      context: { userId: "actor-b" },
      input: { ...selection, section: "mail" },
    });
    expect(first.items).toMatchObject([
      { message: { id: "actor-a/mailbox-a" } },
    ]);
    expect(otherMailbox.items).toMatchObject([
      { message: { id: "actor-a/mailbox-b" } },
    ]);
    expect(otherActor.items).toMatchObject([
      { message: { id: "actor-b/mailbox-a" } },
    ]);
    expect(mocks.access).toHaveBeenCalledWith({
      mailboxId: "mailbox-b",
      userId: "actor-a",
    });
    expect(mocks.access).toHaveBeenCalledWith({
      mailboxId: "mailbox-a",
      userId: "actor-b",
    });
  });

  test("preserves canonical metadata and provider continuation bytes", async () => {
    const enriched = message({
      attachments: [
        {
          attachmentId: "attachment-a",
          fileName: "report.pdf",
          mimeType: "application/pdf",
          size: 150,
        },
      ],
      bodyHtml: "<p>Can you confirm?</p>",
      isImportant: true,
      receivedAt: "2026-11-03T12:00:00.000Z",
      senderAvatarUrls: { dark: "/avatar-dark", light: "/avatar-light" },
      threadAttachmentNames: ["report.pdf"],
      threadIsImportant: true,
      unsubscribeStatus: "requested",
    });
    const providerToken = "provider/opaque+= token 📨";
    mocks.list.mockResolvedValueOnce({
      messages: [enriched],
      nextPageToken: providerToken,
    });
    const first = await listCorrespondentHistory({
      context,
      input: { ...selection, section: "mail" },
    });
    expect(first.items).toMatchObject([{ message: enriched, source }]);
    expect(first.nextCursor).toBeTypeOf("string");
    await listCorrespondentHistory({
      context,
      input: {
        ...selection,
        cursor: first.nextCursor ?? undefined,
        section: "mail",
      },
    });
    expect(mocks.list.mock.calls.at(-1)?.[0].input).toMatchObject({
      correspondentEmail: selection.correspondentEmail,
      mailboxId: selection.mailboxId,
      pageToken: providerToken,
      scope: "all_mail",
    });
  });

  test.each([
    { actorId: "actor-b" },
    { mailboxId: "mailbox-b" },
    { correspondentEmail: "someone-else@example.test" },
    { section: "memory" },
    { section: "commitments" },
  ])(
    "rejects a continuation reused for another selection $actorId $mailboxId $correspondentEmail $section",
    async (different) => {
      mocks.list.mockResolvedValue({
        messages: [],
        nextPageToken: "provider-next",
      });
      const first = await listCorrespondentHistory({
        context,
        input: { ...selection, section: "mail" },
      });
      vi.clearAllMocks();
      const input = correspondentHistoryInputSchema.parse({
        ...selection,
        correspondentEmail:
          different.correspondentEmail ?? selection.correspondentEmail,
        cursor: first.nextCursor,
        mailboxId: different.mailboxId ?? selection.mailboxId,
        section: different.section ?? "mail",
      });
      await expect(
        listCorrespondentHistory({
          context: { userId: different.actorId ?? context.userId },
          input,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mocks.access).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.memory).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
    }
  );

  test.each([
    "not-a-json-cursor",
    "YQ==",
    btoa(
      JSON.stringify({
        actorId: context.userId,
        ...selection,
        position: "next",
        section: "mail",
        userId: "injected",
      })
    ).replaceAll("=", ""),
    btoa(
      JSON.stringify({
        actorId: context.userId,
        ...selection,
        position: { afterId: "item-a", startedAt: "invalid-date" },
        section: "memory",
      })
    ).replaceAll("=", ""),
  ])(
    "rejects malformed continuation before reading private data",
    async (cursor) => {
      await expect(
        listCorrespondentHistory({
          context,
          input: { ...selection, cursor, section: "mail" },
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mocks.access).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.memory).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
    }
  );

  test.each(["mail", "memory", "commitments"] as const)(
    "denies inaccessible mailboxes before reading %s",
    async (section) => {
      mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
      await expect(
        listCorrespondentHistory({ context, input: { ...selection, section } })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.memory).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
    }
  );

  test.each(["mail", "memory", "commitments"] as const)(
    "discards %s results if mailbox access is revoked during the read",
    async (section) => {
      const access = await mocks.access({
        mailboxId: selection.mailboxId,
        userId: context.userId,
      });
      let revoked = false;
      mocks.access.mockImplementation(async () => {
        if (revoked) {
          throw new ORPCError("NOT_FOUND");
        }
        return access;
      });
      mocks.list.mockImplementation(async () => {
        revoked = true;
        return { messages: [message()] };
      });
      mocks.memory.mockImplementation(async () => {
        revoked = true;
        return {
          hasMore: false,
          items: [memoryItem],
          nextCursor: null,
          total: 1,
        };
      });
      mocks.reminders.mockImplementation(async () => {
        revoked = true;
        return { items: [reminder(1)], nextCursor: null };
      });
      await expect(
        listCorrespondentHistory({ context, input: { ...selection, section } })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  );

  test("fails visibly when the canonical mail path returns unrelated or protected mail", async () => {
    mocks.list.mockResolvedValueOnce({
      messages: [message({ from: "unrelated@example.test" })],
    });
    await expect(
      listCorrespondentHistory({
        context,
        input: { ...selection, section: "mail" },
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    mocks.list.mockResolvedValueOnce({
      messages: [message({ labelIds: ["TRASH"] })],
    });
    await expect(
      listCorrespondentHistory({
        context,
        input: { ...selection, section: "mail" },
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  test("preserves memory provenance and correction versions without inventing mail sources", async () => {
    const memoryCursor = {
      afterId: memoryItem.id,
      startedAt: "2026-11-04T00:00:00.000Z",
    };
    mocks.memory.mockResolvedValueOnce({
      hasMore: true,
      items: [memoryItem],
      nextCursor: memoryCursor,
      total: 2,
    });
    const first = await listCorrespondentHistory({
      context,
      input: { ...selection, section: "memory" },
    });
    expect(first.items).toMatchObject([memoryItem]);
    expect(first.items[0]).not.toHaveProperty("threadId");
    expect(first.items[0]).not.toHaveProperty("messageId");
    await listCorrespondentHistory({
      context: { userId: "actor-b" },
      input: { ...selection, section: "memory" },
    });
    expect(mocks.memory).toHaveBeenLastCalledWith({
      mailboxId: selection.mailboxId,
      overview: {
        correspondentEmail: selection.correspondentEmail,
        cursor: undefined,
      },
      userId: "actor-b",
    });
    await listCorrespondentHistory({
      context,
      input: {
        ...selection,
        cursor: first.nextCursor ?? undefined,
        section: "memory",
      },
    });
    expect(mocks.memory).toHaveBeenLastCalledWith({
      mailboxId: selection.mailboxId,
      overview: {
        correspondentEmail: selection.correspondentEmail,
        cursor: memoryCursor,
      },
      userId: context.userId,
    });
  });

  test("advances through sparse reminders and finds a suspended commitment beyond the first reminder page", async () => {
    const later = reminder(53, { status: "suspended" });
    const reminders = [
      ...Array.from({ length: 52 }, (_, index) =>
        reminder(index + 1, {
          target: { kind: "standalone" },
          title: "correspondent@example.test",
        })
      ),
      later,
    ];
    mocks.reminders.mockImplementation(async (input) => {
      const offset =
        input.cursor === undefined
          ? 0
          : reminders.findIndex((item) => item.id === input.cursor) + 1;
      const items = reminders.slice(offset, offset + 50);
      return {
        items,
        nextCursor:
          offset + items.length < reminders.length
            ? (items.at(-1)?.id ?? null)
            : null,
      };
    });
    const first = await listCorrespondentHistory({
      context,
      input: { ...selection, section: "commitments" },
    });
    expect(first.items).toHaveLength(0);
    expect(first.nextCursor).toBeTypeOf("string");
    const remaining = await collectCommitments(first.nextCursor ?? "");
    expect(remaining).toMatchObject([{ id: later.id, status: "suspended" }]);
    expect(mocks.reminders).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: selection.mailboxId,
        userId: context.userId,
        view: "active",
      })
    );
  });

  test("uses only a commitment's own anchor and reuses a current thread for duplicate targets", async () => {
    const unrelatedAnchor = message({
      from: "someone-else@example.test",
      id: "other-anchor",
    });
    const first = reminder(1, {
      target: {
        anchorMessageId: "other-anchor",
        condition: null,
        kind: "thread",
        threadId: "thread-a",
      },
    });
    const second = reminder(2, { status: "suspended" });
    const third = reminder(3);
    mocks.reminders.mockResolvedValue({
      items: [first, second, third],
      nextCursor: null,
    });
    mocks.thread.mockResolvedValue({
      messages: [unrelatedAnchor, message()],
      threadId: "thread-a",
    });
    const page = await listCorrespondentHistory({
      context,
      input: { ...selection, section: "commitments" },
    });
    expect(page.items).toMatchObject([
      { reminder: { id: second.id, status: "suspended" }, source },
      { reminder: { id: third.id }, source },
    ]);
    expect(mocks.thread).toHaveBeenCalledExactlyOnceWith({
      context,
      input: { mailboxId: selection.mailboxId, threadId: "thread-a" },
      recordActivity: false,
    });
  });

  test("bounds current-thread reads and retains the unprocessed reminder continuation", async () => {
    const reminders = Array.from({ length: 20 }, (_, index) =>
      reminder(index + 1, {
        target: {
          anchorMessageId: `message-${index}`,
          condition: null,
          kind: "thread",
          threadId: `thread-${index}`,
        },
      })
    );
    mocks.reminders.mockResolvedValue({
      items: reminders,
      nextCursor: "next-reminder-page",
    });
    mocks.thread.mockImplementation(async ({ input }) => ({
      messages: [],
      threadId: input.threadId,
    }));
    const page = await listCorrespondentHistory({
      context,
      input: { ...selection, section: "commitments" },
    });
    expect(page.items).toHaveLength(0);
    expect(mocks.thread.mock.calls.length).toBeLessThan(reminders.length);
    expect(page.nextCursor).toBeTypeOf("string");
    await listCorrespondentHistory({
      context,
      input: {
        ...selection,
        cursor: page.nextCursor ?? undefined,
        section: "commitments",
      },
    });
    expect(reminders.map((item) => item.id)).toContain(
      mocks.reminders.mock.calls.at(-1)?.[0].cursor
    );
  });

  test("skips deleted reminder sources but fails closed when access is revoked during that read", async () => {
    mocks.thread.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      listCorrespondentHistory({
        context,
        input: { ...selection, section: "commitments" },
      })
    ).resolves.toMatchObject({ items: [], nextCursor: null });
    const access = await mocks.access({
      mailboxId: selection.mailboxId,
      userId: context.userId,
    });
    let revoked = false;
    mocks.access.mockImplementation(async () => {
      if (revoked) {
        throw new ORPCError("FORBIDDEN");
      }
      return access;
    });
    mocks.thread.mockImplementation(async () => {
      revoked = true;
      throw new ORPCError("NOT_FOUND");
    });
    await expect(
      listCorrespondentHistory({
        context,
        input: { ...selection, section: "commitments" },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("returns no invented source revision for mail or commitments", async () => {
    mocks.list.mockResolvedValue({
      messages: [message({ sourceRevision: undefined })],
    });
    mocks.thread.mockResolvedValue({
      messages: [message({ sourceRevision: undefined })],
      threadId: "thread-a",
    });
    await expect(
      listCorrespondentHistory({
        context,
        input: { ...selection, section: "mail" },
      })
    ).resolves.toMatchObject({ items: [{ source: null }] });
    await expect(
      listCorrespondentHistory({
        context,
        input: { ...selection, section: "commitments" },
      })
    ).resolves.toMatchObject({ items: [{ source: null }] });
  });

  test("loads a fresh complete canonical thread to open a matching source", async () => {
    const canonical = {
      messages: [
        message({ bodyText: "Current source body", isImportant: true }),
        message({ from: "another@example.test", id: "another-message" }),
      ],
      subject: "Complete thread",
      threadId: "thread-a",
    };
    mocks.thread.mockResolvedValue(canonical);
    const opened = await openCorrespondentSource({
      context,
      input: { ...selection, source },
    });
    expect(opened).toMatchObject({
      messageId: source.messageId,
      thread: canonical,
    });
    expect(mocks.thread).toHaveBeenCalledWith({
      context,
      input: { mailboxId: selection.mailboxId, threadId: source.threadId },
      recordActivity: false,
    });
  });

  test.each([
    { messages: [message()], threadId: "other-thread" },
    { messages: [message({ id: "other-message" })], threadId: "thread-a" },
    { messages: [message({ threadId: "other-thread" })], threadId: "thread-a" },
    {
      messages: [message({ from: "other@example.test" })],
      threadId: "thread-a",
    },
    { messages: [message({ labelIds: ["DRAFT"] })], threadId: "thread-a" },
    { messages: [message({ labelIds: ["SPAM"] })], threadId: "thread-a" },
    { messages: [message({ labelIds: ["TRASH"] })], threadId: "thread-a" },
  ])("rejects missing or ineligible source membership", async (thread) => {
    mocks.thread.mockResolvedValue(thread);
    await expect(
      openCorrespondentSource({ context, input: { ...selection, source } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test.each(["changed-revision", undefined])(
    "detects a changed or unavailable source revision",
    async (sourceRevision) => {
      await listCorrespondentHistory({
        context,
        input: { ...selection, section: "mail" },
      });
      mocks.thread.mockResolvedValue({
        messages: [message({ sourceRevision })],
        threadId: "thread-a",
      });
      await expect(
        openCorrespondentSource({ context, input: { ...selection, source } })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
  );

  test("does not reopen a previously listed source after a fresh access revocation", async () => {
    await listCorrespondentHistory({
      context,
      input: { ...selection, section: "mail" },
    });
    mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      openCorrespondentSource({ context, input: { ...selection, source } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.thread).not.toHaveBeenCalled();
  });

  test("discards a complete source thread when access is revoked during the read", async () => {
    const access = await mocks.access({
      mailboxId: selection.mailboxId,
      userId: context.userId,
    });
    let revoked = false;
    mocks.access.mockImplementation(async () => {
      if (revoked) {
        throw new ORPCError("NOT_FOUND");
      }
      return access;
    });
    mocks.thread.mockImplementation(async () => {
      revoked = true;
      return { messages: [message()], threadId: "thread-a" };
    });
    await expect(
      openCorrespondentSource({ context, input: { ...selection, source } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test.each(["mail", "memory", "commitments"] as const)(
    "recovers on a later %s request after an external failure",
    async (section) => {
      const failure = new Error("External service unavailable");
      mocks.list.mockRejectedValueOnce(failure);
      mocks.memory.mockRejectedValueOnce(failure);
      mocks.reminders.mockRejectedValueOnce(failure);
      const input: CorrespondentHistoryInput = { ...selection, section };
      await expect(listCorrespondentHistory({ context, input })).rejects.toBe(
        failure
      );
      await expect(
        listCorrespondentHistory({ context, input })
      ).resolves.toMatchObject({ items: [expect.anything()], section });
    }
  );

  test("respects cancellation before reads and after a memory read completes", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      listCorrespondentHistory({
        context: { ...context, signal: controller.signal },
        input: { ...selection, section: "mail" },
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.list).not.toHaveBeenCalled();
    const active = new AbortController();
    mocks.memory.mockImplementation(async () => {
      active.abort();
      return {
        hasMore: false,
        items: [memoryItem],
        nextCursor: null,
        total: 1,
      };
    });
    await expect(
      listCorrespondentHistory({
        context: { ...context, signal: active.signal },
        input: { ...selection, section: "memory" },
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
