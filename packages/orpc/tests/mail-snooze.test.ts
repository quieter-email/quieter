/* oxlint-disable vitest/prefer-import-in-mock -- Authorization and provider transport surround a real isolated database state machine. */
import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type { MessageListItem } from "@quieter/mail/messages";
import type { MailSnoozeApplyInput } from "@quieter/mail/snooze";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { MailRequestContext } from "../src/gmail-request";
import {
  applyMailPlacement,
  hashMailPlacementRequest,
  supersedePendingMailPlacement,
} from "../src/mail/placement";
import type { MailSnoozePlacement } from "../src/mail/placement";
import {
  bindMailUndoRehide,
  mailUndoRehideBindingSchema,
} from "../src/mail/undo-model";
import { reconcileMailSnoozes } from "../src/snooze/repair";
import {
  applyMailSnooze,
  dispatchMailSnooze,
  handleSnoozeInbound,
} from "../src/snooze/service";
import {
  getMailSnoozeStates,
  reconcileMailSnoozeSource,
} from "../src/snooze/state";

const fixture = await vi.hoisted(async () => {
  const url = process.env.QUIETER_TEST_SNOOZE_DATABASE_URL;
  if (url !== undefined) {
    const parsed = new URL(url);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      parsed.pathname !== "/mail_snooze_fixture"
    ) {
      throw new Error(
        "Snooze tests require a loopback mail_snooze_fixture database."
      );
    }
  }
  const [{ default: postgres }, { drizzle }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  const client = postgres(
    url ?? "postgresql://postgres@127.0.0.1:1/mail_snooze_fixture",
    { connect_timeout: 3, max: 4, onnotice: () => {} }
  );
  const state: {
    provider: "managed" | "gmail";
    readers: Set<string>;
    writers: Set<string>;
    messages: MessageListItem[];
    writes: number;
    ambiguous: boolean;
    needsReconnect: boolean;
    afterCommit?: (result: unknown) => Promise<void>;
    beforeManagedAuthorization?: () => Promise<void>;
    beforeGmail?: () => Promise<void>;
    beforeSnapshot?: () => Promise<void>;
    beforeMetadata?: () => Promise<void>;
    beforeWriteResponse?: () => Promise<void>;
  } = {
    ambiguous: false,
    messages: [],
    needsReconnect: false,
    provider: "managed",
    readers: new Set(),
    writers: new Set(),
    writes: 0,
  };
  const database = drizzle({ client });
  const transaction = database.transaction.bind(database);
  database.transaction = async (run, config) => {
    const result = await transaction(run, config);
    await state.afterCommit?.(result);
    return result;
  };
  return {
    client,
    database,
    enabled: url !== undefined,
    state,
  };
});

vi.mock("@quieter/database/client", () => ({ db: fixture.database }));
vi.mock("@quieter/observability", () => ({
  reportError: vi.fn<(error: unknown) => void>(),
}));
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: async (input: { userId: string }) => {
    if (
      !fixture.state.readers.has(input.userId) ||
      (fixture.state.provider === "gmail" && input.userId !== "actor")
    ) {
      throw new ORPCError("FORBIDDEN");
    }
    return await Promise.resolve({ provider: fixture.state.provider });
  },
}));
vi.mock("../src/mailbox/access", () => ({
  getAuthorizedManagedMailbox: async (input: { userId: string }) => {
    const authorized = fixture.state.writers.has(input.userId);
    await fixture.state.beforeManagedAuthorization?.();
    if (!authorized) {
      throw new ORPCError("FORBIDDEN");
    }
    return await Promise.resolve({ role: "responder" });
  },
}));
vi.mock("../src/gmail-request", () => ({
  callGmail: async <T>(
    context: MailRequestContext,
    _mailboxId: string,
    run: (token: string, signal?: AbortSignal) => Promise<T>
  ) => {
    context.signal?.throwIfAborted();
    await fixture.state.beforeGmail?.();
    if (fixture.state.needsReconnect) {
      throw new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
        message: "Google access needs to be reconnected for this mailbox.",
        status: 409,
      });
    }
    return await run("snooze-fixture-token", context.signal);
  },
}));
vi.mock("../src/mail-capture", () => ({
  refreshGmailCapturedMessageMetadata: async () => {
    await Promise.resolve();
  },
  writeGmailCapturedMessage: async () => {
    await Promise.resolve();
  },
}));
vi.mock("../src/mail-updates", () => ({
  publishMailUpdate: async () => {
    await Promise.resolve();
  },
}));
vi.mock("../src/snooze/wake", () => ({
  requestMailSnoozeWake: async () => await Promise.resolve(false),
}));
vi.mock("@quieter/gmail", () => ({
  batchModifyMessages: async (
    _token: string,
    ids: string[],
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
    signal?: AbortSignal
  ) => {
    signal?.throwIfAborted();
    fixture.state.writes += 1;
    for (const message of fixture.state.messages) {
      if (ids.includes(message.id)) {
        message.labelIds = [
          ...new Set([
            ...(message.labelIds ?? []).filter(
              (label) => changes.removeLabelIds?.includes(label) !== true
            ),
            ...(changes.addLabelIds ?? []),
          ]),
        ];
      }
    }
    await fixture.state.beforeWriteResponse?.();
    if (fixture.state.ambiguous) {
      throw new Error("Provider accepted the write but the response was lost.");
    }
    await Promise.resolve();
  },
  getGmailCaptureMetadata: async (
    _token: string,
    id: string,
    signal?: AbortSignal
  ) => {
    await fixture.state.beforeMetadata?.();
    signal?.throwIfAborted();
    return {
      labelIds:
        fixture.state.messages.find((message) => message.id === id)?.labelIds ??
        [],
      providerRevision: "1",
    };
  },
  getGmailMessageThreadAssociations: async (_token: string, ids: string[]) =>
    await Promise.resolve(
      fixture.state.messages
        .filter((message) => ids.includes(message.id))
        .map((message) => ({ id: message.id, threadId: message.threadId }))
    ),
  getGmailThreadMessageCount: async (_token: string, threadId: string) =>
    await Promise.resolve(
      fixture.state.messages.filter((message) => message.threadId === threadId)
        .length
    ),
  getThreadWithDetails: async (_token: string, threadId: string) => {
    const messages = structuredClone(
      fixture.state.messages.filter((message) => message.threadId === threadId)
    );
    await fixture.state.beforeSnapshot?.();
    return {
      messages,
      threadId,
    };
  },
  isGmailServiceError: () => false,
}));

const seed = async (input: {
  id: string;
  threadId?: string;
  state?: "active" | "done" | "spam";
  receivedAt?: number;
}) => {
  await fixture.client`insert into "managedMailMessage" (id, "mailboxId", "threadId", direction, "mailboxState", "createdAt", "updatedAt") values (${input.id}, 'mailbox', ${input.threadId ?? "conversation"}, 'inbound', ${input.state ?? "active"}, ${new Date(input.receivedAt ?? 1).toISOString()}, now())`;
};
const snooze = async (
  input: {
    messageIds?: string[];
    threadId?: string;
    expectedVersion?: number | null;
    requestId?: string;
  } = {}
) => {
  const result = await applyMailSnooze({
    context: { userId: "actor" },
    input: {
      command: {
        kind: "snooze",
        returnAt: new Date(Date.now() + 60_000).toISOString(),
        timeZone: "Europe/Berlin",
      },
      mailboxId: "mailbox",
      requestId: input.requestId ?? randomUUID(),
      targets: [
        {
          expectedVersion: input.expectedVersion ?? null,
          messageIds: input.messageIds ?? ["anchor"],
          threadId: input.threadId ?? "conversation",
        },
      ],
    },
  });
  const [target] = result.targets;
  if (!target?.snooze) {
    throw new Error(
      `Fixture snooze did not return state: ${JSON.stringify(result)}`
    );
  }
  return target;
};
const change = async (input: {
  version: number;
  command: MailSnoozeApplyInput["command"];
  requestId?: string;
  userId?: string;
}) =>
  await applyMailSnooze({
    context: { userId: input.userId ?? "actor" },
    input: {
      command: input.command,
      mailboxId: "mailbox",
      requestId: input.requestId ?? randomUUID(),
      targets: [
        {
          expectedVersion: input.version,
          messageIds: [],
          threadId: "conversation",
        },
      ],
    },
  });
const makeDue = async (id: string) => {
  await fixture.client`update "mailSnooze" set "returnAt" = now() - interval '1 minute', "nextWakeAt" = now() - interval '1 minute' where id = ${id}`;
};

