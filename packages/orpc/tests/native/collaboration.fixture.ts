/* oxlint-disable promise/prefer-await-to-then -- Race observers attach rejection handlers while the operation stays blocked. */
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";

import { createRouterClient } from "@orpc/server";
import type { CollaborationState } from "@quieter/mail/collaboration";
import type { CollaborationNoteCommand } from "@quieter/mail/collaboration-notes";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
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

import { getAuthorizedManagedMailbox } from "../../src/mailbox/access";
import { lockCollaborationThread } from "../../src/mailbox/collaboration/access";
import { deleteManagedMailbox } from "../../src/mailbox/deletion";
import { collaborationRouter } from "../../src/routers/collaboration";

const fixture = await vi.hoisted(async () => {
  const urlText = process.env.QUIETER_TEST_COLLABORATION_DATABASE_URL;
  if (!urlText) {
    throw new Error(
      "An explicitly leased collaboration_fixture URL is required."
    );
  }
  const url = new URL(urlText);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/collaboration_fixture" ||
    url.search !== ""
  ) {
    throw new Error(
      "Native collaboration checks require loopback collaboration_fixture."
    );
  }
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://postgres@127.0.0.1:1/collaboration_fixture"
  );
  vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "production");
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Vitest requires the second argument to remove a fixture variable.
  vi.stubEnv("MAIL_UPDATES_URL", undefined);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Vitest requires the second argument to remove a fixture variable.
  vi.stubEnv("GMAIL_LIVE_SYNC_URL", undefined);
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Native fixture forbids external fetch."))
  );
  const [{ default: createPostgres }, { drizzle }, schema] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
    import("@quieter/database/schema"),
  ]);
  const label = `f203-${crypto.randomUUID()}`;
  const client = createPostgres(urlText, {
    connect_timeout: 3,
    connection: { application_name: label },
    max: 2,
    onnotice: vi.fn<(notice: postgres.Notice) => void>(),
  });
  return {
    client,
    createPostgres,
    database: drizzle({ client, relations: schema.authRelations }),
    label,
    urlText,
  };
});

vi.mock("@quieter/database/client", () => ({
  assertDatabaseConfigured: vi.fn<() => void>(),
  db: fixture.database,
  withRequestDatabaseClient: async <Result>(
    run: (database: typeof fixture.database) => Result | Promise<Result>
  ): Promise<Result> => await run(fixture.database),
}));

vi.mock("@quieter/auth/session", () => ({
  // oxlint-disable-next-line eslint/require-await -- The synthetic provider keeps the asynchronous session contract.
  getSessionWithOrganization: async (headers: Headers) => {
    const id = headers.get("x-collaboration-fixture-user");
    if (!id) {
      return null;
    }
    return {
      session: { id: `synthetic-session-${id}` },
      user: { email: `${id}@example.test`, id, name: "Synthetic teammate" },
    };
  },
}));

vi.mock("@quieter/observability", () => ({ reportError: vi.fn() }));

const ownedOrganizations = new Set<string>();
const ownedUsers = new Set<string>();

const seedFixture = async () => {
  const teamId = randomUUID();
  const ownerId = randomUUID();
  const actorId = randomUUID();
  const readerId = randomUUID();
  const ownerMemberId = randomUUID();
  const actorMemberId = randomUUID();
  const readerMemberId = randomUUID();
  const mailboxId = randomUUID();
  const threadId = `thread ?&/# ${randomUUID()}`;
  const messageId = randomUUID();
  const privateBody = `private-mail-body-${randomUUID()}`;
  const privateMemory = `private-memory-${randomUUID()}`;
  ownedOrganizations.add(teamId);
  for (const id of [ownerId, actorId, readerId]) {
    ownedUsers.add(id);
    await fixture.client`
      insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${id}, 'Synthetic teammate', ${`${id}@example.test`}, true, now(), now())
    `;
  }
  await fixture.client`
    insert into organization (id, name, slug, "createdAt", "updatedAt")
    values (${teamId}, 'Native collaboration fixture', ${teamId}, now(), now())
  `;
  for (const membership of [
    { id: ownerMemberId, role: "owner", userId: ownerId },
    { id: actorMemberId, role: "member", userId: actorId },
    { id: readerMemberId, role: "member", userId: readerId },
  ]) {
    await fixture.client`
      insert into member (id, "organizationId", "userId", role, "createdAt")
      values (${membership.id}, ${teamId}, ${membership.userId}, ${membership.role}, now())
    `;
  }
  await fixture.client`
    update organization set "billingOwnerUserId" = ${ownerId} where id = ${teamId}
  `;
  await fixture.client`
    insert into "userAiContext" (id, "userId", markdown, "createdAt", "updatedAt", "lastEditedAt")
    values (${randomUUID()}, ${actorId}, ${privateMemory}, now(), now(), now())
  `;
  await fixture.client`
    insert into mailbox (id, "organizationId", provider, "accessMode", "emailAddress", "createdAt", "updatedAt")
    values (${mailboxId}, ${teamId}, 'managed', 'shared', ${`${mailboxId}@example.test`}, now(), now())
  `;
  for (const grant of [
    { memberId: ownerMemberId, role: "manager", userId: ownerId },
    { memberId: actorMemberId, role: "responder", userId: actorId },
    { memberId: readerMemberId, role: "reader", userId: readerId },
  ]) {
    await fixture.client`
      insert into "mailboxGrant" (id, "mailboxId", "memberId", "userId", role, "createdAt", "updatedAt")
      values (${randomUUID()}, ${mailboxId}, ${grant.memberId}, ${grant.userId}, ${grant.role}, now(), now())
    `;
  }
  await fixture.client`
    insert into "managedMailMessage" (id, "mailboxId", "providerMessageId", "threadId", direction,
      "from", "to", "bodyText", "createdAt", "updatedAt", "sentAt")
    values (${messageId}, ${mailboxId}, ${messageId}, ${threadId}, 'inbound',
      'sender@example.test', 'team@example.test', ${privateBody}, now(), now(), now())
  `;
  return {
    actorId,
    actorMemberId,
    mailboxId,
    messageId,
    ownerId,
    ownerMemberId,
    privateBody,
    privateMemory,
    readerId,
    readerMemberId,
    scope: { mailboxId, threadId },
    teamId,
    threadId,
  };
};

let current: Awaited<ReturnType<typeof seedFixture>>;

const rpcFor = (userId?: string) => {
  const headers = new Headers();
  if (userId !== undefined) {
    headers.set("x-collaboration-fixture-user", userId);
  }
  return createRouterClient(collaborationRouter, {
    context: { db: fixture.database, headers },
  });
};

const waitForBlocking = async (
  observer: Pick<postgres.Sql, "unsafe">,
  blockedPid: number,
  blockerPid: number
) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const [row] = await observer.unsafe<{ blocked: boolean }[]>(
      "select $2::integer = any(pg_blocking_pids($1::integer)) as blocked",
      [blockedPid, blockerPid]
    );
    if (row?.blocked) {
      return;
    }
    await pause(10);
  }
  throw new Error("Required PostgreSQL lock wait was not observed.");
};

const contextCounts = async () => {
  const [row] = await fixture.client<{ contexts: number; events: number }[]>`
    select count(distinct c.id)::integer as contexts, count(e."contextId")::integer as events
    from "managedThreadCollaboration" c
    left join "managedThreadCollaborationEvent" e on e."contextId" = c.id
    where c."mailboxId" = ${current.mailboxId} and c."threadId" = ${current.threadId}
  `;
  if (row === undefined) {
    throw new Error("Context count query returned no aggregate.");
  }
  return row;
};

const extraMessage = async (threadId = current.threadId, state = "active") => {
  const id = randomUUID();
  await fixture.client`
    insert into "managedMailMessage" (id, "mailboxId", "providerMessageId", "threadId", direction,
      "from", "to", "mailboxState", "createdAt", "updatedAt", "sentAt")
    values (${id}, ${current.mailboxId}, ${id}, ${threadId}, 'inbound',
      'sender@example.test', 'team@example.test', ${state}, now(), now(), now())
  `;
  return id;
};

beforeAll(async () => {
  const [database] = await fixture.client<
    { isolation: string; name: string }[]
  >`
    select current_database() as name, current_setting('default_transaction_isolation') as isolation
  `;
  if (database?.name !== "collaboration_fixture") {
    throw new Error(
      "Database identity does not match the leased native fixture."
    );
  }
  if (database.isolation !== "read committed") {
    throw new Error(
      "Native lifecycle races require READ COMMITTED as the fixture default."
    );
  }
  const triggers = await fixture.client<{ tgname: string }[]>`
    select tgname from pg_trigger
    where not tgisinternal and tgrelid in ('member'::regclass, '"managedMailMessage"'::regclass)
  `;
  if (
    !triggers.some(
      (row) => row.tgname === "member_preserve_organization_funding"
    )
  ) {
    throw new Error("Fixture lacks the real member funding trigger.");
  }
  if (
    !triggers.some(
      (row) => row.tgname === "managed_thread_collaboration_delete_empty"
    ) ||
    !triggers.some(
      (row) => row.tgname === "managed_thread_collaboration_move_empty"
    )
  ) {
    throw new Error(
      "Fixture lacks the coordinator collaboration lifecycle migration."
    );
  }
  await fixture.client`select "contextId", "actorMemberId" from "managedThreadCollaborationEvent" limit 0`;
});

beforeEach(async () => {
  current = await seedFixture();
});

afterEach(async () => {
  if (ownedOrganizations.size > 0) {
    await fixture.client`delete from organization where id in ${fixture.client([...ownedOrganizations])}`;
    ownedOrganizations.clear();
  }
  if (ownedUsers.size > 0) {
    await fixture.client`delete from "user" where id in ${fixture.client([...ownedUsers])}`;
    ownedUsers.clear();
  }
});

