/* oxlint-disable vitest/prefer-import-in-mock -- Mailbox authorization is the mocked boundary around native PostgreSQL query behavior. */
import { ORPCError } from "@orpc/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  attachMailSnoozeStates,
  filterMailSnoozeVisibility,
  listMailSnoozePage,
} from "../src/snooze/queries";

const fixture = await vi.hoisted(async () => {
  const databaseUrl = process.env.QUIETER_TEST_SNOOZE_QUERY_DATABASE_URL;
  if (databaseUrl !== undefined) {
    const url = new URL(databaseUrl);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/mail_snooze_queries_fixture"
    ) {
      throw new Error(
        "Snooze query tests require a loopback mail_snooze_queries_fixture database."
      );
    }
  }
  const [{ default: postgres }, { drizzle }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  const client = postgres(
    databaseUrl ??
      "postgresql://postgres@127.0.0.1:1/mail_snooze_queries_fixture",
    { connect_timeout: 3, max: 2, onnotice: () => {} }
  );
  return {
    client,
    database: drizzle({ client }),
    enabled: databaseUrl !== undefined,
    state: { access: true },
  };
});

vi.mock("@quieter/database/client", () => ({ db: fixture.database }));
vi.mock("../src/mailbox-changes", () => ({
  appendMailboxChange: vi
    .fn<() => Promise<{ queued: boolean }>>()
    .mockResolvedValue({ queued: true }),
  publishMailboxChange: vi.fn<() => Promise<void>>().mockResolvedValue(),
}));
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: async () => {
    if (!fixture.state.access) {
      throw new ORPCError("FORBIDDEN");
    }
    return await Promise.resolve({ provider: "managed" });
  },
}));
vi.mock("../src/mail-updates", () => ({
  publishMailUpdate: async () => {
    await Promise.resolve();
  },
}));

const seedSnooze = async (input: {
  id: string;
  mailboxId?: string;
  ownerId?: string;
  status?: "active" | "preparing" | "failed";
  due?: number;
}) => {
  const mailboxId = input.mailboxId ?? "mailbox";
  if (input.ownerId) {
    await fixture.client`insert into "mailPlacementOperation" (id, "actorUserId", "mailboxId", "requestId", "requestHash", "threadId", "requestedMessageIds", "messageIds", placement, status, "createdAt", "updatedAt") values (${input.ownerId}, 'actor', ${mailboxId}, ${input.ownerId}, 'hash', ${input.id}, '["hidden"]', '["hidden"]', 'done', 'applied', now(), now())`;
  }
  await fixture.client`insert into "mailSnooze" (id, "actorUserId", "mailboxId", "threadId", version, "returnAt", "timeZone", status, "hideRequestId", "hideOperationId", "knownIncomingMessageIds", "hiddenMessageIds", "createdAt", "updatedAt") values (${input.id}, 'actor', ${mailboxId}, ${input.id}, 1, ${new Date(input.due ?? 10_000).toISOString()}, 'Etc/UTC', ${input.status ?? "active"}, ${`request-${input.id}`}, ${input.ownerId ?? null}, '["hidden"]', ${input.ownerId ? '["hidden"]' : "[]"}, now(), now())`;
};