describe("native placement request compatibility", () => {
  test.each([
    {
      hash: "77a2d3755aba3d501303738585f929f9f272b3dc2c984bde1646eff8522ce37e",
      placement: "done",
      snooze: undefined,
    },
    {
      hash: "a13c6d29db8bd4734a5c11b6089e797d550ebe8dff6e2efc231c50637592a839",
      placement: "done",
      snooze: {
        id: "snooze",
        kind: "snooze-hide",
        leaseToken: null,
        version: 1,
      },
    },
    {
      hash: "859121bfd3597b0100dc79b344dcedf106f6267a1a509e4238e38f7e1c437a75",
      placement: "inbox",
      snooze: {
        id: "snooze",
        kind: "snooze-return",
        leaseToken: "old",
        trigger: "manual",
        version: 3,
      },
    },
    {
      hash: "2dfc1989feed98ffdb7e509adc3b7e26523c57aeda697bbff47b265b7a7c0478",
      placement: "inbox",
      snooze: {
        id: "snooze",
        kind: "snooze-return",
        leaseToken: "new",
        trigger: "due",
        version: 3,
      },
    },
  ] satisfies {
    hash: string;
    placement: "done" | "inbox";
    snooze: MailSnoozePlacement | undefined;
  }[])("preserves the persisted native request digest $hash", (item) => {
    expect(
      hashMailPlacementRequest({
        actorUserId: "actor",
        input: {
          command: { kind: "set-placement", placement: item.placement },
          mailboxId: "mailbox",
          targets: [{ messageIds: ["b", "a", "a"], threadId: "thread" }],
        },
        snooze: item.snooze,
      })
    ).toBe(item.hash);
    expect(
      hashMailPlacementRequest({
        actorUserId: "actor",
        input: {
          command: { kind: "set-placement", placement: item.placement },
          mailboxId: "mailbox",
          targets: [{ messageIds: ["a", "b"], threadId: "thread" }],
        },
        snooze: item.snooze && { ...item.snooze, leaseToken: "replacement" },
      })
    ).toBe(item.hash);
  });
});