afterAll(async () => {
  await fixture.client.end({ timeout: 3 });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("actual protected collaboration RPC", () => {
  test("requires authentication and refuses injected actors", async () => {
    await expect(rpcFor().get(current.scope)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const injected = { ...current.scope, userId: current.ownerId };
    await expect(
      rpcFor(current.readerId).prepare(injected)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
  });

  test("reader access has no write side effect and cannot prepare", async () => {
    const snapshot = await rpcFor(current.readerId).get(current.scope);
    expect(snapshot.state.kind).toBe("unprepared");
    expect(snapshot.permissions.assignOthers).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain(current.privateBody);
    expect(JSON.stringify(snapshot)).not.toContain(current.privateMemory);
    await expect(
      rpcFor(current.readerId).prepare(current.scope)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
  });

  test("two preparations and a retry create one context and receipt", async () => {
    const [first, second] = await Promise.all([
      rpcFor(current.actorId).prepare(current.scope),
      rpcFor(current.ownerId).prepare(current.scope),
    ]);
    expect(first.state.kind).toBe("prepared");
    expect(second.state).toMatchObject(first.state);
    const again = await rpcFor(current.actorId).prepare(current.scope);
    expect(again.state).toMatchObject(first.state);
    expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
    expect(first.permissions.claimSelf).toBe(true);
    expect(second.permissions.assignOthers).toBe(true);
    expect(JSON.stringify(second)).not.toContain(current.privateMemory);
  });

  test("a role downgrade changes permissions without changing the cursor", async () => {
    const session = rpcFor(current.actorId);
    const before = await session.prepare(current.scope);
    if (before.state.kind !== "prepared") {
      throw new Error("Preparation must persist a context before downgrade.");
    }
    await fixture.client`
      update "mailboxGrant" set role = 'reader'
      where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.actorMemberId}
    `;
    const changes = await session.changes({
      ...current.scope,
      after: before.state.cursor,
    });
    expect(changes).toMatchObject({
      changed: false,
      reset: false,
      snapshot: {
        permissions: { claimSelf: false, writeOwnNotes: false },
        role: "reader",
        state: before.state,
      },
    });
    await expect(session.prepare(current.scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
  });

  test("links and unchanged cursors do not retain revoked authority", async () => {
    const session = rpcFor(current.actorId);
    const snapshot = await session.prepare(current.scope);
    if (snapshot.state.kind !== "prepared") {
      throw new Error("Preparation did not return a persisted context.");
    }
    const link = new URL(snapshot.href, "https://example.test");
    expect(link.searchParams.get("mailboxId")).toBe(current.mailboxId);
    expect(link.searchParams.get("threadId")).toBe(current.threadId);
    await fixture.client`delete from "mailboxGrant" where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.actorMemberId}`;
    await expect(session.get(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      session.changes({ ...current.scope, after: snapshot.state.cursor })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(session.prepare(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const reloaded1 = await rpcFor(current.ownerId).get(current.scope);
    expect(reloaded1.state).toMatchObject(snapshot.state);
  });

  test("rechecks division grants and membership after each poll", async () => {
    const divisionId = randomUUID();
    await fixture.client`delete from "mailboxGrant" where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.actorMemberId}`;
    await fixture.client`
      insert into "organizationDivision" (id, "organizationId", name, "normalizedName", "createdAt", "updatedAt")
      values (${divisionId}, ${current.teamId}, 'Fixture division', ${divisionId}, now(), now())
    `;
    await fixture.client`
      insert into "organizationDivisionMember" (id, "divisionId", "memberId", "createdAt")
      values (${randomUUID()}, ${divisionId}, ${current.actorMemberId}, now())
    `;
    await fixture.client`
      insert into "mailboxDivisionGrant" (id, "mailboxId", "divisionId", role, "createdAt", "updatedAt")
      values (${randomUUID()}, ${current.mailboxId}, ${divisionId}, 'responder', now(), now())
    `;
    const session = rpcFor(current.actorId);
    const snapshot = await session.prepare(current.scope);
    if (snapshot.state.kind !== "prepared") {
      throw new Error("Preparation did not return a persisted context.");
    }
    await fixture.client`delete from "organizationDivisionMember" where "memberId" = ${current.actorMemberId} and "divisionId" = ${divisionId}`;
    await expect(
      session.changes({ ...current.scope, after: snapshot.state.cursor })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await fixture.client`
      insert into "organizationDivisionMember" (id, "divisionId", "memberId", "createdAt")
      values (${randomUUID()}, ${divisionId}, ${current.actorMemberId}, now())
    `;
    await session.get(current.scope);
    await fixture.client`delete from "mailboxDivisionGrant" where "mailboxId" = ${current.mailboxId} and "divisionId" = ${divisionId}`;
    await expect(session.get(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("member departure nulls audit attribution and rejoin does not revive a grant", async () => {
    const session = rpcFor(current.actorId);
    await session.prepare(current.scope);
    await fixture.client`delete from member where id = ${current.actorMemberId}`;
    const [audit] = await fixture.client<{ actorMemberId: string | null }[]>`
      select e."actorMemberId" from "managedThreadCollaborationEvent" e
      join "managedThreadCollaboration" c on c.id = e."contextId"
      where c."mailboxId" = ${current.mailboxId} and c."threadId" = ${current.threadId}
    `;
    expect(audit?.actorMemberId).toBeNull();
    await expect(session.get(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await fixture.client`
      insert into member (id, "organizationId", "userId", role, "createdAt")
      values (${randomUUID()}, ${current.teamId}, ${current.actorId}, 'member', now())
    `;
    await expect(session.get(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
  });

  test("the actual funding trigger refuses deleting the current payer", async () => {
    await expect(
      fixture.client`delete from member where id = ${current.ownerMemberId}`
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "organization_funding_owner_membership",
    });
    await rpcFor(current.ownerId).get(current.scope);
  });

  test("private managed and Gmail identities cannot enter collaboration", async () => {
    for (const provider of ["managed", "gmail"]) {
      const mailboxId = randomUUID();
      if (provider === "managed") {
        await fixture.client`
          insert into mailbox (id, "organizationId", provider, "accessMode", "managedOwnerUserId", "emailAddress", "createdAt", "updatedAt")
          values (${mailboxId}, ${current.teamId}, 'managed', 'private', ${current.actorId}, ${`${mailboxId}@example.test`}, now(), now())
        `;
        const messageId = randomUUID();
        await fixture.client`
          insert into "managedMailMessage" (id, "mailboxId", "providerMessageId", "threadId", direction,
            "from", "bodyText", "createdAt", "updatedAt", "sentAt")
          values (${messageId}, ${mailboxId}, ${messageId}, ${current.threadId}, 'inbound',
            'sender@example.test', ${current.privateBody}, now(), now(), now())
        `;
        await expect(
          getAuthorizedManagedMailbox(
            { mailboxId, userId: current.actorId },
            fixture.database
          )
        ).resolves.toMatchObject({ ownerUserId: current.actorId });
      } else {
        await fixture.client`
          insert into mailbox (id, "organizationId", provider, "ownerUserId", "emailAddress", "createdAt", "updatedAt")
          values (${mailboxId}, ${current.teamId}, 'gmail', ${current.actorId}, ${`${mailboxId}@example.test`}, now(), now())
        `;
      }
      await expect(
        rpcFor(current.actorId).get({ mailboxId, threadId: current.threadId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        rpcFor(current.actorId).prepare({
          mailboxId,
          threadId: current.threadId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      if (provider === "managed") {
        await fixture.client`
          insert into "mailboxGrant" (id, "mailboxId", "memberId", "userId", role, "createdAt", "updatedAt")
          values (${randomUUID()}, ${mailboxId}, ${current.readerMemberId}, ${current.readerId}, 'manager', now(), now())
        `;
        await expect(
          getAuthorizedManagedMailbox(
            { mailboxId, userId: current.readerId },
            fixture.database
          )
        ).resolves.toMatchObject({ ownerUserId: current.actorId });
        await expect(
          rpcFor(current.readerId).get({
            mailboxId,
            threadId: current.threadId,
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          rpcFor(current.readerId).prepare({
            mailboxId,
            threadId: current.threadId,
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
    }
  });

  test("foreign and missing thread pairs return no collaboration state", async () => {
    await rpcFor(current.actorId).prepare(current.scope);
    await expect(
      rpcFor(current.actorId).get({ ...current.scope, threadId: randomUUID() })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      rpcFor(current.actorId).get({ ...current.scope, mailboxId: randomUUID() })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("the same thread identity stays independent in two live mailboxes", async () => {
    const otherMailboxId = randomUUID();
    const otherMessageId = randomUUID();
    const otherScope = {
      mailboxId: otherMailboxId,
      threadId: current.threadId,
    };
    await fixture.client`
      insert into mailbox (id, "organizationId", provider, "accessMode", "emailAddress", "createdAt", "updatedAt")
      values (${otherMailboxId}, ${current.teamId}, 'managed', 'shared', ${`${otherMailboxId}@example.test`}, now(), now())
    `;
    for (const grant of [
      {
        memberId: current.actorMemberId,
        role: "responder",
        userId: current.actorId,
      },
      {
        memberId: current.ownerMemberId,
        role: "manager",
        userId: current.ownerId,
      },
    ]) {
      await fixture.client`
        insert into "mailboxGrant" (id, "mailboxId", "memberId", "userId", role, "createdAt", "updatedAt")
        values (${randomUUID()}, ${otherMailboxId}, ${grant.memberId}, ${grant.userId}, ${grant.role}, now(), now())
      `;
    }
    await fixture.client`
      insert into "managedMailMessage" (id, "mailboxId", "providerMessageId", "threadId", direction,
        "from", "createdAt", "updatedAt", "sentAt")
      values (${otherMessageId}, ${otherMailboxId}, ${otherMessageId}, ${current.threadId}, 'inbound',
        'other-sender@example.test', now(), now(), now())
    `;
    const session = rpcFor(current.actorId);
    const [primary, other] = await Promise.all([
      session.prepare(current.scope),
      session.prepare(otherScope),
    ]);
    if (primary.state.kind !== "prepared" || other.state.kind !== "prepared") {
      throw new Error("Both mailbox contexts must be prepared.");
    }
    const primaryCursor = primary.state.cursor;
    const otherCursor = other.state.cursor;
    expect(primaryCursor.contextId).not.toBe(otherCursor.contextId);
    const reloaded2 = await session.get(current.scope);
    expect(reloaded2.state).toMatchObject(primary.state);
    const reloaded3 = await session.get(otherScope);
    expect(reloaded3.state).toMatchObject(other.state);
    expect(
      await session.changes({ ...current.scope, after: primaryCursor })
    ).toMatchObject({ changed: false, reset: false });
    expect(
      await session.changes({ ...otherScope, after: otherCursor })
    ).toMatchObject({ changed: false, reset: false });
    const foreignCursor = await session.changes({
      ...otherScope,
      after: primaryCursor,
    });
    expect(foreignCursor).toMatchObject({
      changed: true,
      reset: true,
      snapshot: { mailboxId: otherMailboxId },
    });
    expect(foreignCursor.snapshot.state).toMatchObject(other.state);

    await fixture.client`
      delete from "mailboxGrant"
      where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.actorMemberId}
    `;
    await expect(session.get(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      session.changes({ ...current.scope, after: primaryCursor })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(session.prepare(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const reloaded4 = await session.prepare(otherScope);
    expect(reloaded4.state).toMatchObject(other.state);
    expect(
      await session.changes({ ...otherScope, after: otherCursor })
    ).toMatchObject({ changed: false, reset: false });

    await fixture.client`delete from "managedMailMessage" where id = ${current.messageId}`;
    await expect(
      rpcFor(current.ownerId).get(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const retained = await fixture.client<{ id: string }[]>`
      select id from "managedThreadCollaboration"
      where id in (${primaryCursor.contextId}, ${otherCursor.contextId})
    `;
    expect(retained).toHaveLength(1);
    expect(retained[0]?.id).toBe(otherCursor.contextId);
    const removedEvents = await fixture.client`
      select "contextId" from "managedThreadCollaborationEvent" where "contextId" = ${primaryCursor.contextId}
    `;
    expect(removedEvents).toHaveLength(0);
    const reloaded5 = await session.get(otherScope);
    expect(reloaded5.state).toMatchObject(other.state);
    expect(
      await session.changes({ ...otherScope, after: otherCursor })
    ).toMatchObject({ changed: false, reset: false });
    await extraMessage();
    const recreated = await rpcFor(current.ownerId).prepare(current.scope);
    if (recreated.state.kind !== "prepared") {
      throw new Error("The recreated source context must be prepared.");
    }
    expect(recreated.state.cursor.contextId).not.toBe(primaryCursor.contextId);
    expect(recreated.state.cursor.contextId).not.toBe(otherCursor.contextId);
    const reloaded6 = await session.prepare(otherScope);
    expect(reloaded6.state).toMatchObject(other.state);
    await expect(session.get(current.scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("native collaboration lifecycle", () => {
  test("one-of-many deletion preserves context and last deletion removes context and audit", async () => {
    const other = await extraMessage();
    const before = await rpcFor(current.actorId).prepare(current.scope);
    await fixture.client`delete from "managedMailMessage" where id = ${current.messageId}`;
    const reloaded7 = await rpcFor(current.actorId).get(current.scope);
    expect(reloaded7.state).toMatchObject(before.state);
    await fixture.client`delete from "managedMailMessage" where id = ${other}`;
    expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
    await expect(
      rpcFor(current.actorId).get(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await extraMessage();
    const recreated = await rpcFor(current.actorId).prepare(current.scope);
    if (
      before.state.kind !== "prepared" ||
      recreated.state.kind !== "prepared"
    ) {
      throw new Error("Preparation did not return a persisted context.");
    }
    expect(recreated.state.cursor.contextId).not.toBe(
      before.state.cursor.contextId
    );
    expect(
      await rpcFor(current.actorId).changes({
        ...current.scope,
        after: before.state.cursor,
      })
    ).toMatchObject({ changed: true, reset: true });
  });

  test("draft movement removes only the abandoned source context", async () => {
    const destination = `destination-${randomUUID()}`;
    const destinationMessage = await extraMessage(destination);
    const oldCompanion = await extraMessage();
    const source = await rpcFor(current.actorId).prepare(current.scope);
    const destinationScope = { ...current.scope, threadId: destination };
    const retained = await rpcFor(current.actorId).prepare(destinationScope);
    await fixture.client`update "managedMailMessage" set "mailboxState" = 'draft' where id = ${current.messageId}`;
    const reloaded8 = await rpcFor(current.actorId).get(current.scope);
    expect(reloaded8.state).toMatchObject(source.state);
    await fixture.client`update "managedMailMessage" set "threadId" = ${destination} where id = ${current.messageId}`;
    const reloaded9 = await rpcFor(current.actorId).get(current.scope);
    expect(reloaded9.state).toMatchObject(source.state);
    await fixture.client`update "managedMailMessage" set "threadId" = ${destination}, "mailboxState" = 'draft' where id = ${oldCompanion}`;
    await expect(
      rpcFor(current.actorId).get(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
    const reloaded10 = await rpcFor(current.actorId).get(destinationScope);
    expect(reloaded10.state).toMatchObject(retained.state);
    await fixture.client`delete from "managedMailMessage" where id = ${destinationMessage}`;
    const reloaded11 = await rpcFor(current.actorId).get(destinationScope);
    expect(reloaded11.state).toMatchObject(retained.state);
  });

  test("user deletion preserves the team's context and clears its actor", async () => {
    await rpcFor(current.actorId).prepare(current.scope);
    await fixture.client`delete from "user" where id = ${current.actorId}`;
    const [audit] = await fixture.client<{ actorMemberId: string | null }[]>`
      select e."actorMemberId" from "managedThreadCollaborationEvent" e
      join "managedThreadCollaboration" c on c.id = e."contextId"
      where c."mailboxId" = ${current.mailboxId} and c."threadId" = ${current.threadId}
    `;
    expect(audit?.actorMemberId).toBeNull();
    const ownerSnapshot = await rpcFor(current.ownerId).get(current.scope);
    expect(ownerSnapshot.state.kind).toBe("prepared");
    await expect(
      rpcFor(current.actorId).get(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("actual mailbox deletion and organization cascade remove team records", async () => {
    await rpcFor(current.actorId).prepare(current.scope);
    await deleteManagedMailbox({
      mailboxId: current.mailboxId,
      userId: current.ownerId,
    });
    expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
    const nextMailbox = randomUUID();
    await fixture.client`
      insert into mailbox (id, "organizationId", provider, "accessMode", "emailAddress", "createdAt", "updatedAt")
      values (${nextMailbox}, ${current.teamId}, 'managed', 'shared', ${`${nextMailbox}@example.test`}, now(), now())
    `;
    await fixture.client`
      insert into "managedMailMessage" (id, "mailboxId", "providerMessageId", "threadId", direction, "from", "createdAt", "updatedAt", "sentAt")
      values (${randomUUID()}, ${nextMailbox}, ${randomUUID()}, ${current.threadId}, 'inbound', 'sender@example.test', now(), now(), now())
    `;
    await fixture.client`
      insert into "mailboxGrant" (id, "mailboxId", "memberId", "userId", role, "createdAt", "updatedAt")
      values (${randomUUID()}, ${nextMailbox}, ${current.ownerMemberId}, ${current.ownerId}, 'manager', now(), now())
    `;
    const snapshot = await rpcFor(current.ownerId).prepare({
      mailboxId: nextMailbox,
      threadId: current.threadId,
    });
    if (snapshot.state.kind !== "prepared") {
      throw new Error("Preparation did not return a persisted context.");
    }
    await fixture.client`delete from organization where id = ${current.teamId}`;
    const remaining =
      await fixture.client`select id from "managedThreadCollaboration" where id = ${snapshot.state.cursor.contextId}`;
    const audit =
      await fixture.client`select "contextId" from "managedThreadCollaborationEvent" where "contextId" = ${snapshot.state.cursor.contextId}`;
    expect(remaining).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });
});

describe("controlled PostgreSQL interleavings", () => {
  test("organization deletion already holding its row prevents a later prepare from surviving", async () => {
    const before = await rpcFor(current.actorId).prepare(current.scope);
    if (before.state.kind !== "prepared") {
      throw new Error("The source context must be prepared before cascade.");
    }
    const held = Promise.withResolvers<number>();
    const release = Promise.withResolvers<null>();
    const observer = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const deletion = fixture.client.begin(async (transaction) => {
      await transaction`set local statement_timeout = '8s'`;
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`delete from organization where id = ${current.teamId}`;
      held.resolve(backend.pid);
      await release.promise;
    });
    void deletion.catch(held.reject);
    let preparation: Promise<unknown> | undefined;
    try {
      const deletingPid = await held.promise;
      preparation = rpcFor(current.actorId).prepare(current.scope);
      const rejected = expect(preparation).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const deadline = Date.now() + 8000;
      let preparingPid: number | undefined;
      while (Date.now() < deadline) {
        const rows = await observer<{ pid: number }[]>`
          select pid from pg_stat_activity where application_name = ${fixture.label}
            and pid <> ${deletingPid} and wait_event_type = 'Lock'
            and ${deletingPid}::integer = any(pg_blocking_pids(pid))
        `;
        preparingPid = rows[0]?.pid;
        if (preparingPid !== undefined) {
          break;
        }
        await pause(10);
      }
      if (preparingPid === undefined) {
        throw new Error(
          "Preparation did not wait for the organization's uncommitted deletion."
        );
      }
      await waitForBlocking(observer, preparingPid, deletingPid);
      release.resolve(null);
      await Promise.all([deletion, rejected]);
      expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
      const events = await fixture.client`
        select "contextId" from "managedThreadCollaborationEvent" where "contextId" = ${before.state.cursor.contextId}
      `;
      expect(events).toHaveLength(0);
      await expect(
        rpcFor(current.actorId).changes({
          ...current.scope,
          after: before.state.cursor,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      release.resolve(null);
      await Promise.allSettled([
        deletion,
        ...(preparation ? [preparation] : []),
      ]);
      await observer.end({ timeout: 3 });
    }
  });

  test("an in-flight prepare releases its organization pin before cascade completes", async () => {
    const auditHeld = Promise.withResolvers<number>();
    const releaseAudit = Promise.withResolvers<null>();
    const inspectCascade = Promise.withResolvers<{
      deletingPid: number;
      preparingPid: number;
    } | null>();
    const cascadeObserved = Promise.withResolvers<null>();
    const deletionStarted = Promise.withResolvers<number>();
    const deleter = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const blocker = fixture.client.begin(async (transaction) => {
      await transaction`set local statement_timeout = '8s'`;
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`lock table "managedThreadCollaborationEvent" in share mode`;
      auditHeld.resolve(backend.pid);
      const schedule = await inspectCascade.promise;
      if (schedule === null) {
        return;
      }
      await waitForBlocking(
        transaction,
        schedule.deletingPid,
        schedule.preparingPid
      );
      cascadeObserved.resolve(null);
      await releaseAudit.promise;
    });
    void blocker.catch(auditHeld.reject);
    let preparation:
      | ReturnType<ReturnType<typeof rpcFor>["prepare"]>
      | undefined;
    let deletion: Promise<unknown> | undefined;
    try {
      const blockingPid = await auditHeld.promise;
      preparation = rpcFor(current.actorId).prepare(current.scope);
      const deadline = Date.now() + 8000;
      let preparingPid: number | undefined;
      while (Date.now() < deadline) {
        const rows = await deleter<{ pid: number }[]>`
          select pid from pg_stat_activity where application_name = ${fixture.label}
            and ${blockingPid}::integer = any(pg_blocking_pids(pid))
        `;
        preparingPid = rows[0]?.pid;
        if (preparingPid !== undefined) {
          break;
        }
        await pause(10);
      }
      if (preparingPid === undefined) {
        throw new Error(
          "The uncommitted preparation's audit insertion wait was not observed."
        );
      }
      deletion = deleter.begin(async (transaction) => {
        await transaction`set local statement_timeout = '8s'`;
        const [backend] = await transaction<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        deletionStarted.resolve(backend.pid);
        await transaction`delete from organization where id = ${current.teamId}`;
      });
      void deletion.catch(deletionStarted.reject);
      inspectCascade.resolve({
        deletingPid: await deletionStarted.promise,
        preparingPid,
      });
      await Promise.race([cascadeObserved.promise, blocker]);
      releaseAudit.resolve(null);
      const snapshot = await preparation;
      await Promise.all([blocker, deletion]);
      expect(snapshot.state.kind).toBe("prepared");
      expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
      await expect(
        rpcFor(current.actorId).get(current.scope)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      if (snapshot.state.kind !== "prepared") {
        throw new Error(
          "Preparation must commit before the waiting cascade completes."
        );
      }
      await expect(
        rpcFor(current.actorId).changes({
          ...current.scope,
          after: snapshot.state.cursor,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      inspectCascade.resolve(null);
      releaseAudit.resolve(null);
      await Promise.allSettled([
        blocker,
        ...(preparation ? [preparation] : []),
        ...(deletion ? [deletion] : []),
      ]);
      await deleter.end({ timeout: 3 });
    }
  });

  test("an uncommitted prepared context is removed when the source is deleted afterward", async () => {
    const auditHeld = Promise.withResolvers<number>();
    const releaseAudit = Promise.withResolvers<null>();
    const inspectDeletion = Promise.withResolvers<{
      deletingPid: number;
      preparingPid: number;
    }>();
    const deletionObserved = Promise.withResolvers<null>();
    const deletionStarted = Promise.withResolvers<number>();
    const deleter = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const blocker = fixture.client.begin(async (transaction) => {
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`lock table "managedThreadCollaborationEvent" in share mode`;
      auditHeld.resolve(backend.pid);
      const schedule = await inspectDeletion.promise;
      await waitForBlocking(
        transaction,
        schedule.deletingPid,
        schedule.preparingPid
      );
      deletionObserved.resolve(null);
      await releaseAudit.promise;
    });
    void blocker.catch(auditHeld.reject);
    let preparation: Promise<unknown> | undefined;
    let deletion: Promise<unknown> | undefined;
    try {
      const blockingPid = await auditHeld.promise;
      preparation = rpcFor(current.actorId).prepare(current.scope);
      const deadline = Date.now() + 8000;
      let preparingPid: number | undefined;
      while (Date.now() < deadline) {
        const rows = await deleter<{ pid: number }[]>`
          select pid from pg_stat_activity where application_name = ${fixture.label}
            and ${blockingPid}::integer = any(pg_blocking_pids(pid))
        `;
        preparingPid = rows[0]?.pid;
        if (preparingPid !== undefined) {
          break;
        }
        await pause(10);
      }
      if (preparingPid === undefined) {
        throw new Error("Prepared audit insertion wait was not observed.");
      }
      deletion = deleter.begin(async (transaction) => {
        const [backend] = await transaction<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        deletionStarted.resolve(backend.pid);
        await transaction`delete from "managedMailMessage" where id = ${current.messageId}`;
      });
      void deletion.catch(deletionStarted.reject);
      inspectDeletion.resolve({
        deletingPid: await deletionStarted.promise,
        preparingPid,
      });
      await Promise.race([deletionObserved.promise, blocker]);
      releaseAudit.resolve(null);
      await Promise.all([blocker, preparation, deletion]);
      expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
    } finally {
      inspectDeletion.resolve({ deletingPid: -1, preparingPid: -1 });
      releaseAudit.resolve(null);
      await Promise.allSettled([
        blocker,
        ...(preparation ? [preparation] : []),
        ...(deletion ? [deletion] : []),
      ]);
      await deleter.end({ timeout: 3 });
    }
  });

  test("concurrent deletion of the final two source rows leaves no orphan", async () => {
    const other = await extraMessage();
    await rpcFor(current.actorId).prepare(current.scope);
    const firstHeld = Promise.withResolvers<number>();
    const releaseFirst = Promise.withResolvers<null>();
    const secondStarted = Promise.withResolvers<number>();
    const observer = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const first = fixture.client.begin(async (transaction) => {
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`delete from "managedMailMessage" where id = ${current.messageId}`;
      firstHeld.resolve(backend.pid);
      await releaseFirst.promise;
    });
    void first.catch(firstHeld.reject);
    let second: Promise<unknown> | undefined;
    try {
      const firstPid = await firstHeld.promise;
      second = fixture.client.begin(async (transaction) => {
        const [backend] = await transaction<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        secondStarted.resolve(backend.pid);
        await transaction`delete from "managedMailMessage" where id = ${other}`;
      });
      void second.catch(secondStarted.reject);
      const secondPid = await secondStarted.promise;
      await waitForBlocking(observer, secondPid, firstPid);
      releaseFirst.resolve(null);
      await Promise.all([first, second]);
      expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
    } finally {
      releaseFirst.resolve(null);
      await Promise.allSettled([first, ...(second ? [second] : [])]);
      await observer.end({ timeout: 3 });
    }
  });

  test("preparation waiting behind last deletion cannot recreate an absent context", async () => {
    const held = Promise.withResolvers<number>();
    const release = Promise.withResolvers<null>();
    const observer = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const deletion = fixture.client.begin(async (transaction) => {
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`delete from "managedMailMessage" where id = ${current.messageId}`;
      held.resolve(backend.pid);
      await release.promise;
    });
    void deletion.catch(held.reject);
    let preparation: Promise<unknown> | undefined;
    try {
      const deletingPid = await held.promise;
      preparation = rpcFor(current.actorId).prepare(current.scope);
      const rejected = expect(preparation).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const deadline = Date.now() + 8000;
      let preparingPid: number | undefined;
      while (Date.now() < deadline) {
        const rows = await observer<{ pid: number }[]>`
          select pid from pg_stat_activity where application_name = ${fixture.label}
            and pid <> ${deletingPid} and wait_event_type = 'Lock'
        `;
        preparingPid = rows[0]?.pid;
        if (preparingPid !== undefined) {
          break;
        }
        await pause(10);
      }
      if (preparingPid === undefined) {
        throw new Error("Preparation advisory wait was not observed.");
      }
      await waitForBlocking(observer, preparingPid, deletingPid);
      release.resolve(null);
      await Promise.all([deletion, rejected]);
      expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
    } finally {
      release.resolve(null);
      await Promise.allSettled([
        deletion,
        ...(preparation ? [preparation] : []),
      ]);
      await observer.end({ timeout: 3 });
    }
  });

  test("member funding deletion cannot cycle with the nonblocking actor pin", async () => {
    await rpcFor(current.actorId).prepare(current.scope);
    const teamHeld = Promise.withResolvers<number>();
    const continueCollaboration = Promise.withResolvers<null>();
    const deletingStarted = Promise.withResolvers<number>();
    const observer = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const collaboration = fixture.database.transaction(
      async (transaction) => {
        const [backend] = await transaction.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`
        );
        await transaction.execute(
          sql`select id from organization where id = ${current.teamId} for key share`
        );
        teamHeld.resolve(backend.pid);
        await continueCollaboration.promise;
        return await lockCollaborationThread(
          { ...current.scope, userId: current.actorId },
          transaction
        );
      },
      { isolationLevel: "read committed" }
    );
    void collaboration.catch(teamHeld.reject);
    const rejected = expect(collaboration).rejects.toMatchObject({
      code: "CONFLICT",
    });
    let departure: Promise<unknown> | undefined;
    try {
      const collaboratingPid = await teamHeld.promise;
      departure = fixture.client.begin(async (transaction) => {
        const [backend] = await transaction<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        deletingStarted.resolve(backend.pid);
        await transaction`delete from member where id = ${current.actorMemberId}`;
      });
      void departure.catch(deletingStarted.reject);
      await waitForBlocking(
        observer,
        await deletingStarted.promise,
        collaboratingPid
      );
      continueCollaboration.resolve(null);
      await Promise.all([rejected, departure]);
      expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
      await expect(
        rpcFor(current.actorId).get(current.scope)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      continueCollaboration.resolve(null);
      await Promise.allSettled([
        collaboration,
        rejected,
        ...(departure ? [departure] : []),
      ]);
      await observer.end({ timeout: 3 });
    }
  });

  test("mailbox cleanup and the account-cleanup lock footprint resolve after a safe conflict", async () => {
    await rpcFor(current.actorId).prepare(current.scope);
    await fixture.client`update "user" set "defaultMailboxId" = ${current.mailboxId} where id = ${current.actorId}`;
    const cleanupClient = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const collaboratorHeld = Promise.withResolvers<null>();
    const userHeld = Promise.withResolvers<number>();
    const observeMailbox = Promise.withResolvers<number>();
    const deleteMembership = Promise.withResolvers<null>();
    const collaboration = fixture.database.transaction(
      async (transaction) => {
        await transaction.execute(sql`set local statement_timeout = '8s'`);
        const [backend] = await transaction.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`
        );
        await transaction.execute(
          sql`select id from organization where id = ${current.teamId} for key share`
        );
        await transaction.execute(
          sql`select id from member where id = ${current.actorMemberId} for key share`
        );
        collaboratorHeld.resolve(null);
        const cleanupPid = await observeMailbox.promise;
        if (cleanupPid < 0) {
          throw new Error("Native lock schedule was interrupted.");
        }
        const mailboxDeadline = Date.now() + 8000;
        let deletingPid: number | undefined;
        while (Date.now() < mailboxDeadline) {
          const rows = await transaction.execute<{ pid: number }>(sql`
          select pid from pg_stat_activity where application_name = ${fixture.label}
            and pid <> ${backend.pid}
            and ${cleanupPid}::integer = any(pg_blocking_pids(pid))
        `);
          deletingPid = rows[0]?.pid;
          if (deletingPid !== undefined) {
            break;
          }
          await pause(10);
        }
        if (deletingPid === undefined) {
          throw new Error(
            "Actual mailbox cleanup did not wait on the actor user lock."
          );
        }
        deleteMembership.resolve(null);
        const membershipDeadline = Date.now() + 8000;
        let membershipWaitObserved = false;
        while (Date.now() < membershipDeadline) {
          const [row] = await transaction.execute<{ blocked: boolean }>(sql`
          select ${backend.pid}::integer = any(pg_blocking_pids(${cleanupPid}::integer)) as blocked
        `);
          if (row?.blocked) {
            membershipWaitObserved = true;
            break;
          }
          await pause(10);
        }
        if (!membershipWaitObserved) {
          throw new Error(
            "Account-cleanup member deletion did not wait on the collaboration pin."
          );
        }
        await transaction.execute(
          sql`select id from member where id = ${current.actorMemberId} for key share nowait`
        );
        return await lockCollaborationThread(
          { ...current.scope, userId: current.actorId },
          transaction
        );
      },
      { isolationLevel: "read committed" }
    );
    void collaboration.catch(collaboratorHeld.reject);
    const rejected = expect(collaboration).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const accountCleanup = cleanupClient.begin(async (transaction) => {
      await transaction`set local statement_timeout = '8s'`;
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`select id from "user" where id = ${current.actorId} for update`;
      userHeld.resolve(backend.pid);
      await deleteMembership.promise;
      await transaction`delete from invitation where "inviterId" = ${current.actorId}`;
      await transaction`delete from member where "userId" = ${current.actorId}`;
    });
    void accountCleanup.catch(userHeld.reject);
    let mailboxDeletion: Promise<unknown> | undefined;
    try {
      await collaboratorHeld.promise;
      const cleanupPid = await userHeld.promise;
      mailboxDeletion = deleteManagedMailbox({
        mailboxId: current.mailboxId,
        userId: current.ownerId,
      });
      observeMailbox.resolve(cleanupPid);
      await Promise.all([rejected, accountCleanup, mailboxDeletion]);
      expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
      const [remaining] = await fixture.client<{ count: number }[]>`
        select count(*)::integer as count from member where id = ${current.actorMemberId}
      `;
      expect(remaining?.count).toBe(0);
      await expect(
        rpcFor(current.actorId).get(current.scope)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      observeMailbox.resolve(-1);
      deleteMembership.resolve(null);
      await Promise.allSettled([
        collaboration,
        rejected,
        accountCleanup,
        ...(mailboxDeletion ? [mailboxDeletion] : []),
      ]);
      await cleanupClient.end({ timeout: 3 });
    }
  });
});

const noteCursor = (snapshot: CollaborationState) => {
  if (snapshot.state.kind !== "prepared") {
    throw new Error("The note operation needs a prepared generation.");
  }
  return snapshot.state.cursor;
};

const createCurrentNote = async (mentionMemberIds: string[] = []) => {
  const client = rpcFor(current.actorId);
  const prepared = await client.prepare(current.scope);
  const noteId = randomUUID();
  const body = `synthetic-team-note-${randomUUID()}\nsecond line`;
  const result = await client.notes.mutate({
    ...current.scope,
    body,
    expected: noteCursor(prepared),
    kind: "create",
    mentionMemberIds,
    noteId,
  });
  if (result.note === null) {
    throw new Error("Creation must return the stored note.");
  }
  return { body, note: result.note, snapshot: result.snapshot };
};

describe("actual internal notes and current grants", () => {
  test("an unprepared reader view creates nothing and cannot write", async () => {
    const client = rpcFor(current.readerId);
    const page = await client.notes.list(current.scope);
    expect(page.notes).toHaveLength(0);
    expect(page.snapshot.state.kind).toBe("unprepared");
    expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
    const prepared = await rpcFor(current.actorId).prepare(current.scope);
    await expect(
      client.notes.mutate({
        ...current.scope,
        body: "reader cannot post",
        expected: noteCursor(prepared),
        kind: "create",
        mentionMemberIds: [],
        noteId: randomUUID(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
    const notes =
      await fixture.client`select id from "managedThreadNote" where "contextId" = ${noteCursor(prepared).contextId}`;
    expect(notes).toHaveLength(0);
  });

  test("team text stays separate from email, personal context and audit metadata", async () => {
    const created = await createCurrentNote([current.readerMemberId]);
    const responder = await rpcFor(current.actorId).notes.list(current.scope);
    const reader = await rpcFor(current.readerId).notes.list(current.scope);
    const manager = await rpcFor(current.ownerId).notes.list(current.scope);
    expect(responder.notes).toHaveLength(1);
    expect(responder.notes[0]).toMatchObject({
      actions: { edit: true, remove: true },
      author: { kind: "member", memberId: current.actorMemberId },
      body: created.body,
      id: created.note.id,
    });
    expect(reader.notes[0]).toMatchObject({
      actions: { edit: false, remove: false },
    });
    expect(manager.notes[0]).toMatchObject({
      actions: { edit: false, remove: true },
    });
    expect(JSON.stringify(responder)).not.toContain(current.privateBody);
    expect(JSON.stringify(responder)).not.toContain(current.privateMemory);
    const mail = await fixture.client<{ bodyText: string }[]>`
      select "bodyText" from "managedMailMessage" where "mailboxId" = ${current.mailboxId}
    `;
    expect(mail).toHaveLength(1);
    expect(mail[0]?.bodyText).toBe(current.privateBody);
    const memory = await fixture.client<{ markdown: string }[]>`
      select markdown from "userAiContext" where "userId" = ${current.actorId}
    `;
    expect(memory[0]?.markdown).toBe(current.privateMemory);
    const events = await fixture.client`
      select * from "managedThreadCollaborationEvent" where "contextId" = ${noteCursor(created.snapshot).contextId}
    `;
    expect(JSON.stringify(events)).not.toContain(created.body);
    expect(events).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("competing writes, stale edits and repeated attempts do not overwrite or duplicate", async () => {
    const client = rpcFor(current.actorId);
    const prepared = await client.prepare(current.scope);
    const expected = noteCursor(prepared);
    const firstId = randomUUID();
    const secondId = randomUUID();
    const attempts = await Promise.allSettled([
      client.notes.mutate({
        ...current.scope,
        body: "first competing note",
        expected,
        kind: "create",
        mentionMemberIds: [],
        noteId: firstId,
      }),
      rpcFor(current.ownerId).notes.mutate({
        ...current.scope,
        body: "second competing note",
        expected,
        kind: "create",
        mentionMemberIds: [],
        noteId: secondId,
      }),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    const page = await client.notes.list(current.scope);
    expect(page.notes).toHaveLength(1);
    expect(await contextCounts()).toMatchObject({ contexts: 1, events: 2 });
    await expect(
      client.notes.mutate({
        ...current.scope,
        body: "first competing note",
        expected,
        kind: "create",
        mentionMemberIds: [],
        noteId: firstId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [stored] = page.notes;
    if (stored === undefined) {
      throw new Error("One competing write must leave its note.");
    }
    await expect(
      client.notes.mutate({
        ...current.scope,
        body: "stale replacement",
        expected,
        kind: "edit",
        mentionMemberIds: [],
        noteId: stored.id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const again = await client.notes.list(current.scope);
    expect(again.notes).toHaveLength(1);
    expect(again.notes[0]?.body).toBe(page.notes[0]?.body);
    expect(await contextCounts()).toMatchObject({ contexts: 1, events: 2 });
  });

  test("a stable create identity reconciles a surviving result without a second write", async () => {
    const client = rpcFor(current.actorId);
    const prepared = await client.prepare(current.scope);
    const expected = noteCursor(prepared);
    const noteId = randomUUID();
    const command = {
      ...current.scope,
      body: "synthetic uncertain attempt",
      expected,
      kind: "create",
      mentionMemberIds: [],
      noteId,
    } satisfies CollaborationNoteCommand;
    await client.notes.mutate(command);
    await expect(client.notes.mutate(command)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const recovered = await client.notes.get({
      ...current.scope,
      contextId: expected.contextId,
      noteId,
    });
    expect(recovered.note).toMatchObject({ body: command.body, id: noteId });
    const removed = await client.notes.mutate({
      ...current.scope,
      expected: noteCursor(recovered.snapshot),
      kind: "remove",
      noteId,
    });
    expect(removed.note).toBeNull();
    await expect(client.notes.mutate(command)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const absent = await client.notes.get({
      ...current.scope,
      contextId: expected.contextId,
      noteId,
    });
    expect(absent.note).toBeNull();
  });

  test("a foreign-organization membership cannot substitute for this user's current member", async () => {
    const otherTeam = randomUUID();
    const otherMember = randomUUID();
    ownedOrganizations.add(otherTeam);
    await fixture.client`
      insert into organization (id, name, slug, "createdAt", "updatedAt")
      values (${otherTeam}, 'Other synthetic organization', ${otherTeam}, now(), now())
    `;
    await fixture.client`
      insert into member (id, "organizationId", "userId", role, "createdAt")
      values (${otherMember}, ${otherTeam}, ${current.readerId}, 'member', now())
    `;
    const prepared = await rpcFor(current.actorId).prepare(current.scope);
    await expect(
      rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        body: "must not bind another member epoch",
        expected: noteCursor(prepared),
        kind: "create",
        mentionMemberIds: [otherMember],
        noteId: randomUUID(),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
    const page = await rpcFor(current.actorId).notes.list(current.scope);
    expect(page.notes).toHaveLength(0);
  });

  test("organization configurator status cannot read an empty mailbox feed without a grant", async () => {
    await fixture.client`delete from "mailboxGrant" where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.ownerMemberId}`;
    await expect(
      rpcFor(current.ownerId).notes.list(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      rpcFor(current.ownerId).notes.participants(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      rpcFor(current.ownerId).mentions.list({ mailboxId: current.mailboxId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await contextCounts()).toMatchObject({ contexts: 0, events: 0 });
  });

  test("retained mentions preserve read state, removal deletes facts and re-add may notify", async () => {
    const created = await createCurrentNote([current.readerMemberId]);
    const client = rpcFor(current.actorId);
    const reader = rpcFor(current.readerId);
    const notices = await reader.mentions.list({
      mailboxId: current.mailboxId,
    });
    expect(notices.mentions.map((notice) => notice.noteId)).toContain(
      created.note.id
    );
    expect(JSON.stringify(notices)).not.toContain(created.body);
    expect(JSON.stringify(notices)).not.toContain(current.actorMemberId);
    const [notification] = notices.mentions;
    if (notification === undefined) {
      throw new Error("The selected recipient must have a notification.");
    }
    const link = new URL(notification.href, "https://example.test");
    expect(link.searchParams.get("mailboxId")).toBe(current.mailboxId);
    expect(link.searchParams.get("threadId")).toBe(current.threadId);
    const { contextId } = noteCursor(created.snapshot);
    const beforeAck = await rpcFor(current.actorId).get(current.scope);
    const acknowledgement = await reader.mentions.acknowledge({
      ...current.scope,
      contextId,
      noteId: created.note.id,
    });
    expect(acknowledgement.acknowledged).toBe(true);
    const firstRead = await fixture.client<
      { createdAt: Date; readAt: Date | null }[]
    >`
      select "createdAt", "readAt" from "managedThreadNoteMention"
      where "noteId" = ${created.note.id} and "recipientMemberId" = ${current.readerMemberId}
    `;
    await reader.mentions.acknowledge({
      ...current.scope,
      contextId,
      noteId: created.note.id,
    });
    const retained = await client.notes.mutate({
      ...current.scope,
      body: "edited internal note",
      expected: noteCursor(beforeAck),
      kind: "edit",
      mentionMemberIds: [current.readerMemberId],
      noteId: created.note.id,
    });
    const afterEdit = await fixture.client<
      { createdAt: Date; readAt: Date | null }[]
    >`
      select "createdAt", "readAt" from "managedThreadNoteMention"
      where "noteId" = ${created.note.id} and "recipientMemberId" = ${current.readerMemberId}
    `;
    expect(afterEdit[0]).toMatchObject({
      createdAt: firstRead[0]?.createdAt,
      readAt: firstRead[0]?.readAt,
    });
    const readNotices = await reader.mentions.list({
      mailboxId: current.mailboxId,
    });
    expect(readNotices.mentions).toHaveLength(0);
    const removed = await client.notes.mutate({
      ...current.scope,
      body: "no longer mentions anyone",
      expected: noteCursor(retained.snapshot),
      kind: "edit",
      mentionMemberIds: [],
      noteId: created.note.id,
    });
    const facts =
      await fixture.client`select "noteId" from "managedThreadNoteMention" where "noteId" = ${created.note.id}`;
    expect(facts).toHaveLength(0);
    await client.notes.mutate({
      ...current.scope,
      body: "mentions the teammate again",
      expected: noteCursor(removed.snapshot),
      kind: "edit",
      mentionMemberIds: [current.readerMemberId],
      noteId: created.note.id,
    });
    const readded = await reader.mentions.list({
      mailboxId: current.mailboxId,
    });
    expect(readded.mentions.map((notice) => notice.noteId)).toContain(
      created.note.id
    );
  });

  test("acknowledgement is recipient-private and changes no team cursor or audit", async () => {
    const created = await createCurrentNote([current.readerMemberId]);
    const { contextId } = noteCursor(created.snapshot);
    const before = await contextCounts();
    const unrelated = await rpcFor(current.ownerId).mentions.acknowledge({
      ...current.scope,
      contextId,
      noteId: created.note.id,
    });
    expect(unrelated.acknowledged).toBe(false);
    const stillUnread = await rpcFor(current.readerId).mentions.list({
      mailboxId: current.mailboxId,
    });
    expect(stillUnread.mentions).toHaveLength(1);
    await rpcFor(current.readerId).mentions.acknowledge({
      ...current.scope,
      contextId,
      noteId: created.note.id,
    });
    expect(await contextCounts()).toMatchObject(before);
    const after = await rpcFor(current.actorId).get(current.scope);
    expect(after.state).toMatchObject(created.snapshot.state);
    const teamView = await rpcFor(current.actorId).notes.list(current.scope);
    expect(JSON.stringify(teamView)).not.toContain("readAt");
  });
});

describe("note membership epochs and private mode", () => {
  test("departure keeps team text but rejoining cannot reclaim author or recipient epoch", async () => {
    const created = await createCurrentNote([current.readerMemberId]);
    const { contextId } = noteCursor(created.snapshot);
    await fixture.client`delete from member where id = ${current.actorMemberId}`;
    const manager = await rpcFor(current.ownerId).notes.list(current.scope);
    expect(manager.notes[0]).toMatchObject({
      actions: { edit: false, remove: true },
      author: { kind: "former-member" },
      body: created.body,
    });
    const newAuthorMember = randomUUID();
    await fixture.client`
      insert into member (id, "organizationId", "userId", role, "createdAt")
      values (${newAuthorMember}, ${current.teamId}, ${current.actorId}, 'member', now())
    `;
    await fixture.client`
      insert into "mailboxGrant" (id, "mailboxId", "memberId", "userId", role, "createdAt", "updatedAt")
      values (${randomUUID()}, ${current.mailboxId}, ${newAuthorMember}, ${current.actorId}, 'responder', now(), now())
    `;
    const rejoined = await rpcFor(current.actorId).notes.list(current.scope);
    expect(rejoined.notes[0]).toMatchObject({
      actions: { edit: false, remove: false },
      author: { kind: "former-member" },
    });
    await expect(
      rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        body: "old author may not rewrite",
        expected: noteCursor(rejoined.snapshot),
        kind: "edit",
        mentionMemberIds: [],
        noteId: created.note.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await fixture.client`delete from member where id = ${current.readerMemberId}`;
    const facts =
      await fixture.client`select "noteId" from "managedThreadNoteMention" where "noteId" = ${created.note.id}`;
    expect(facts).toHaveLength(0);
    const newRecipientMember = randomUUID();
    await fixture.client`
      insert into member (id, "organizationId", "userId", role, "createdAt")
      values (${newRecipientMember}, ${current.teamId}, ${current.readerId}, 'member', now())
    `;
    await fixture.client`
      insert into "mailboxGrant" (id, "mailboxId", "memberId", "userId", role, "createdAt", "updatedAt")
      values (${randomUUID()}, ${current.mailboxId}, ${newRecipientMember}, ${current.readerId}, 'reader', now(), now())
    `;
    const notifications = await rpcFor(current.readerId).mentions.list({
      mailboxId: current.mailboxId,
    });
    expect(notifications.mentions).toHaveLength(0);
    const lookup = await rpcFor(current.readerId).notes.get({
      ...current.scope,
      contextId,
      noteId: created.note.id,
    });
    expect(lookup.note?.body).toBe(created.body);
    await expect(
      rpcFor(current.ownerId).notes.mutate({
        ...current.scope,
        body: "manager must not rewrite",
        expected: noteCursor(lookup.snapshot),
        kind: "edit",
        mentionMemberIds: [],
        noteId: created.note.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const removed = await rpcFor(current.ownerId).notes.mutate({
      ...current.scope,
      expected: noteCursor(lookup.snapshot),
      kind: "remove",
      noteId: created.note.id,
    });
    expect(removed.note).toBeNull();
  });

  test("current role and grants apply even with an unchanged team revision", async () => {
    const created = await createCurrentNote([current.readerMemberId]);
    const cursor = noteCursor(created.snapshot);
    await fixture.client`update "mailboxGrant" set role = 'reader' where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.actorMemberId}`;
    const downgraded = await rpcFor(current.actorId).notes.list({
      ...current.scope,
      at: cursor,
    });
    expect(downgraded.snapshot).toMatchObject({
      role: "reader",
      state: created.snapshot.state,
    });
    expect(downgraded.notes[0]).toMatchObject({
      actions: { edit: false, remove: false },
    });
    await expect(
      rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        expected: cursor,
        kind: "remove",
        noteId: created.note.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await fixture.client`delete from "mailboxGrant" where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.readerMemberId}`;
    await expect(
      rpcFor(current.readerId).mentions.list({ mailboxId: current.mailboxId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      rpcFor(current.readerId).notes.get({
        ...current.scope,
        contextId: cursor.contextId,
        noteId: created.note.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await fixture.client`update "mailboxGrant" set role = 'responder' where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.actorMemberId}`;
    const currentPage = await rpcFor(current.ownerId).notes.list(current.scope);
    await expect(
      rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        body: "stale recipient",
        expected: noteCursor(currentPage.snapshot),
        kind: "edit",
        mentionMemberIds: [current.readerMemberId],
        noteId: created.note.id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await rpcFor(current.actorId).notes.mutate({
      ...current.scope,
      body: "removed unavailable recipient",
      expected: noteCursor(currentPage.snapshot),
      kind: "edit",
      mentionMemberIds: [],
      noteId: created.note.id,
    });
    const missingRecipient = await rpcFor(current.ownerId).notes.participants(
      current.scope
    );
    expect(
      missingRecipient.participants.map((participant) => participant.memberId)
    ).not.toContain(current.readerMemberId);
  });

  test("shared-private-shared changes preserve storage while private owner and grantees are denied", async () => {
    const created = await createCurrentNote([current.readerMemberId]);
    const cursor = noteCursor(created.snapshot);
    await fixture.client`update mailbox set "managedOwnerUserId" = ${current.actorId}, "accessMode" = 'private' where id = ${current.mailboxId}`;
    const ordinary = await getAuthorizedManagedMailbox(
      { mailboxId: current.mailboxId, userId: current.actorId },
      fixture.database
    );
    expect(ordinary.ownerUserId).toBe(current.actorId);
    for (const userId of [current.actorId, current.readerId]) {
      const client = rpcFor(userId);
      await expect(client.notes.list(current.scope)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        client.notes.get({
          ...current.scope,
          contextId: cursor.contextId,
          noteId: created.note.id,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        client.notes.participants(current.scope)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        client.mentions.list({ mailboxId: current.mailboxId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        client.mentions.acknowledge({
          ...current.scope,
          contextId: cursor.contextId,
          noteId: created.note.id,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    const retained =
      await fixture.client`select id from "managedThreadNote" where id = ${created.note.id}`;
    expect(retained).toHaveLength(1);
    await fixture.client`update mailbox set "managedOwnerUserId" = null, "accessMode" = 'shared' where id = ${current.mailboxId}`;
    const restored = await rpcFor(current.readerId).notes.list(current.scope);
    expect(restored.notes[0]).toMatchObject({
      body: created.body,
      id: created.note.id,
    });
    expect(restored.snapshot.state).toMatchObject(created.snapshot.state);
    const gmailId = randomUUID();
    await fixture.client`
      insert into mailbox (id, "organizationId", provider, "ownerUserId", "emailAddress", "createdAt", "updatedAt")
      values (${gmailId}, ${current.teamId}, 'gmail', ${current.actorId}, ${`${gmailId}@example.test`}, now(), now())
    `;
    await expect(
      rpcFor(current.actorId).notes.list({
        mailboxId: gmailId,
        threadId: current.threadId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      rpcFor(current.actorId).mentions.list({ mailboxId: gmailId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("source lifetime deletes notes and mentions, and an old generation cannot recreate them", async () => {
    const created = await createCurrentNote([current.readerMemberId]);
    const oldCursor = noteCursor(created.snapshot);
    const survivor = await extraMessage();
    await fixture.client`update "managedMailMessage" set "mailboxState" = 'trash' where id = ${current.messageId}`;
    const inTrash = await rpcFor(current.actorId).notes.list(current.scope);
    expect(inTrash.notes[0]?.id).toBe(created.note.id);
    await fixture.client`delete from "managedMailMessage" where id = ${current.messageId}`;
    const oneRemaining = await rpcFor(current.readerId).notes.list(
      current.scope
    );
    expect(oneRemaining.notes[0]?.id).toBe(created.note.id);
    const destination = `note-move-${randomUUID()}`;
    await fixture.client`update "managedMailMessage" set "threadId" = ${destination} where id = ${survivor}`;
    const removedNotes =
      await fixture.client`select id from "managedThreadNote" where "contextId" = ${oldCursor.contextId}`;
    const removedFacts =
      await fixture.client`select "noteId" from "managedThreadNoteMention" where "noteId" = ${created.note.id}`;
    expect(removedNotes).toHaveLength(0);
    expect(removedFacts).toHaveLength(0);
    await expect(
      rpcFor(current.actorId).notes.list(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const moved = await rpcFor(current.actorId).notes.list({
      mailboxId: current.mailboxId,
      threadId: destination,
    });
    expect(moved.notes).toHaveLength(0);
    await extraMessage();
    const prepared = await rpcFor(current.actorId).prepare(current.scope);
    expect(noteCursor(prepared).contextId).not.toBe(oldCursor.contextId);
    await expect(
      rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        body: created.body,
        expected: oldCursor,
        kind: "create",
        mentionMemberIds: [],
        noteId: created.note.id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const replacement = await rpcFor(current.actorId).notes.list(current.scope);
    expect(replacement.notes).toHaveLength(0);
  });
});

describe("note division and mailbox scope", () => {
  test("division-only recipients disappear immediately when that current membership is removed", async () => {
    const divisionId = randomUUID();
    await fixture.client`delete from "mailboxGrant" where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.readerMemberId}`;
    await fixture.client`
      insert into "organizationDivision" (id, "organizationId", name, "normalizedName", "createdAt", "updatedAt")
      values (${divisionId}, ${current.teamId}, 'Notes recipient division', ${divisionId}, now(), now())
    `;
    await fixture.client`
      insert into "organizationDivisionMember" (id, "divisionId", "memberId", "createdAt")
      values (${randomUUID()}, ${divisionId}, ${current.readerMemberId}, now())
    `;
    await fixture.client`
      insert into "mailboxDivisionGrant" (id, "mailboxId", "divisionId", role, "createdAt", "updatedAt")
      values (${randomUUID()}, ${current.mailboxId}, ${divisionId}, 'reader', now(), now())
    `;
    const created = await createCurrentNote([current.readerMemberId]);
    const recipients = await rpcFor(current.actorId).notes.participants(
      current.scope
    );
    expect(
      recipients.participants.map((participant) => participant.memberId)
    ).toContain(current.readerMemberId);
    const before = await rpcFor(current.readerId).mentions.list({
      mailboxId: current.mailboxId,
    });
    expect(before.mentions.map((notice) => notice.noteId)).toContain(
      created.note.id
    );
    await fixture.client`delete from "organizationDivisionMember" where "divisionId" = ${divisionId} and "memberId" = ${current.readerMemberId}`;
    await expect(
      rpcFor(current.readerId).notes.list(current.scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      rpcFor(current.readerId).mentions.list({ mailboxId: current.mailboxId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        body: "must recheck retained division recipient",
        expected: noteCursor(created.snapshot),
        kind: "edit",
        mentionMemberIds: [current.readerMemberId],
        noteId: created.note.id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const unchanged = await rpcFor(current.actorId).notes.get({
      ...current.scope,
      contextId: noteCursor(created.snapshot).contextId,
      noteId: created.note.id,
    });
    expect(unchanged.note?.body).toBe(created.body);
    expect(unchanged.snapshot.state).toMatchObject(created.snapshot.state);
  });

  test("simultaneous same-thread mailboxes and cleanup keep note bodies and notices scoped", async () => {
    const otherMailboxId = randomUUID();
    const otherMessageId = randomUUID();
    const otherScope = {
      mailboxId: otherMailboxId,
      threadId: current.threadId,
    };
    await fixture.client`
      insert into mailbox (id, "organizationId", provider, "accessMode", "emailAddress", "createdAt", "updatedAt")
      values (${otherMailboxId}, ${current.teamId}, 'managed', 'shared', ${`${otherMailboxId}@example.test`}, now(), now())
    `;
    for (const grant of [
      {
        memberId: current.actorMemberId,
        role: "responder",
        userId: current.actorId,
      },
      {
        memberId: current.readerMemberId,
        role: "reader",
        userId: current.readerId,
      },
      {
        memberId: current.ownerMemberId,
        role: "manager",
        userId: current.ownerId,
      },
    ]) {
      await fixture.client`
        insert into "mailboxGrant" (id, "mailboxId", "memberId", "userId", role, "createdAt", "updatedAt")
        values (${randomUUID()}, ${otherMailboxId}, ${grant.memberId}, ${grant.userId}, ${grant.role}, now(), now())
      `;
    }
    await fixture.client`
      insert into "managedMailMessage" (id, "mailboxId", "providerMessageId", "threadId", direction, "from", "createdAt", "updatedAt", "sentAt")
      values (${otherMessageId}, ${otherMailboxId}, ${otherMessageId}, ${current.threadId}, 'inbound', 'sender@example.test', now(), now(), now())
    `;
    const actor = rpcFor(current.actorId);
    const [primaryPrepared, otherPrepared] = await Promise.all([
      actor.prepare(current.scope),
      actor.prepare(otherScope),
    ]);
    const primaryId = randomUUID();
    const otherId = randomUUID();
    const [primary, other] = await Promise.all([
      actor.notes.mutate({
        ...current.scope,
        body: "first mailbox internal body",
        expected: noteCursor(primaryPrepared),
        kind: "create",
        mentionMemberIds: [current.readerMemberId],
        noteId: primaryId,
      }),
      actor.notes.mutate({
        ...otherScope,
        body: "other mailbox internal body",
        expected: noteCursor(otherPrepared),
        kind: "create",
        mentionMemberIds: [current.readerMemberId],
        noteId: otherId,
      }),
    ]);
    const firstView = await actor.notes.list(current.scope);
    const otherView = await actor.notes.list(otherScope);
    expect(firstView.notes.map((note) => note.id)).toContain(primaryId);
    expect(firstView.notes.map((note) => note.id)).not.toContain(otherId);
    expect(otherView.notes.map((note) => note.id)).toContain(otherId);
    expect(JSON.stringify(otherView)).not.toContain(
      "first mailbox internal body"
    );
    const foreign = await actor.notes.get({
      ...otherScope,
      contextId: noteCursor(primary.snapshot).contextId,
      noteId: primaryId,
    });
    expect(foreign.note).toBeNull();
    await expect(
      actor.notes.mutate({
        ...otherScope,
        body: "cannot overwrite foreign identity",
        expected: noteCursor(other.snapshot),
        kind: "create",
        mentionMemberIds: [],
        noteId: primaryId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const firstNotices = await rpcFor(current.readerId).mentions.list({
      mailboxId: current.mailboxId,
    });
    const otherNotices = await rpcFor(current.readerId).mentions.list({
      mailboxId: otherMailboxId,
    });
    expect(firstNotices.mentions.map((notice) => notice.noteId)).not.toContain(
      otherId
    );
    expect(otherNotices.mentions.map((notice) => notice.noteId)).not.toContain(
      primaryId
    );
    await deleteManagedMailbox({
      mailboxId: current.mailboxId,
      userId: current.ownerId,
    });
    const survivors = await actor.notes.list(otherScope);
    expect(survivors.notes.map((note) => note.id)).toContain(otherId);
    const deleted =
      await fixture.client`select id from "managedThreadNote" where id = ${primaryId}`;
    expect(deleted).toHaveLength(0);
    await fixture.client`delete from organization where id = ${current.teamId}`;
    const afterOrganization =
      await fixture.client`select id from "managedThreadNote" where id in (${primaryId}, ${otherId})`;
    const afterMentions =
      await fixture.client`select "noteId" from "managedThreadNoteMention" where "noteId" in (${primaryId}, ${otherId})`;
    expect(afterOrganization).toHaveLength(0);
    expect(afterMentions).toHaveLength(0);
    await expect(actor.notes.list(otherScope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("actual note transaction interleavings", () => {
  test("a selected recipient NOWAIT pin releases the real funding delete without a cycle", async () => {
    const prepared = await rpcFor(current.actorId).prepare(current.scope);
    const expected = noteCursor(prepared);
    const noteId = randomUUID();
    const held = Promise.withResolvers<number>();
    const inspect = Promise.withResolvers<{
      writerPid: number;
      deletingPid: number;
    } | null>();
    const observed = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const deletionStarted = Promise.withResolvers<number>();
    const deleter = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const blocker = fixture.client.begin(async (transaction) => {
      await transaction`set local statement_timeout = '8s'`;
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`lock table "managedThreadCollaboration" in access exclusive mode`;
      held.resolve(backend.pid);
      const schedule = await inspect.promise;
      if (schedule === null) {
        return;
      }
      await waitForBlocking(
        transaction,
        schedule.deletingPid,
        schedule.writerPid
      );
      observed.resolve(null);
      await release.promise;
    });
    void blocker.catch(held.reject);
    let writer: Promise<unknown> | undefined;
    let deletion: Promise<unknown> | undefined;
    let rejection: Promise<unknown> | undefined;
    try {
      const blockingPid = await held.promise;
      writer = rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        body: "must not outlive a selected member epoch",
        expected,
        kind: "create",
        mentionMemberIds: [current.readerMemberId],
        noteId,
      });
      rejection = expect(writer).rejects.toMatchObject({ code: "CONFLICT" });
      const deadline = Date.now() + 8000;
      let writerPid: number | undefined;
      while (Date.now() < deadline) {
        const rows = await deleter<{ pid: number }[]>`
          select pid from pg_stat_activity where application_name = ${fixture.label}
            and pid <> ${blockingPid} and wait_event_type = 'Lock'
            and ${blockingPid}::integer = any(pg_blocking_pids(pid))
        `;
        writerPid = rows[0]?.pid;
        if (writerPid !== undefined) {
          break;
        }
        await pause(10);
      }
      if (writerPid === undefined) {
        throw new Error(
          "Notes writer did not reach the observed context-table wait."
        );
      }
      deletion = deleter.begin(async (transaction) => {
        await transaction`set local statement_timeout = '8s'`;
        const [backend] = await transaction<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        deletionStarted.resolve(backend.pid);
        await transaction`delete from member where id = ${current.readerMemberId}`;
      });
      void deletion.catch(deletionStarted.reject);
      inspect.resolve({
        deletingPid: await deletionStarted.promise,
        writerPid,
      });
      await Promise.race([observed.promise, blocker]);
      release.resolve(null);
      await Promise.all([blocker, deletion, rejection]);
      const notes =
        await fixture.client`select id from "managedThreadNote" where id = ${noteId}`;
      const mentions =
        await fixture.client`select "noteId" from "managedThreadNoteMention" where "noteId" = ${noteId}`;
      expect(notes).toHaveLength(0);
      expect(mentions).toHaveLength(0);
      expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
      const unchanged = await rpcFor(current.actorId).get(current.scope);
      expect(unchanged.state).toMatchObject(prepared.state);
    } finally {
      inspect.resolve(null);
      release.resolve(null);
      await Promise.allSettled([
        blocker,
        ...(writer ? [writer] : []),
        ...(deletion ? [deletion] : []),
        ...(rejection ? [rejection] : []),
      ]);
      await deleter.end({ timeout: 3 });
    }
  });

  test("revoking a selected grant at the final check rolls back note, mention, audit and revision", async () => {
    const prepared = await rpcFor(current.actorId).prepare(current.scope);
    const expected = noteCursor(prepared);
    const noteId = randomUUID();
    const held = Promise.withResolvers<number>();
    const release = Promise.withResolvers<null>();
    const revoker = fixture.createPostgres(fixture.urlText, {
      max: 1,
      onnotice: vi.fn<(notice: postgres.Notice) => void>(),
    });
    const blocker = fixture.client.begin(async (transaction) => {
      await transaction`set local statement_timeout = '8s'`;
      const [backend] = await transaction<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await transaction`lock table "managedThreadCollaborationEvent" in share mode`;
      held.resolve(backend.pid);
      await release.promise;
    });
    void blocker.catch(held.reject);
    let writer: Promise<unknown> | undefined;
    let rejection: Promise<unknown> | undefined;
    try {
      const blockingPid = await held.promise;
      writer = rpcFor(current.actorId).notes.mutate({
        ...current.scope,
        body: "must not commit for a revoked recipient",
        expected,
        kind: "create",
        mentionMemberIds: [current.readerMemberId],
        noteId,
      });
      rejection = expect(writer).rejects.toMatchObject({ code: "CONFLICT" });
      const deadline = Date.now() + 8000;
      let writerPid: number | undefined;
      while (Date.now() < deadline) {
        const rows = await revoker<{ pid: number }[]>`
          select pid from pg_stat_activity where application_name = ${fixture.label}
            and pid <> ${blockingPid} and wait_event_type = 'Lock'
            and ${blockingPid}::integer = any(pg_blocking_pids(pid))
        `;
        writerPid = rows[0]?.pid;
        if (writerPid !== undefined) {
          break;
        }
        await pause(10);
      }
      if (writerPid === undefined) {
        throw new Error(
          "Notes writer did not reach the observed audit insertion wait."
        );
      }
      await waitForBlocking(revoker, writerPid, blockingPid);
      await revoker`delete from "mailboxGrant" where "mailboxId" = ${current.mailboxId} and "memberId" = ${current.readerMemberId}`;
      release.resolve(null);
      await Promise.all([blocker, rejection]);
      const notes =
        await fixture.client`select id from "managedThreadNote" where id = ${noteId}`;
      const mentions =
        await fixture.client`select "noteId" from "managedThreadNoteMention" where "noteId" = ${noteId}`;
      expect(notes).toHaveLength(0);
      expect(mentions).toHaveLength(0);
      expect(await contextCounts()).toMatchObject({ contexts: 1, events: 1 });
      const unchanged = await rpcFor(current.actorId).get(current.scope);
      expect(unchanged.state).toMatchObject(prepared.state);
    } finally {
      release.resolve(null);
      await Promise.allSettled([
        blocker,
        ...(writer ? [writer] : []),
        ...(rejection ? [rejection] : []),
      ]);
      await revoker.end({ timeout: 3 });
    }
  });
});

describe("note paging and metadata retention", () => {
  test("tied note and recipient pages are complete and stale note pages cannot mix revisions", async () => {
    const actor = rpcFor(current.actorId);
    let snapshot = await actor.prepare(current.scope);
    const noteIds: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const noteId = randomUUID();
      const result = await actor.notes.mutate({
        ...current.scope,
        body: `synthetic paged note ${index}`,
        expected: noteCursor(snapshot),
        kind: "create",
        mentionMemberIds: [current.readerMemberId],
        noteId,
      });
      ({ snapshot } = result);
      noteIds.push(noteId);
    }
    const cursor = noteCursor(snapshot);
    await fixture.client`
      update "managedThreadNote" set "createdAt" = (select min("createdAt") from "managedThreadNote" where "contextId" = ${cursor.contextId})
      where "contextId" = ${cursor.contextId}
    `;
    await fixture.client`
      update "managedThreadNoteMention" set "createdAt" = (
        select min(m."createdAt") from "managedThreadNoteMention" m
        join "managedThreadNote" n on n.id = m."noteId" where n."contextId" = ${cursor.contextId}
      ) where "noteId" in (select id from "managedThreadNote" where "contextId" = ${cursor.contextId})
    `;
    const first = await actor.notes.list({ ...current.scope, at: cursor });
    const seen: string[] = [];
    let page = first;
    while (true) {
      seen.push(...page.notes.map((note) => note.id));
      if (page.next === null) {
        break;
      }
      page = await actor.notes.list({
        ...current.scope,
        after: page.next,
        at: cursor,
      });
    }
    expect(seen).toHaveLength(noteIds.length);
    expect(new Set(seen).size).toBe(noteIds.length);
    for (const noteId of noteIds) {
      expect(seen).toContain(noteId);
    }
    const reader = rpcFor(current.readerId);
    let noticePage = await reader.mentions.list({
      mailboxId: current.mailboxId,
    });
    const seenNotices: string[] = [];
    while (true) {
      seenNotices.push(...noticePage.mentions.map((notice) => notice.noteId));
      if (noticePage.next === null) {
        break;
      }
      noticePage = await reader.mentions.list({
        after: noticePage.next,
        mailboxId: current.mailboxId,
      });
    }
    expect(seenNotices).toHaveLength(noteIds.length);
    expect(new Set(seenNotices).size).toBe(noteIds.length);
    for (const noteId of noteIds) {
      expect(seenNotices).toContain(noteId);
    }
    if (first.next === null) {
      throw new Error(
        "The owned history must span multiple pages for this probe."
      );
    }
    await actor.notes.mutate({
      ...current.scope,
      body: "later revision",
      expected: cursor,
      kind: "create",
      mentionMemberIds: [],
      noteId: randomUUID(),
    });
    await expect(
      actor.notes.list({ ...current.scope, after: first.next, at: cursor })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("a real mutation prunes expired context metadata while preserving recent and foreign-scope audit", async () => {
    const created = await createCurrentNote();
    const original = noteCursor(created.snapshot);
    const [oldest] = await fixture.client<{ revision: string }[]>`
      select revision::text as revision from "managedThreadCollaborationEvent"
      where "contextId" = ${original.contextId} order by revision limit 1
    `;
    if (oldest === undefined) {
      throw new Error("Preparation must have an audit receipt.");
    }
    const otherThread = `retention-other-${randomUUID()}`;
    await extraMessage(otherThread);
    const other = await rpcFor(current.actorId).prepare({
      mailboxId: current.mailboxId,
      threadId: otherThread,
    });
    const otherCursor = noteCursor(other);
    await fixture.client`
      insert into "managedThreadCollaborationEvent" ("contextId", revision, kind, "noteId", "actorMemberId", "createdAt")
      select ${original.contextId}, ${original.revision}::bigint + n, 'note_edited', ${created.note.id}, ${current.actorMemberId}, now()
      from generate_series(1, 650) as n
    `;
    await fixture.client`
      update "managedThreadCollaboration" set revision = (
        select max(revision) from "managedThreadCollaborationEvent" where "contextId" = ${original.contextId}
      ) where id = ${original.contextId}
    `;
    const currentState = await rpcFor(current.actorId).get(current.scope);
    const edited = await rpcFor(current.actorId).notes.mutate({
      ...current.scope,
      body: "current retained note body",
      expected: noteCursor(currentState),
      kind: "edit",
      mentionMemberIds: [],
      noteId: created.note.id,
    });
    const events = await fixture.client<
      { contextId: string; revision: string }[]
    >`
      select "contextId", revision::text as revision from "managedThreadCollaborationEvent"
      where "contextId" in (${original.contextId}, ${otherCursor.contextId})
    `;
    expect(
      events
        .filter((event) => event.contextId === original.contextId)
        .map((event) => event.revision)
    ).not.toContain(oldest.revision);
    expect(
      events
        .filter((event) => event.contextId === original.contextId)
        .map((event) => event.revision)
    ).toContain(noteCursor(edited.snapshot).revision);
    expect(
      events
        .filter((event) => event.contextId === otherCursor.contextId)
        .map((event) => event.revision)
    ).toContain(otherCursor.revision);
    expect(JSON.stringify(events)).not.toContain("current retained note body");
    const live = await rpcFor(current.actorId).notes.list(current.scope);
    expect(live.notes[0]).toMatchObject({
      body: "current retained note body",
      id: created.note.id,
    });
  });
});