describe.skipIf(!fixture.enabled)("canonical Snooze query membership", () => {
  beforeAll(async () => {
    await fixture.client.unsafe(`
      create table if not exists mailbox (id text primary key, provider text not null default 'managed', "contentRevision" bigint not null default 0, "updatedAt" timestamptz not null default now());
      create table if not exists "mailPlacementOperation" (
        id text primary key, sequence bigserial not null unique, "actorUserId" text not null,
        "mailboxId" text not null references mailbox(id), "requestId" text not null,
        "requestHash" text not null, "threadId" text not null,
        "requestedMessageIds" jsonb not null, "messageIds" jsonb not null,
        placement text not null, status text not null, code text, message text,
        "createdAt" timestamptz not null, "updatedAt" timestamptz not null
      );
      create table if not exists "mailSnooze" (
        id text primary key, "mailboxId" text not null references mailbox(id),
        "threadId" text not null, "actorUserId" text, version integer not null,
        "returnAt" timestamptz not null, "timeZone" text not null, status text not null,
        "hideRequestId" text not null, "returnRequestId" text,
        "hideOperationId" text, "returnOperationId" text,
        "knownIncomingMessageIds" jsonb not null, "hiddenMessageIds" jsonb not null,
        "nextWakeAt" timestamptz, "leaseToken" text, "leaseUntil" timestamptz,
        attempts integer not null default 0, code text, message text,
        "createdAt" timestamptz not null, "updatedAt" timestamptz not null,
        unique ("mailboxId", "threadId")
      );
    `);
  });
  beforeEach(async () => {
    await fixture.client.unsafe(
      'truncate "mailSnooze", "mailPlacementOperation", mailbox restart identity cascade'
    );
    await fixture.client`insert into mailbox (id) values ('mailbox'), ('other-mailbox')`;
    fixture.state.access = true;
  });

  afterAll(async () => {
    await fixture.client.end();
  });

  test("keeps shared pending and failed source mail visible while suppressing only owned Done placement", async () => {
    await seedSnooze({ id: "hidden", ownerId: "hide" });
    await seedSnooze({ id: "pending", status: "preparing" });
    await seedSnooze({ id: "failed", status: "failed" });
    const scope = {
      mailboxId: "mailbox",
      threadIds: ["hidden", "pending", "failed"],
      userId: "reader",
    };
    const later = await filterMailSnoozeVisibility({
      ...scope,
      category: "later",
    });
    const done = await filterMailSnoozeVisibility({
      ...scope,
      category: "done",
    });
    for (const threadId of scope.threadIds) {
      expect(later.has(threadId)).toBeTruthy();
    }
    expect(done.has("hidden")).toBeFalsy();
    expect(done.has("pending")).toBeTruthy();
    expect(done.has("failed")).toBeTruthy();
  });

  test("a newer foreign placement retires membership even if the stored schedule status is stale", async () => {
    await seedSnooze({ id: "thread", ownerId: "hide" });
    await fixture.client`insert into "mailPlacementOperation" (id, "actorUserId", "mailboxId", "requestId", "requestHash", "threadId", "requestedMessageIds", "messageIds", placement, status, "createdAt", "updatedAt") values ('newer', 'other', 'mailbox', 'newer', 'new-hash', 'thread', '["hidden"]', '[]', 'done', 'applied', now(), now())`;
    const scope = {
      mailboxId: "mailbox",
      threadIds: ["thread"],
      userId: "actor",
    };
    const later = await filterMailSnoozeVisibility({
      ...scope,
      category: "later",
    });
    const done = await filterMailSnoozeVisibility({
      ...scope,
      category: "done",
    });
    expect(later.has("thread")).toBeFalsy();
    expect(done.has("thread")).toBeTruthy();
  });

  test("keeps an orphaned schedule discoverable without claiming its missing predecessor owns Done", async () => {
    await seedSnooze({ id: "orphan" });
    await fixture.client`update "mailSnooze" set "actorUserId" = null where id = 'orphan'`;
    const scope = {
      mailboxId: "mailbox",
      threadIds: ["orphan"],
      userId: "reader",
    };
    const later = await filterMailSnoozeVisibility({
      ...scope,
      category: "later",
    });
    const done = await filterMailSnoozeVisibility({
      ...scope,
      category: "done",
    });
    expect(later.has("orphan")).toBeTruthy();
    expect(done.has("orphan")).toBeTruthy();
  });

  test("repairs a missed new-reply observer using fresh canonical source state and preserves the terminal version", async () => {
    await seedSnooze({ id: "thread", ownerId: "hide" });
    const messages = await attachMailSnoozeStates({
      mailboxId: "mailbox",
      messages: [
        {
          id: "sent",
          labelIds: ["SENT"],
          threadId: "thread",
          threadInboxIncomingMessageIds: ["reply"],
          threadLabelIds: ["INBOX", "SENT"],
        },
      ],
      userId: "reader",
    });
    expect(messages[0]?.snooze).toMatchObject({ status: "superseded" });
    expect(messages[0]?.snooze?.version).toBeGreaterThan(1);
    const current = await filterMailSnoozeVisibility({
      category: "later",
      mailboxId: "mailbox",
      threadIds: ["thread"],
      userId: "reader",
    });
    expect(current.has("thread")).toBeFalsy();
  });

  test("keeps a newly active Snooze when a pre-hide Inbox projection arrives late", async () => {
    await seedSnooze({ id: "thread", ownerId: "hide" });
    const messages = await attachMailSnoozeStates({
      mailboxId: "mailbox",
      messages: [
        {
          id: "hidden",
          labelIds: ["INBOX"],
          threadId: "thread",
          threadInboxIncomingMessageIds: ["hidden"],
          threadLabelIds: ["INBOX"],
        },
      ],
      userId: "reader",
    });
    expect(messages[0]?.snooze).toMatchObject({ status: "active" });
    const later = await filterMailSnoozeVisibility({
      category: "later",
      mailboxId: "mailbox",
      threadIds: ["thread"],
      userId: "reader",
    });
    expect(later.has("thread")).toBeTruthy();
  });

  test("does not treat an in-flight return or failed hide in Inbox as a newly reopened active Snooze", async () => {
    await seedSnooze({ id: "returning", ownerId: "hide-return" });
    await fixture.client`update "mailSnooze" set status = 'returning' where id = 'returning'`;
    await seedSnooze({ id: "failed", status: "failed" });
    const messages = await attachMailSnoozeStates({
      mailboxId: "mailbox",
      messages: [
        { id: "returning-message", labelIds: ["INBOX"], threadId: "returning" },
        { id: "failed-message", labelIds: ["INBOX"], threadId: "failed" },
      ],
      userId: "reader",
    });
    const statuses = messages.map((message) => message.snooze?.status);
    expect(statuses).toContain("returning");
    expect(statuses).toContain("failed");
  });

  test("does not retire confirmed hidden mail when only a sent sibling has the Inbox label", async () => {
    await seedSnooze({ id: "thread", ownerId: "hide" });
    const messages = await attachMailSnoozeStates({
      mailboxId: "mailbox",
      messages: [
        {
          id: "hidden",
          labelIds: [],
          threadId: "thread",
          threadInboxIncomingMessageIds: [],
          threadLabelIds: ["INBOX", "SENT"],
        },
        {
          id: "sent",
          labelIds: ["INBOX", "SENT"],
          threadId: "thread",
        },
      ],
      userId: "reader",
    });
    expect(messages[0]?.snooze).toMatchObject({ status: "active" });
    const later = await filterMailSnoozeVisibility({
      category: "later",
      mailboxId: "mailbox",
      threadIds: ["thread"],
      userId: "reader",
    });
    expect(later.has("thread")).toBeTruthy();
  });

  test("paginates by return deadline, scopes its cursor, and rejects reads after access is revoked", async () => {
    await seedSnooze({
      due: 5000,
      id: "foreign",
      mailboxId: "other-mailbox",
    });
    await seedSnooze({ due: 30_000, id: "later" });
    await seedSnooze({ due: 10_000, id: "first" });
    await seedSnooze({ due: 20_000, id: "middle" });
    const scope = { mailboxId: "mailbox", maxResults: 1, userId: "reader" };
    const first = await listMailSnoozePage(scope);
    expect(first.snoozes.map((snooze) => snooze.threadId)).toContain("first");
    const middle = await listMailSnoozePage({
      ...scope,
      pageToken: first.nextPageToken,
    });
    expect(middle.snoozes.map((snooze) => snooze.threadId)).toContain("middle");
    await expect(
      listMailSnoozePage({
        ...scope,
        mailboxId: "other-mailbox",
        pageToken: first.nextPageToken,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    fixture.state.access = false;
    await expect(listMailSnoozePage(scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