describe.skipIf(!fixture.enabled)("durable mailbox Snooze", () => {
  beforeAll(async () => {
    await fixture.client.unsafe(`
      create table if not exists "user" (id text primary key);
      create table if not exists mailbox (id text primary key, provider text not null, "contentRevision" bigint not null default 0, "updatedAt" timestamptz not null default now());
      create table if not exists "managedMailMessage" (id text primary key, "mailboxId" text not null references mailbox(id) on delete cascade, "threadId" text not null, direction text not null, "mailboxState" text not null, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);
      create table if not exists "gmailCapturedMessage" ("mailboxId" text references mailbox(id) on delete cascade, "messageId" text, snapshot jsonb, "deletedAt" timestamptz, primary key ("mailboxId", "messageId"));
      create table if not exists "rateLimitBucket" (key text primary key, count integer not null, "windowStart" timestamptz not null, "expiresAt" timestamptz not null);
      create table if not exists "mailPlacementOperation" (id text primary key, sequence bigserial not null unique, "actorUserId" text not null references "user"(id) on delete cascade, "mailboxId" text not null references mailbox(id) on delete cascade, "requestId" text not null, "requestHash" text not null, "threadId" text not null, "requestedMessageIds" jsonb not null, "messageIds" jsonb not null, placement text not null, status text not null, code text, message text, "createdAt" timestamptz not null, "updatedAt" timestamptz not null, unique ("actorUserId", "mailboxId", "requestId", "threadId"));
      create table if not exists "mailSnooze" (id text primary key, "mailboxId" text not null references mailbox(id) on delete cascade, "threadId" text not null, "actorUserId" text references "user"(id) on delete set null, version integer not null, "returnAt" timestamptz not null, "timeZone" text not null, status text not null, "hideRequestId" text not null, "returnRequestId" text, "hideOperationId" text references "mailPlacementOperation"(id) on delete set null, "returnOperationId" text references "mailPlacementOperation"(id) on delete set null, "knownIncomingMessageIds" jsonb not null, "hiddenMessageIds" jsonb not null, "nextWakeAt" timestamptz, "leaseToken" text, "leaseUntil" timestamptz, attempts integer not null default 0, code text, message text, "createdAt" timestamptz not null, "updatedAt" timestamptz not null, unique ("mailboxId", "threadId"));
      create table if not exists "mailSnoozeOperation" (id text primary key, "actorUserId" text not null references "user"(id) on delete cascade, "mailboxId" text not null references mailbox(id) on delete cascade, "requestId" text not null, "requestHash" text not null, "threadId" text not null, "snoozeId" text references "mailSnooze"(id) on delete set null, kind text not null, status text not null, "expectedVersion" integer, "resultingVersion" integer, code text, message text, "createdAt" timestamptz not null, "updatedAt" timestamptz not null, unique ("actorUserId", "mailboxId", "requestId", "threadId"));
    `);
  });
  beforeEach(async () => {
    await fixture.client.unsafe(
      'truncate "user", mailbox, "rateLimitBucket" restart identity cascade'
    );
    await fixture.client`insert into "user" (id) values ('actor'), ('other-actor')`;
    await fixture.client`insert into mailbox (id, provider) values ('mailbox', 'managed'), ('other-mailbox', 'managed')`;
    fixture.state.provider = "managed";
    fixture.state.readers = new Set(["actor", "other-actor"]);
    fixture.state.writers = new Set(["actor", "other-actor"]);
    fixture.state.messages = [];
    fixture.state.writes = 0;
    fixture.state.ambiguous = false;
    fixture.state.needsReconnect = false;
    fixture.state.afterCommit = undefined;
    fixture.state.beforeManagedAuthorization = undefined;
    fixture.state.beforeGmail = undefined;
    fixture.state.beforeSnapshot = undefined;
    fixture.state.beforeMetadata = undefined;
    fixture.state.beforeWriteResponse = undefined;
  });

  afterAll(async () => {
    await fixture.client.end();
  });

  test("durably hides, preserves timezone, reschedules without widening and restores only its original set", async () => {
    await seed({ id: "already-done", state: "done" });
    await seed({ id: "anchor", receivedAt: 2 });
    const first = await snooze();
    expect(first.status).toBe("applied");
    expect(first.snooze).toMatchObject({
      status: "active",
      timeZone: "Europe/Berlin",
    });
    const updated = await change({
      command: {
        kind: "reschedule",
        returnAt: new Date(Date.now() + 120_000).toISOString(),
        timeZone: "America/New_York",
      },
      version: first.snooze?.version ?? -1,
    });
    expect(updated.targets[0]?.snooze).toMatchObject({
      status: "active",
      timeZone: "America/New_York",
    });
    const returned = await change({
      command: { kind: "return-now" },
      version: updated.targets[0]?.snooze?.version ?? -1,
    });
    expect(returned.targets[0]?.snooze?.status).toBe("returned");
    const rows = await fixture.client<
      { id: string; state: string }[]
    >`select id, "mailboxState" as state from "managedMailMessage"`;
    expect(rows).toContainEqual({ id: "already-done", state: "done" });
    expect(rows).toContainEqual({ id: "anchor", state: "active" });
  });

  test("cancel leaves handled mail in Done and stale controls cannot cancel a newer schedule", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    const changed = await change({
      command: {
        kind: "reschedule",
        returnAt: new Date(Date.now() + 120_000).toISOString(),
        timeZone: "UTC",
      },
      version: first.snooze?.version ?? -1,
    });
    const stale = await change({
      command: { kind: "cancel" },
      version: first.snooze?.version ?? -1,
    });
    expect(stale.targets[0]?.status).toBe("failed");
    const cancelled = await change({
      command: { kind: "cancel" },
      version: changed.targets[0]?.snooze?.version ?? -1,
    });
    expect(cancelled.targets[0]?.snooze?.status).toBe("cancelled");
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("done");
  });

  test("an older accepted Snooze cannot fail a newer schedule after its original phase was cancelled", async () => {
    await seed({ id: "already-done", state: "done" });
    await seed({ id: "anchor", receivedAt: 2 });
    const requestId = randomUUID();
    const started = Promise.withResolvers<null>();
    const released = Promise.withResolvers<null>();
    fixture.state.afterCommit = async () => {
      const [pending] = await fixture.client<
        { version: number }[]
      >`select "resultingVersion" as version from "mailSnoozeOperation" where "requestId"=${requestId} and status='pending'`;
      if (pending === undefined) {
        return;
      }
      fixture.state.afterCommit = undefined;
      started.resolve(null);
      await released.promise;
    };
    const older = snooze({ requestId });
    await started.promise;
    let newer: Awaited<ReturnType<typeof snooze>> | undefined;
    const [reserved] = await fixture.client<
      { version: number }[]
    >`select "resultingVersion" as version from "mailSnoozeOperation" where "requestId"=${requestId}`;
    try {
      const cancelled = await change({
        command: { kind: "cancel" },
        version: reserved?.version ?? -1,
      });
      newer = await snooze({
        expectedVersion: cancelled.targets[0]?.snooze?.version ?? -1,
      });
    } finally {
      released.resolve(null);
    }
    const resumed = await older;
    expect(resumed).toMatchObject({
      snooze: { status: "active", version: newer?.snooze?.version },
      status: "failed",
    });
    const [journal] = await fixture.client<
      { version: number; status: string }[]
    >`select "resultingVersion" as version, status from "mailSnoozeOperation" where "requestId"=${requestId}`;
    expect(journal).toMatchObject({
      status: "pending",
      version: reserved?.version,
    });
    await makeDue(newer?.snooze?.id ?? "");
    await dispatchMailSnooze({
      id: newer?.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    const states = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "actor",
    });
    expect(states.get("conversation")?.status).toBe("returned");
    const messages = await fixture.client<
      { id: string; state: string }[]
    >`select id, "mailboxState" as state from "managedMailMessage"`;
    expect(messages).toContainEqual({ id: "anchor", state: "active" });
    expect(messages).toContainEqual({ id: "already-done", state: "done" });
  });

  test("a resumed API worker preserves a phase that recovery already completed", async () => {
    await seed({ id: "anchor" });
    const requestId = randomUUID();
    const started = Promise.withResolvers<null>();
    const released = Promise.withResolvers<null>();
    fixture.state.afterCommit = async () => {
      const [pending] = await fixture.client<
        { id: string }[]
      >`select "snoozeId" as id from "mailSnoozeOperation" where "requestId"=${requestId} and status='pending'`;
      if (pending === undefined) {
        return;
      }
      fixture.state.afterCommit = undefined;
      started.resolve(null);
      await released.promise;
    };
    const original = snooze({ requestId });
    await started.promise;
    const [reserved] = await fixture.client<
      { id: string }[]
    >`select "snoozeId" as id from "mailSnoozeOperation" where "requestId"=${requestId}`;
    try {
      await dispatchMailSnooze({
        id: reserved?.id ?? "",
        mailboxId: "mailbox",
      });
    } finally {
      released.resolve(null);
    }
    const resumed = await original;
    expect(resumed).toMatchObject({
      replayed: true,
      snooze: { status: "active" },
      status: "applied",
    });
    const [journal] = await fixture.client<
      { status: string; version: number }[]
    >`select status, "resultingVersion" as version from "mailSnoozeOperation" where "requestId"=${requestId}`;
    expect(journal).toMatchObject({
      status: "applied",
      version: resumed.snooze?.version,
    });
    const placements = await fixture.client<
      { status: string }[]
    >`select status from "mailPlacementOperation"`;
    expect(placements).toHaveLength(1);
    expect(placements[0]?.status).toBe("applied");
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("done");
  });

  test("a resumed API keeps its journal pending while recovery is still executing the accepted phase", async () => {
    await seed({ id: "anchor" });
    const requestId = randomUUID();
    const input: MailSnoozeApplyInput = {
      command: {
        kind: "snooze",
        returnAt: new Date(Date.now() + 60_000).toISOString(),
        timeZone: "Europe/Berlin",
      },
      mailboxId: "mailbox",
      requestId,
      targets: [
        {
          expectedVersion: null,
          messageIds: ["anchor"],
          threadId: "conversation",
        },
      ],
    };
    const apiStarted = Promise.withResolvers<null>();
    const apiReleased = Promise.withResolvers<null>();
    fixture.state.afterCommit = async () => {
      const [pending] = await fixture.client<
        { id: string }[]
      >`select "snoozeId" as id from "mailSnoozeOperation" where "requestId"=${requestId} and status='pending'`;
      if (pending === undefined) {
        return;
      }
      fixture.state.afterCommit = undefined;
      fixture.state.beforeManagedAuthorization = async () => {
        fixture.state.beforeManagedAuthorization = undefined;
        apiStarted.resolve(null);
        await apiReleased.promise;
      };
    };
    const original = applyMailSnooze({ context: { userId: "actor" }, input });
    await apiStarted.promise;
    const [reserved] = await fixture.client<
      { id: string; version: number }[]
    >`select "snoozeId" as id, "resultingVersion" as version from "mailSnoozeOperation" where "requestId"=${requestId}`;
    const recoveryStarted = Promise.withResolvers<null>();
    const recoveryReleased = Promise.withResolvers<null>();
    fixture.state.afterCommit = async () => {
      const [pending] = await fixture.client<
        { id: string }[]
      >`select id from "mailPlacementOperation" where "mailboxId"='mailbox' and "threadId"='conversation' and status='pending'`;
      if (pending === undefined) {
        return;
      }
      fixture.state.afterCommit = undefined;
      recoveryStarted.resolve(null);
      await recoveryReleased.promise;
    };
    const recovery = dispatchMailSnooze({
      id: reserved?.id ?? "",
      mailboxId: "mailbox",
    });
    await recoveryStarted.promise;
    try {
      apiReleased.resolve(null);
      const resumed = await original;
      expect(resumed.targets[0]?.status).toBe("failed");
      const [pending] = await fixture.client<
        { status: string; version: number }[]
      >`select status, "resultingVersion" as version from "mailSnoozeOperation" where "requestId"=${requestId}`;
      expect(pending).toMatchObject({
        status: "pending",
        version: reserved?.version,
      });
    } finally {
      apiReleased.resolve(null);
      recoveryReleased.resolve(null);
      await Promise.allSettled([original, recovery]);
    }
    const replayed = await applyMailSnooze({
      context: { userId: "actor" },
      input,
    });
    expect(replayed.targets[0]).toMatchObject({
      replayed: true,
      snooze: { status: "active" },
      status: "applied",
    });
    const placements = await fixture.client<
      { status: string }[]
    >`select status from "mailPlacementOperation" where "mailboxId"='mailbox' and "threadId"='conversation'`;
    expect(placements).toHaveLength(1);
    expect(placements[0]?.status).toBe("applied");
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("done");
  });

  test("an API placement source failure cannot clear a recovery lease or finalize its journal", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const requestId = randomUUID();
    const apiStarted = Promise.withResolvers<null>();
    const apiReleased = Promise.withResolvers<null>();
    fixture.state.afterCommit = async () => {
      const [pending] = await fixture.client<
        { id: string }[]
      >`select id from "mailPlacementOperation" where "mailboxId"='mailbox' and "threadId"='conversation' and status='pending'`;
      if (pending === undefined) {
        return;
      }
      fixture.state.afterCommit = undefined;
      fixture.state.beforeSnapshot = async () => {
        fixture.state.beforeSnapshot = undefined;
        apiStarted.resolve(null);
        await apiReleased.promise;
        throw new ORPCError("BAD_REQUEST", {
          message: "The source read failed before any mail changed.",
        });
      };
    };
    const original = snooze({ requestId });
    await apiStarted.promise;
    const [reserved] = await fixture.client<
      { id: string }[]
    >`select "snoozeId" as id from "mailSnoozeOperation" where "requestId"=${requestId}`;
    const recoveryStarted = Promise.withResolvers<null>();
    const recoveryReleased = Promise.withResolvers<null>();
    fixture.state.afterCommit = async () => {
      const [claimed] = await fixture.client<
        { token: string | null }[]
      >`select "leaseToken" as token from "mailSnooze" where id=${reserved?.id ?? ""}`;
      if (claimed?.token === null || claimed === undefined) {
        return;
      }
      fixture.state.afterCommit = undefined;
      recoveryStarted.resolve(null);
      await recoveryReleased.promise;
    };
    const recovery = dispatchMailSnooze({
      id: reserved?.id ?? "",
      mailboxId: "mailbox",
    });
    await recoveryStarted.promise;
    const [claimed] = await fixture.client<
      { token: string; version: number }[]
    >`select "leaseToken" as token, version from "mailSnooze" where id=${reserved?.id ?? ""}`;
    try {
      apiReleased.resolve(null);
      const originalResult = await original;
      expect(originalResult.status).toBe("failed");
      const [current] = await fixture.client<
        { token: string; status: string; version: number }[]
      >`select "leaseToken" as token, status, version from "mailSnooze" where id=${reserved?.id ?? ""}`;
      expect(current).toMatchObject({
        status: "preparing",
        token: claimed?.token,
        version: claimed?.version,
      });
      const [journal] = await fixture.client<
        { status: string }[]
      >`select status from "mailSnoozeOperation" where "requestId"=${requestId}`;
      expect(journal?.status).toBe("pending");
    } finally {
      apiReleased.resolve(null);
      recoveryReleased.resolve(null);
      await Promise.allSettled([original, recovery]);
    }
    expect(fixture.state.writes).toBe(0);
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
    const [journal] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnoozeOperation" where "requestId"=${requestId}`;
    expect(journal?.status).toBe("failed");
  });

  test("replacement execution leases preserve the native phase identity without another Gmail write", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const first = await snooze();
    const [phase] = await fixture.client<
      { requestId: string; messageIds: string[] }[]
    >`select "hideRequestId" as "requestId", "hiddenMessageIds" as "messageIds" from "mailSnooze" where id=${first.snooze?.id ?? ""}`;
    const { writes } = fixture.state;
    const result = await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: phase?.requestId ?? "",
        targets: [
          { messageIds: phase?.messageIds ?? [], threadId: "conversation" },
        ],
      },
      snooze: {
        id: first.snooze?.id ?? "",
        kind: "snooze-hide",
        leaseToken: randomUUID(),
        version: (first.snooze?.version ?? 0) - 1,
      },
    });
    expect(result.targets[0]).toMatchObject({
      replayed: true,
      status: "applied",
    });
    expect(fixture.state.writes).toBe(writes);
    const phases = await fixture.client<
      { status: string }[]
    >`select status from "mailPlacementOperation" where "requestId"=${phase?.requestId ?? ""}`;
    expect(phases).toHaveLength(1);
    expect(phases[0]?.status).toBe("applied");
  });

  test("duplicates replay without re-hiding after a newer return, and identity payload changes conflict", async () => {
    await seed({ id: "anchor" });
    const request = {
      context: { userId: "actor" },
      input: {
        command: {
          kind: "snooze",
          returnAt: new Date(Date.now() + 60_000).toISOString(),
          timeZone: "UTC",
        },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [
          {
            expectedVersion: null,
            messageIds: ["anchor"],
            threadId: "conversation",
          },
        ],
      },
    } satisfies Parameters<typeof applyMailSnooze>[0];
    const first = await applyMailSnooze(request);
    await change({
      command: { kind: "return-now" },
      version: first.targets[0]?.snooze?.version ?? -1,
    });
    const replay = await applyMailSnooze(request);
    expect(replay.targets[0]).toMatchObject({
      replayed: true,
      snooze: { status: "returned" },
      status: "applied",
    });
    await expect(
      applyMailSnooze({
        ...request,
        input: {
          ...request.input,
          command: { ...request.input.command, timeZone: "Europe/Berlin" },
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("active");
  });

  test("invalid targets do not store schedules or journals and mixed-batch rejection stays immutable", async () => {
    await seed({ id: "anchor" });
    const request = {
      context: { userId: "actor" },
      input: {
        command: {
          kind: "snooze",
          returnAt: new Date(Date.now() + 60_000).toISOString(),
          timeZone: "UTC",
        },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [
          {
            expectedVersion: null,
            messageIds: ["anchor"],
            threadId: "conversation",
          },
          {
            expectedVersion: null,
            messageIds: ["missing"],
            threadId: "missing",
          },
        ],
      },
    } satisfies Parameters<typeof applyMailSnooze>[0];
    const first = await applyMailSnooze(request);
    expect(first.targets).toContainEqual(
      expect.objectContaining({ status: "failed", threadId: "missing" })
    );
    await seed({ id: "missing", threadId: "missing" });
    const replay = await applyMailSnooze(request);
    expect(replay.targets).toContainEqual(
      expect.objectContaining({
        replayed: true,
        status: "failed",
        threadId: "missing",
      })
    );
    const rows = await fixture.client<
      { threadId: string }[]
    >`select "threadId" from "mailSnooze"`;
    expect(rows.map((row) => row.threadId)).not.toContain("missing");
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='missing'`;
    expect(message?.state).toBe("active");
  });

  test("a due wake returns without a browser and duplicate wake does not move again", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    await makeDue(id);
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const [returned] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnooze" where id=${id}`;
    expect(returned?.status).toBe("returned");
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("active");
  });

  test.each(["new", "historical"])(
    "a restored Return now schedule requires its %s hide owner at the actual due worker",
    async (ownership) => {
      await seed({ id: "outside", state: "done" });
      await seed({ id: "anchor" });
      const first = await snooze();
      const id = first.snooze?.id ?? "";
      const [previous] = await fixture.client<
        {
          hideOperationId: string;
          hiddenMessageIds: string[];
          knownIncomingMessageIds: string[];
          returnAt: string;
          timeZone: string;
        }[]
      >`select "hideOperationId", "hiddenMessageIds", "knownIncomingMessageIds", "returnAt"::text as "returnAt", "timeZone" from "mailSnooze" where id=${id}`;
      if (previous === undefined) {
        throw new Error("Expected the prior active schedule.");
      }
      await change({
        command: { kind: "return-now" },
        version: first.snooze?.version ?? 0,
      });
      const [returned] = await fixture.client<
        { version: number }[]
      >`select version from "mailSnooze" where id=${id}`;
      if (returned === undefined) {
        throw new Error("Expected a returned schedule.");
      }
      const requestId = randomUUID();
      const result = await applyMailPlacement({
        context: { userId: "actor" },
        input: {
          command: { kind: "set-placement", placement: "done" },
          mailboxId: "mailbox",
          requestId,
          targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
        },
      });
      const [target] = result.targets;
      if (target?.status !== "applied" || !target.operationId) {
        throw new Error("Expected the acknowledged new native hide.");
      }
      const [receipt] = await fixture.client<
        {
          id: string;
          messageIds: string[];
          requestedMessageIds: string[];
          requestId: string;
        }[]
      >`select id, "messageIds", "requestedMessageIds", "requestId" from "mailPlacementOperation" where id=${target.operationId}`;
      if (receipt === undefined) {
        throw new Error("Expected the actual native receipt.");
      }
      const attemptId = randomUUID();
      const input = mailUndoRehideBindingSchema.parse({
        outcome: {
          acknowledgedMessageIds: receipt.messageIds,
          actorUserId: "actor",
          mailboxId: "mailbox",
          operationId: receipt.id,
          placement: "done",
          requestId: receipt.requestId,
          requestedMessageIds: receipt.requestedMessageIds,
          status: "acknowledged",
          threadId: "conversation",
        },
        phase: { attemptId, requestId },
        plan: {
          effects: [
            {
              destination: { kind: "managed", value: "done" },
              expectedIntentToken: randomUUID(),
              facet: "destination",
              messageId: "anchor",
              sourceProof: { kind: "managed-revision", revision: "0" },
            },
          ],
          expectedVersion: returned.version.toString(),
          kind: "snooze",
          nextVersion: (returned.version + 1).toString(),
          restoration: {
            kind: "rehide",
            predecessorHideOperationId: previous.hideOperationId,
            template: {
              hiddenMessageIds: previous.hiddenMessageIds,
              id,
              knownIncomingMessageIds: previous.knownIncomingMessageIds,
              returnAt: new Date(previous.returnAt).toISOString(),
              status: "active",
              timeZone: previous.timeZone,
            },
          },
          scheduleId: id,
          scope: {
            actorUserId: "actor",
            attemptId,
            mailboxId: "mailbox",
            threadId: "conversation",
          },
        },
      });
      const bound = bindMailUndoRehide(input);
      if (bound.kind !== "bound") {
        throw new Error("Expected a matching acknowledged hide binding.");
      }
      const hideOperationId =
        ownership === "new"
          ? bound.schedule.hideOperationId
          : previous.hideOperationId;
      await fixture.client`update "mailSnooze" set status='active', version=${returned.version + 1}, "hideOperationId"=${hideOperationId}, "hideRequestId"=${receipt.requestId}, "returnOperationId"=null, "returnRequestId"=null, "leaseToken"=null, "leaseUntil"=null where id=${id}`;
      await makeDue(id);
      await dispatchMailSnooze({ id, mailboxId: "mailbox" });
      const [finished] = await fixture.client<
        { status: string }[]
      >`select status from "mailSnooze" where id=${id}`;
      const messages = await fixture.client<
        { id: string; state: string }[]
      >`select id, "mailboxState" as state from "managedMailMessage" order by id`;
      expect(finished?.status).toBe(
        ownership === "new" ? "returned" : "suspended"
      );
      expect(messages.find((message) => message.id === "anchor")?.state).toBe(
        ownership === "new" ? "active" : "done"
      );
      expect(messages.find((message) => message.id === "outside")?.state).toBe(
        "done"
      );
      const [count] = await fixture.client<
        { count: number }[]
      >`select count(*)::integer as count from "mailPlacementOperation"`;
      await dispatchMailSnooze({ id, mailboxId: "mailbox" });
      const [afterDuplicate] = await fixture.client<
        { count: number }[]
      >`select count(*)::integer as count from "mailPlacementOperation"`;
      expect(afterDuplicate?.count).toBe(count?.count);
    }
  );

  test("a later Done no-op and legacy move retire the schedule before any old wake", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [
          {
            messageIds: ["anchor"],
            threadId: "conversation",
          },
        ],
      },
    });
    await makeDue(first.snooze?.id ?? "");
    await dispatchMailSnooze({
      id: first.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("done");
    await fixture.client`update "managedMailMessage" set "mailboxState"='active' where id='anchor'`;
    const states = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "actor",
    });
    const state = states.get("conversation");
    const next = await snooze({ expectedVersion: state?.version });
    await supersedePendingMailPlacement({
      context: { userId: "actor" },
      mailboxId: "mailbox",
      messageId: "anchor",
    });
    await fixture.client`update "managedMailMessage" set "mailboxState"='trash' where id='anchor'`;
    await makeDue(next.snooze?.id ?? "");
    await dispatchMailSnooze({
      id: next.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    const [protectedMessage] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(protectedMessage?.state).toBe("trash");
  });

  test("an old capture replay leaves a schedule alone, a truly new reply retires it", async () => {
    await seed({ id: "old", state: "done" });
    await seed({ id: "anchor", receivedAt: 2 });
    const first = await snooze();
    await handleSnoozeInbound({
      mailboxId: "mailbox",
      messageId: "old",
      threadId: "conversation",
    });
    const states = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "actor",
    });
    expect(states.get("conversation")?.status).toBe("active");
    await seed({ id: "new-reply", receivedAt: 3 });
    await handleSnoozeInbound({
      mailboxId: "mailbox",
      messageId: "new-reply",
      threadId: "conversation",
    });
    await makeDue(first.snooze?.id ?? "");
    await dispatchMailSnooze({
      id: first.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    const rows = await fixture.client<
      { id: string; state: string }[]
    >`select id, "mailboxState" as state from "managedMailMessage"`;
    expect(rows).toContainEqual({ id: "anchor", state: "done" });
    expect(rows).toContainEqual({ id: "new-reply", state: "active" });
  });

  test("due source inspection repairs a missed inbound hook", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    await seed({ id: "new-reply", receivedAt: 2 });
    await makeDue(first.snooze?.id ?? "");
    await dispatchMailSnooze({
      id: first.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    const [row] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnooze"`;
    expect(row?.status).toBe("superseded");
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("done");
  });

  test("revoked execution access suspends without movement and another authorized writer can adopt", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    fixture.state.writers.delete("actor");
    await makeDue(first.snooze?.id ?? "");
    await dispatchMailSnooze({
      id: first.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    const states = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "other-actor",
    });
    const current = states.get("conversation");
    expect(current?.status).toBe("suspended");
    const adopted = await change({
      command: {
        kind: "reschedule",
        returnAt: new Date(Date.now() + 60_000).toISOString(),
        timeZone: "UTC",
      },
      userId: "other-actor",
      version: current?.version ?? -1,
    });
    expect(adopted.targets[0]?.snooze?.status).toBe("active");
    fixture.state.readers.delete("actor");
    await expect(
      getMailSnoozeStates({
        mailboxId: "mailbox",
        threadIds: ["conversation"],
        userId: "actor",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a new Inbox reply retires an access-suspended snooze while a known capture replay preserves it", async () => {
    await seed({ id: "old-capture", state: "done" });
    await seed({ id: "anchor", receivedAt: 2 });
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    fixture.state.writers.delete("actor");
    await makeDue(id);
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const [suspended] = await fixture.client<
      { status: string; version: number; hidden: string[]; known: string[] }[]
    >`select status, version, "hiddenMessageIds" as hidden, "knownIncomingMessageIds" as known from "mailSnooze" where id=${id}`;
    expect(suspended).toMatchObject({
      hidden: ["anchor"],
      status: "suspended",
    });
    expect(suspended?.known).toContain("old-capture");
    const native = await fixture.client<
      { id: string; status: string }[]
    >`select id, status from "mailPlacementOperation" order by sequence`;
    expect(native).toHaveLength(1);
    expect(native[0]?.status).toBe("applied");

    await fixture.client`update "managedMailMessage" set "mailboxState"='active' where id='old-capture'`;
    await handleSnoozeInbound({
      mailboxId: "mailbox",
      messageId: "old-capture",
      threadId: "conversation",
    });
    const knownReplay = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "other-actor",
    });
    expect(knownReplay.get("conversation")).toMatchObject({
      status: "suspended",
      version: suspended?.version,
    });

    await seed({ id: "new-reply", receivedAt: 3 });
    await handleSnoozeInbound({
      mailboxId: "mailbox",
      messageId: "new-reply",
      threadId: "conversation",
    });
    const states = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "other-actor",
    });
    const retired = states.get("conversation");
    expect(retired?.status).toBe("superseded");
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const messages = await fixture.client<
      { id: string; state: string }[]
    >`select id, "mailboxState" as state from "managedMailMessage"`;
    expect(messages).toContainEqual({ id: "anchor", state: "done" });
    expect(messages).toContainEqual({ id: "new-reply", state: "active" });
    await expect(
      fixture.client<
        { id: string; status: string }[]
      >`select id, status from "mailPlacementOperation" order by sequence`
    ).resolves.toStrictEqual(native);

    const next = await applyMailSnooze({
      context: { userId: "other-actor" },
      input: {
        command: {
          kind: "snooze",
          returnAt: new Date(Date.now() + 60_000).toISOString(),
          timeZone: "UTC",
        },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [
          {
            expectedVersion: retired?.version ?? -1,
            messageIds: ["new-reply"],
            threadId: "conversation",
          },
        ],
      },
    });
    expect(next.targets[0]).toMatchObject({
      snooze: { status: "active" },
      status: "applied",
    });
    const [hiddenReply] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='new-reply'`;
    expect(hiddenReply?.state).toBe("done");
  });

  test("a stale authorization rejection cannot stop a newly authorized execution lease", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    await makeDue(id);
    fixture.state.writers.delete("actor");
    const firstStarted = Promise.withResolvers<null>();
    const firstReleased = Promise.withResolvers<null>();
    fixture.state.beforeManagedAuthorization = async () => {
      fixture.state.beforeManagedAuthorization = undefined;
      firstStarted.resolve(null);
      await firstReleased.promise;
    };
    const older = dispatchMailSnooze({ id, mailboxId: "mailbox" });
    await firstStarted.promise;
    fixture.state.writers.add("actor");
    const nextStarted = Promise.withResolvers<null>();
    const nextReleased = Promise.withResolvers<null>();
    fixture.state.afterCommit = async () => {
      const [claimed] = await fixture.client<
        { token: string | null }[]
      >`select "leaseToken" as token from "mailSnooze" where id=${id}`;
      if (claimed?.token === null || claimed === undefined) {
        return;
      }
      fixture.state.afterCommit = undefined;
      nextStarted.resolve(null);
      await nextReleased.promise;
    };
    const newer = dispatchMailSnooze({ id, mailboxId: "mailbox" });
    await nextStarted.promise;
    const [claimed] = await fixture.client<
      { token: string; version: number; at: number }[]
    >`select "leaseToken" as token, version, floor(extract(epoch from "nextWakeAt") * 1000)::float8 as at from "mailSnooze" where id=${id}`;
    try {
      firstReleased.resolve(null);
      const stale = await older;
      expect(stale.nextWakeAt).toBe(claimed?.at);
      fixture.state.writers.delete("actor");
      try {
        const duplicate = await dispatchMailSnooze({
          id,
          mailboxId: "mailbox",
        });
        expect(duplicate.nextWakeAt).toBe(claimed?.at);
      } finally {
        fixture.state.writers.add("actor");
      }
      const [current] = await fixture.client<
        { token: string; status: string; version: number }[]
      >`select "leaseToken" as token, status, version from "mailSnooze" where id=${id}`;
      expect(current).toMatchObject({
        status: "active",
        token: claimed?.token,
        version: claimed?.version,
      });
    } finally {
      firstReleased.resolve(null);
      nextReleased.resolve(null);
      await Promise.allSettled([older, newer]);
    }
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("active");
    const states = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "actor",
    });
    expect(states.get("conversation")?.status).toBe("returned");
  });

  test("reconnect-required credentials suspend the retained schedule until explicit authorized recovery", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    await makeDue(id);
    fixture.state.needsReconnect = true;
    const { writes } = fixture.state;
    await expect(
      dispatchMailSnooze({ id, mailboxId: "mailbox" })
    ).resolves.toMatchObject({ nextWakeAt: null });
    const [paused] = await fixture.client<
      {
        hidden: string[];
        nextWakeAt: Date | null;
        status: string;
        version: number;
      }[]
    >`select "hiddenMessageIds" as hidden, "nextWakeAt", status, version from "mailSnooze" where id=${id}`;
    expect(paused).toMatchObject({
      hidden: ["anchor"],
      nextWakeAt: null,
      status: "suspended",
    });
    expect(fixture.state.writes).toBe(writes);
    expect(fixture.state.messages[0]?.labelIds).not.toContain("INBOX");
    fixture.state.needsReconnect = false;
    const adopted = await change({
      command: {
        kind: "reschedule",
        returnAt: new Date(Date.now() + 60_000).toISOString(),
        timeZone: "UTC",
      },
      version: paused?.version ?? -1,
    });
    expect(adopted.targets[0]?.snooze?.status).toBe("active");
    await makeDue(id);
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
    const states = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "actor",
    });
    expect(states.get("conversation")?.status).toBe("returned");
  });

  test.each([
    {
      completed: false,
      error: new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
        message: "Google access needs to be reconnected for this mailbox.",
        status: 409,
      }),
      kind: "credential",
    },
    {
      completed: false,
      error: new Error("Connection interrupted."),
      kind: "transient",
    },
    {
      completed: true,
      error: new Error("Connection interrupted."),
      kind: "completed transient",
    },
  ])(
    "an old $kind failure preserves the current execution wake",
    async ({ completed, error }) => {
      fixture.state.provider = "gmail";
      await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
      fixture.state.messages = [
        {
          id: "anchor",
          internalDate: "1",
          labelIds: ["INBOX"],
          threadId: "conversation",
        },
      ];
      const first = await snooze();
      const id = first.snooze?.id ?? "";
      await makeDue(id);
      const firstStarted = Promise.withResolvers<null>();
      const firstReleased = Promise.withResolvers<null>();
      fixture.state.beforeGmail = async () => {
        fixture.state.beforeGmail = undefined;
        firstStarted.resolve(null);
        await firstReleased.promise;
        throw error;
      };
      const older = dispatchMailSnooze({ id, mailboxId: "mailbox" });
      await firstStarted.promise;
      await fixture.client`update "mailSnooze" set "leaseUntil"=now() - interval '1 second' where id=${id}`;
      const nextStarted = Promise.withResolvers<null>();
      const nextReleased = Promise.withResolvers<null>();
      fixture.state.beforeGmail = async () => {
        fixture.state.beforeGmail = undefined;
        nextStarted.resolve(null);
        await nextReleased.promise;
      };
      const newer = dispatchMailSnooze({ id, mailboxId: "mailbox" });
      await nextStarted.promise;
      const [claimed] = await fixture.client<
        { token: string; version: number }[]
      >`select "leaseToken" as token, version from "mailSnooze" where id=${id}`;
      try {
        if (completed) {
          nextReleased.resolve(null);
          await newer;
        }
        firstReleased.resolve(null);
        const stale = await older;
        const [current] = await fixture.client<
          {
            at: number | null;
            token: string | null;
            status: string;
            version: number;
          }[]
        >`select "leaseToken" as token, status, version, floor(extract(epoch from "nextWakeAt") * 1000)::float8 as at from "mailSnooze" where id=${id}`;
        expect(stale.nextWakeAt).toBe(current?.at ?? null);
        expect(current).toMatchObject(
          completed
            ? {
                status: "returned",
                token: null,
              }
            : {
                status: "active",
                token: claimed?.token,
                version: claimed?.version,
              }
        );
      } finally {
        firstReleased.resolve(null);
        nextReleased.resolve(null);
        await Promise.all([older, newer]);
      }
      expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
      const states = await getMailSnoozeStates({
        mailboxId: "mailbox",
        threadIds: ["conversation"],
        userId: "actor",
      });
      expect(states.get("conversation")?.status).toBe("returned");
    }
  );

  test("actor deletion preserves the exact shared recovery set and explicit return can recover it", async () => {
    await seed({ id: "already-done", state: "done" });
    await seed({ id: "anchor", receivedAt: 2 });
    const first = await snooze();
    await fixture.client`delete from "user" where id='actor'`;
    await dispatchMailSnooze({
      id: first.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    const [row] = await fixture.client<
      { hidden: string[]; status: string; version: number }[]
    >`select "hiddenMessageIds" as hidden, status, version from "mailSnooze"`;
    expect(row?.hidden).toContain("anchor");
    expect(row?.status).toBe("suspended");
    const returned = await change({
      command: { kind: "return-now" },
      userId: "other-actor",
      version: row?.version ?? -1,
    });
    expect(returned.targets[0]?.snooze?.status).toBe("returned");
    const [retained] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='already-done'`;
    expect(retained?.state).toBe("done");
  });

  test("lost wake reconciliation persists repair and a disconnected mailbox cannot return", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    await makeDue(first.snooze?.id ?? "");
    await reconcileMailSnoozes();
    const [row] = await fixture.client<
      { pending: boolean }[]
    >`select "nextWakeAt" > now() as pending from "mailSnooze"`;
    expect(row?.pending).toBeTruthy();
    await fixture.client`delete from mailbox where id='mailbox'`;
    await expect(
      dispatchMailSnooze({
        id: first.snooze?.id ?? "",
        mailboxId: "mailbox",
      })
    ).resolves.toMatchObject({ nextWakeAt: null });
  });

  test.each(["current", "superseded"] as const)(
    "an ambiguous Gmail hide retains its %s replay outcome after repeated dispatch",
    async (phase) => {
      fixture.state.provider = "gmail";
      await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
      fixture.state.messages = [
        {
          id: "anchor",
          internalDate: "1",
          labelIds: ["INBOX"],
          threadId: "conversation",
        },
      ];
      fixture.state.ambiguous = true;
      const input: MailSnoozeApplyInput = {
        command: {
          kind: "snooze",
          returnAt: new Date(Date.now() + 60_000).toISOString(),
          timeZone: "Europe/Berlin",
        },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [
          {
            expectedVersion: null,
            messageIds: ["anchor"],
            threadId: "conversation",
          },
        ],
      };
      const first = await applyMailSnooze({
        context: { userId: "actor" },
        input,
      });
      expect(first.targets[0]?.snooze?.status).toBe("uncertain");
      const replacementRequestId = randomUUID();
      if (phase === "superseded") {
        const cancelled = await change({
          command: { kind: "cancel" },
          version: first.targets[0]?.snooze?.version ?? -1,
        });
        fixture.state.messages[0].labelIds = ["INBOX"];
        await snooze({
          expectedVersion: cancelled.targets[0]?.snooze?.version,
          requestId: replacementRequestId,
        });
      }
      const { writes } = fixture.state;
      const original = await fixture.client<
        { id: string }[]
      >`select id from "mailPlacementOperation" order by sequence`;
      await dispatchMailSnooze({
        id: first.targets[0]?.snooze?.id ?? "",
        mailboxId: "mailbox",
      });
      await dispatchMailSnooze({
        id: first.targets[0]?.snooze?.id ?? "",
        mailboxId: "mailbox",
      });
      const [confirmed] = await fixture.client<
        { status: string }[]
      >`select status from "mailSnoozeOperation" where "requestId"=${phase === "superseded" ? replacementRequestId : input.requestId}`;
      expect(confirmed?.status).toBe("applied");
      const replay = await applyMailSnooze({
        context: { userId: "actor" },
        input,
      });
      expect(replay.targets[0]).toMatchObject({
        operationId: first.targets[0]?.operationId,
        replayed: true,
        snooze: { status: "active" },
        status: phase === "current" ? "applied" : "failed",
      });
      await expect(
        fixture.client<
          { id: string }[]
        >`select id from "mailPlacementOperation" order by sequence`
      ).resolves.toStrictEqual(original);
      expect(fixture.state.writes).toBe(writes);
      expect(fixture.state.messages[0]?.labelIds).not.toContain("INBOX");
    }
  );

  test("recovers the first hide from a durable preparing row using its reserved identity", async () => {
    await seed({ id: "already-done", state: "done" });
    await seed({ id: "anchor", receivedAt: 2 });
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    const [saved] = await fixture.client<
      { requestId: string }[]
    >`select "hideRequestId" as "requestId" from "mailSnooze" where id=${id}`;
    await fixture.client`delete from "mailPlacementOperation" where "mailboxId"='mailbox'`;
    await fixture.client`update "managedMailMessage" set "mailboxState"='active' where id='anchor'`;
    await fixture.client`update "mailSnooze" set status='preparing', "nextWakeAt"=now() where id=${id}`;
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const [operation] = await fixture.client<
      { requestId: string; status: string }[]
    >`select "requestId", status from "mailPlacementOperation"`;
    expect(operation).toMatchObject({
      requestId: saved?.requestId,
      status: "applied",
    });
    const [current] = await fixture.client<
      { status: string; hidden: string[] }[]
    >`select status, "hiddenMessageIds" as hidden from "mailSnooze" where id=${id}`;
    expect(current).toMatchObject({ hidden: ["anchor"], status: "active" });
  });

  test.each(["pending", "submitting"])(
    "does not redispatch a %s native identity after process death",
    async (status) => {
      fixture.state.provider = "gmail";
      await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
      fixture.state.messages = [
        {
          id: "anchor",
          internalDate: "1",
          labelIds: ["INBOX"],
          threadId: "conversation",
        },
      ];
      const first = await snooze();
      fixture.state.messages[0]?.labelIds?.push("INBOX");
      await fixture.client`update "mailPlacementOperation" set status=${status}`;
      await fixture.client`update "mailSnooze" set status='preparing', "nextWakeAt"=now() where id=${first.snooze?.id ?? ""}`;
      const { writes } = fixture.state;
      await dispatchMailSnooze({
        id: first.snooze?.id ?? "",
        mailboxId: "mailbox",
      });
      expect(fixture.state.writes).toBe(writes);
      expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
      const [current] = await fixture.client<
        { status: string }[]
      >`select status from "mailSnooze"`;
      expect(["failed", "uncertain"]).toContain(current?.status);
    }
  );

  test("recovers the return request gap and concurrent wakes share one durable return", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    const requestId = randomUUID();
    await makeDue(id);
    await fixture.client`update "mailSnooze" set status='returning', "returnRequestId"=${requestId}, version=version+1 where id=${id}`;
    await Promise.all([
      dispatchMailSnooze({ id, mailboxId: "mailbox" }),
      dispatchMailSnooze({ id, mailboxId: "mailbox" }),
    ]);
    const operations = await fixture.client<
      { requestId: string; status: string }[]
    >`select "requestId", status from "mailPlacementOperation" where placement='inbox'`;
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ requestId, status: "applied" });
    const [current] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnooze"`;
    expect(current?.status).toBe("returned");
  });

  test("a deleted hide receipt blocks automatic return before any new placement is admitted", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    await fixture.client`delete from "mailPlacementOperation"`;
    await makeDue(id);
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const [current] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnooze"`;
    expect(current?.status).toBe("suspended");
    const operations =
      await fixture.client`select id from "mailPlacementOperation"`;
    expect(operations).toHaveLength(0);
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("done");
  });

  test("a newer no-op Done wins while the due return eligibility read is outstanding", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    await makeDue(id);
    const started = Promise.withResolvers<null>();
    const released = Promise.withResolvers<null>();
    fixture.state.beforeMetadata = async () => {
      fixture.state.beforeMetadata = undefined;
      started.resolve(null);
      await released.promise;
    };
    const due = dispatchMailSnooze({ id, mailboxId: "mailbox" });
    await started.promise;
    const { writes } = fixture.state;
    try {
      await applyMailPlacement({
        context: { userId: "actor" },
        input: {
          command: { kind: "set-placement", placement: "done" },
          mailboxId: "mailbox",
          requestId: randomUUID(),
          targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
        },
      });
    } finally {
      released.resolve(null);
    }
    await due;
    expect(fixture.state.writes).toBe(writes);
    expect(fixture.state.messages[0]?.labelIds).not.toContain("INBOX");
    const [current] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnooze"`;
    expect(current?.status).toBe("superseded");
  });

  test("an accepted native return with a lost response is confirmed from source without another write", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const first = await snooze();
    fixture.state.ambiguous = true;
    const input = {
      command: { kind: "return-now" },
      requestId: randomUUID(),
      version: first.snooze?.version ?? -1,
    } satisfies Parameters<typeof change>[0];
    const returned = await change(input);
    expect(returned.targets[0]?.snooze?.status).toBe("uncertain");
    const { writes } = fixture.state;
    const original = await fixture.client<
      { id: string }[]
    >`select id from "mailPlacementOperation" order by sequence`;
    await dispatchMailSnooze({
      id: first.snooze?.id ?? "",
      mailboxId: "mailbox",
    });
    expect(fixture.state.writes).toBe(writes);
    const [current] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnooze"`;
    expect(current?.status).toBe("returned");
    const replay = await change(input);
    expect(replay.targets[0]).toMatchObject({
      operationId: returned.targets[0]?.operationId,
      replayed: true,
      snooze: { status: "returned" },
      status: "applied",
    });
    await expect(
      fixture.client<
        { id: string }[]
      >`select id from "mailPlacementOperation" order by sequence`
    ).resolves.toStrictEqual(original);
    expect(fixture.state.writes).toBe(writes);
  });

  test("a manual native return replays its original journal after an unconfirmed recovery poll and later Inbox confirmation", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    fixture.state.ambiguous = true;
    const input = {
      command: { kind: "return-now" },
      requestId: randomUUID(),
      version: first.snooze?.version ?? -1,
    } satisfies Parameters<typeof change>[0];
    const returned = await change(input);
    expect(returned.targets[0]?.snooze?.status).toBe("uncertain");
    const { writes } = fixture.state;
    const native = await fixture.client<
      { id: string; requestId: string }[]
    >`select id, "requestId" from "mailPlacementOperation" order by sequence`;
    const [original] = await fixture.client<
      { id: string; status: string }[]
    >`select id, status from "mailSnoozeOperation" where "requestId"=${input.requestId}`;
    expect(original).toMatchObject({
      id: returned.targets[0]?.operationId,
      status: "uncertain",
    });

    fixture.state.messages[0].labelIds = [];
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const unconfirmed = await getMailSnoozeStates({
      mailboxId: "mailbox",
      threadIds: ["conversation"],
      userId: "actor",
    });
    expect(unconfirmed.get("conversation")?.status).toBe("uncertain");
    expect(fixture.state.writes).toBe(writes);

    fixture.state.messages[0].labelIds = ["INBOX"];
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const replay = await change(input);
    expect(replay.targets[0]).toMatchObject({
      operationId: original?.id,
      replayed: true,
      snooze: { status: "returned" },
      status: "applied",
    });
    const [confirmed] = await fixture.client<
      { id: string; status: string }[]
    >`select id, status from "mailSnoozeOperation" where "requestId"=${input.requestId}`;
    expect(confirmed).toMatchObject({ id: original?.id, status: "applied" });
    await expect(
      fixture.client<
        { id: string; requestId: string }[]
      >`select id, "requestId" from "mailPlacementOperation" order by sequence`
    ).resolves.toStrictEqual(native);
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
    expect(fixture.state.writes).toBe(writes);
  });

  test("a later due return confirms without promoting an older uncertain manual journal", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    fixture.state.ambiguous = true;
    const input = {
      command: { kind: "return-now" },
      requestId: randomUUID(),
      version: first.snooze?.version ?? -1,
    } satisfies Parameters<typeof change>[0];
    const manual = await change(input);
    expect(manual.targets[0]?.snooze?.status).toBe("uncertain");
    const cancelled = await change({
      command: { kind: "cancel" },
      version: manual.targets[0]?.snooze?.version ?? -1,
    });
    fixture.state.ambiguous = false;
    const second = await snooze({
      expectedVersion: cancelled.targets[0]?.snooze?.version,
    });
    expect(second.snooze?.status).toBe("active");
    await makeDue(id);
    fixture.state.ambiguous = true;
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const [due] = await fixture.client<
      { status: string; nativeStatus: string }[]
    >`select s.status, p.status as "nativeStatus" from "mailSnooze" s join "mailPlacementOperation" p on p.id=s."returnOperationId" where s.id=${id}`;
    expect(due).toMatchObject({
      nativeStatus: "uncertain",
      status: "uncertain",
    });
    const { writes } = fixture.state;
    const native = await fixture.client<
      { id: string; requestId: string }[]
    >`select id, "requestId" from "mailPlacementOperation" order by sequence`;
    fixture.state.messages[0].labelIds = [];
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    fixture.state.messages[0].labelIds = ["INBOX"];
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const replay = await change(input);
    expect(replay.targets[0]).toMatchObject({
      operationId: manual.targets[0]?.operationId,
      replayed: true,
      snooze: { status: "returned" },
      status: "failed",
    });
    const [journal] = await fixture.client<
      { status: string }[]
    >`select status from "mailSnoozeOperation" where "requestId"=${input.requestId}`;
    expect(journal?.status).toBe("uncertain");
    await expect(
      fixture.client<
        { id: string; requestId: string }[]
      >`select id, "requestId" from "mailPlacementOperation" order by sequence`
    ).resolves.toStrictEqual(native);
    expect(fixture.state.writes).toBe(writes);
  });

  test.each(["failed", "uncertain"] as const)(
    "a fresh manual return recovers its reserved identity after a prior %s return receipt and an API stop",
    async (priorStatus) => {
      fixture.state.provider = "gmail";
      await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
      fixture.state.messages = [
        {
          id: "already-done",
          internalDate: "1",
          labelIds: [],
          threadId: "conversation",
        },
        {
          id: "sibling",
          internalDate: "2",
          labelIds: ["INBOX"],
          threadId: "conversation",
        },
        {
          id: "anchor",
          internalDate: "3",
          labelIds: ["INBOX"],
          threadId: "conversation",
        },
      ];
      const first = await snooze();
      const id = first.snooze?.id ?? "";
      if (priorStatus === "failed") {
        fixture.state.beforeSnapshot = () => {
          fixture.state.beforeSnapshot = undefined;
          throw new ORPCError("BAD_REQUEST");
        };
      } else {
        fixture.state.ambiguous = true;
      }
      const priorRequestId = randomUUID();
      const prior = await change({
        command: { kind: "return-now" },
        requestId: priorRequestId,
        version: first.snooze?.version ?? -1,
      });
      expect(prior.targets[0]?.snooze?.status).toBe(priorStatus);
      const [priorNative] = await fixture.client<
        { id: string; requestId: string; status: string }[]
      >`select p.id, p."requestId", p.status from "mailPlacementOperation" p join "mailSnooze" s on s."returnOperationId"=p.id where s.id=${id}`;
      expect(priorNative?.status).toBe(priorStatus);
      expect(priorNative?.id).toBeTruthy();
      fixture.state.ambiguous = false;
      for (const message of fixture.state.messages) {
        message.labelIds = [];
      }

      const input = {
        command: { kind: "return-now" },
        requestId: randomUUID(),
        version: prior.targets[0]?.snooze?.version ?? -1,
      } satisfies Parameters<typeof change>[0];
      const stopped = new Error(
        "API stopped after reserving the accepted return."
      );
      fixture.state.afterCommit = async () => {
        const [pending] = await fixture.client<
          { id: string }[]
        >`select id from "mailSnoozeOperation" where "requestId"=${input.requestId} and status='pending'`;
        if (pending === undefined) {
          return;
        }
        fixture.state.afterCommit = undefined;
        throw stopped;
      };
      await expect(change(input)).rejects.toBe(stopped);
      const [reserved] = await fixture.client<
        {
          status: string;
          returnRequestId: string;
          returnOperationId: string;
          hidden: string[];
        }[]
      >`select status, "returnRequestId", "returnOperationId", "hiddenMessageIds" as hidden from "mailSnooze" where id=${id}`;
      expect(reserved).toMatchObject({
        hidden: ["sibling", "anchor"],
        returnOperationId: priorNative?.id,
        status: "returning",
      });
      expect(reserved?.returnRequestId).not.toBe(priorNative?.requestId);
      const [accepted] = await fixture.client<
        { id: string; status: string }[]
      >`select id, status from "mailSnoozeOperation" where "requestId"=${input.requestId}`;
      expect(accepted?.status).toBe("pending");
      fixture.state.messages.push({
        id: "new-reply",
        internalDate: "4",
        labelIds: ["INBOX"],
        threadId: "conversation",
      });
      const { writes } = fixture.state;
      await dispatchMailSnooze({ id, mailboxId: "mailbox" });
      const native = await fixture.client<
        {
          id: string;
          requestId: string;
          status: string;
          messageIds: string[];
        }[]
      >`select id, "requestId", status, "messageIds" from "mailPlacementOperation" where placement='inbox' order by sequence`;
      expect(native).toHaveLength(2);
      expect(
        native.find((operation) => operation.id !== priorNative?.id)
      ).toMatchObject({
        messageIds: ["sibling", "anchor"],
        requestId: reserved?.returnRequestId,
        status: "applied",
      });
      expect(
        native.find((operation) => operation.id === priorNative?.id)
      ).toMatchObject({
        id: priorNative?.id,
        requestId: priorNative?.requestId,
        status: priorStatus,
      });
      expect(fixture.state.writes).toBe(writes + 1);
      expect(
        fixture.state.messages.find((message) => message.id === "already-done")
          ?.labelIds
      ).not.toContain("INBOX");
      for (const messageId of ["sibling", "anchor", "new-reply"]) {
        expect(
          fixture.state.messages.find((message) => message.id === messageId)
            ?.labelIds
        ).toContain("INBOX");
      }
      const replay = await change(input);
      expect(replay.targets[0]).toMatchObject({
        operationId: accepted?.id,
        replayed: true,
        snooze: { status: "returned" },
        status: "applied",
      });
      const [priorJournal] = await fixture.client<
        { status: string }[]
      >`select status from "mailSnoozeOperation" where "requestId"=${priorRequestId}`;
      expect(priorJournal?.status).toBe(priorStatus);
      await expect(
        fixture.client<
          {
            id: string;
            requestId: string;
            status: string;
            messageIds: string[];
          }[]
        >`select id, "requestId", status, "messageIds" from "mailPlacementOperation" where placement='inbox' order by sequence`
      ).resolves.toStrictEqual(native);
      expect(fixture.state.writes).toBe(writes + 1);
    }
  );

  test("source confirmation atomically finalizes a journal before a delayed API outcome", async () => {
    fixture.state.provider = "gmail";
    await fixture.client`update mailbox set provider='gmail' where id='mailbox'`;
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    fixture.state.ambiguous = true;
    const input: MailSnoozeApplyInput = {
      command: {
        kind: "snooze",
        returnAt: new Date(Date.now() + 60_000).toISOString(),
        timeZone: "UTC",
      },
      mailboxId: "mailbox",
      requestId: randomUUID(),
      targets: [
        {
          expectedVersion: null,
          messageIds: ["anchor"],
          threadId: "conversation",
        },
      ],
    };
    const writeStarted = Promise.withResolvers<null>();
    const writeReleased = Promise.withResolvers<null>();
    fixture.state.beforeWriteResponse = async () => {
      fixture.state.beforeWriteResponse = undefined;
      writeStarted.resolve(null);
      await writeReleased.promise;
    };
    const api = applyMailSnooze({ context: { userId: "actor" }, input });
    await writeStarted.promise;
    const [reserved] = await fixture.client<
      { id: string }[]
    >`select id from "mailSnooze"`;
    const id = reserved?.id ?? "";
    const sourceStarted = Promise.withResolvers<null>();
    const sourceReleased = Promise.withResolvers<null>();
    fixture.state.beforeSnapshot = async () => {
      fixture.state.beforeSnapshot = undefined;
      sourceStarted.resolve(null);
      await sourceReleased.promise;
    };
    const failureCommitted = Promise.withResolvers<null>();
    const failureReleased = Promise.withResolvers<null>();
    const confirmationCommitted = Promise.withResolvers<null>();
    const confirmationReleased = Promise.withResolvers<null>();
    let failurePaused = false;
    let confirmationPaused = false;
    fixture.state.afterCommit = async (result) => {
      if (result === undefined && !failurePaused) {
        const [current] = await fixture.client<
          { status: string; token: string | null; nativeStatus: string }[]
        >`select s.status, s."leaseToken" as token, p.status as "nativeStatus" from "mailSnooze" s join "mailPlacementOperation" p on p.id=s."hideOperationId" where s.id=${id}`;
        if (
          current?.status === "preparing" &&
          current.token !== null &&
          current.nativeStatus === "uncertain"
        ) {
          failurePaused = true;
          failureCommitted.resolve(null);
          await failureReleased.promise;
        }
      }
      if (result === true && !confirmationPaused) {
        confirmationPaused = true;
        confirmationCommitted.resolve(null);
        await confirmationReleased.promise;
      }
    };
    const recovery = dispatchMailSnooze({ id, mailboxId: "mailbox" });
    try {
      await vi.waitFor(async () => {
        const [state] = await fixture.client<
          { waiting: boolean }[]
        >`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%for update%') as waiting`;
        expect(state?.waiting).toBeTruthy();
      });
      writeReleased.resolve(null);
      await Promise.all([failureCommitted.promise, sourceStarted.promise]);
      sourceReleased.resolve(null);
      await confirmationCommitted.promise;
      failureReleased.resolve(null);
      const response = await api;
      expect(response.targets[0]).toMatchObject({
        snooze: { status: "active" },
        status: "applied",
      });
    } finally {
      writeReleased.resolve(null);
      sourceReleased.resolve(null);
      failureReleased.resolve(null);
      confirmationReleased.resolve(null);
      await Promise.all([api, recovery]);
    }
    const replay = await applyMailSnooze({
      context: { userId: "actor" },
      input,
    });
    expect(replay.targets[0]).toMatchObject({
      replayed: true,
      snooze: { status: "active" },
      status: "applied",
    });
    expect(fixture.state.writes).toBe(1);
    const identities = await fixture.client<
      { id: string }[]
    >`select id from "mailPlacementOperation"`;
    expect(identities).toHaveLength(1);
  });

  test("a crashed manual recovery retains its explicit authority after predecessor receipts are gone", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    const id = first.snooze?.id ?? "";
    await change({
      command: { kind: "return-now" },
      version: first.snooze?.version ?? -1,
    });
    const [saved] = await fixture.client<
      { requestId: string; version: number }[]
    >`select "returnRequestId" as "requestId", version from "mailSnooze" where id=${id}`;
    await fixture.client`delete from "mailPlacementOperation"`;
    await fixture.client`update "managedMailMessage" set "mailboxState"='done' where id='anchor'`;
    await fixture.client`update "mailSnooze" set status='returning', "nextWakeAt"=now() where id=${id}`;
    await fixture.client`update "mailSnoozeOperation" set status='pending', "resultingVersion"=${saved?.version ?? -1} where kind='return-now'`;
    await seed({ id: "new-reply", receivedAt: 2 });
    await dispatchMailSnooze({ id, mailboxId: "mailbox" });
    const [operation] = await fixture.client<
      { requestId: string; status: string }[]
    >`select "requestId", status from "mailPlacementOperation" where placement='inbox'`;
    expect(operation).toMatchObject({
      requestId: saved?.requestId,
      status: "applied",
    });
    const [message] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='anchor'`;
    expect(message?.state).toBe("active");
    const [reply] = await fixture.client<
      { state: string }[]
    >`select "mailboxState" as state from "managedMailMessage" where id='new-reply'`;
    expect(reply?.state).toBe("active");
  });

  test("stale Inbox projections cannot retire a confirmed hide or a newer schedule", async () => {
    await seed({ id: "anchor" });
    const first = await snooze();
    const version = first.snooze?.version ?? -1;
    const beforeHide = await reconcileMailSnoozeSource({
      expectedVersion: version,
      inboxIncomingMessageIds: ["anchor"],
      mailboxId: "mailbox",
      threadId: "conversation",
    });
    expect(beforeHide?.status).toBe("active");
    const rescheduled = await change({
      command: {
        kind: "reschedule",
        returnAt: new Date(Date.now() + 120_000).toISOString(),
        timeZone: "UTC",
      },
      version,
    });
    await seed({ id: "new-reply", receivedAt: 2 });
    const stale = await reconcileMailSnoozeSource({
      expectedVersion: version,
      inboxIncomingMessageIds: ["new-reply"],
      mailboxId: "mailbox",
      threadId: "conversation",
    });
    expect(stale?.status).toBe("active");
    const current = await reconcileMailSnoozeSource({
      expectedVersion: rescheduled.targets[0]?.snooze?.version ?? -1,
      inboxIncomingMessageIds: ["new-reply"],
      mailboxId: "mailbox",
      threadId: "conversation",
    });
    expect(current?.status).toBe("superseded");
    const rows = await fixture.client<
      { id: string; state: string }[]
    >`select id, "mailboxState" as state from "managedMailMessage"`;
    expect(rows).toContainEqual({ id: "anchor", state: "done" });
    expect(rows).toContainEqual({ id: "new-reply", state: "active" });
  });
});
