/* oxlint-disable vitest/prefer-import-in-mock -- Only the authorized boundaries and provider transport are mocked around the real database command. */
import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type { MessageListItem } from "@quieter/mail/messages";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { consumeRateLimit } from "../src/abuse-protection";
import type { MailRequestContext } from "../src/gmail-request";
import { mailInputSchemas } from "../src/mail/inputs";
import {
  applyMailPlacement,
  supersedePendingMailPlacement,
} from "../src/mail/placement";

const fixture = await vi.hoisted(async () => {
  const databaseUrl = process.env.QUIETER_TEST_PLACEMENT_DATABASE_URL;
  if (databaseUrl !== undefined) {
    const url = new URL(databaseUrl);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/placement_fixture"
    ) {
      throw new Error(
        "Placement tests require a loopback placement_fixture database."
      );
    }
  }
  const [{ default: postgres }, { drizzle }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  const client = postgres(
    databaseUrl ?? "postgresql://postgres@127.0.0.1:1/placement_fixture",
    {
      connect_timeout: 3,
      max: 3,
      onnotice: () => {},
    }
  );
  const state: {
    access: boolean;
    ambiguousWrite: boolean;
    beforeAdmission?: () => Promise<void>;
    beforeCount?: () => Promise<void>;
    beforeMetadata?: () => Promise<void>;
    beforeWrite?: () => Promise<void>;
    beforeSnapshot?: () => Promise<void>;
    hydratedMessages: number;
    messages: MessageListItem[];
    provider: "gmail" | "managed";
    providerWrites: number;
    write: boolean;
  } = {
    access: true,
    ambiguousWrite: false,
    hydratedMessages: 0,
    messages: [],
    provider: "managed",
    providerWrites: 0,
    write: true,
  };
  return {
    client,
    database: drizzle({ client }),
    enabled: databaseUrl !== undefined,
    state,
  };
});

vi.mock("@quieter/database/client", () => ({ db: fixture.database }));
vi.mock("@quieter/observability", () => ({ reportError: vi.fn<() => void>() }));
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: async () => {
    if (!fixture.state.access) {
      throw new ORPCError("FORBIDDEN");
    }
    return await Promise.resolve({ provider: fixture.state.provider });
  },
}));
vi.mock("../src/mailbox/access", () => ({
  getAuthorizedManagedMailbox: async () => {
    if (!fixture.state.write) {
      throw new ORPCError("FORBIDDEN");
    }
    return await Promise.resolve({ role: "responder" });
  },
}));
vi.mock("../src/gmail-request", () => ({
  callGmail: async <Result>(
    context: MailRequestContext,
    _mailboxId: string,
    run: (accessToken: string, signal?: AbortSignal) => Promise<Result>
  ) => await run("placement-fixture-token", context.signal),
}));
vi.mock("../src/mail-capture", () => ({
  refreshGmailCapturedMessageMetadata: async () => {},
  writeGmailCapturedMessage: async () => {},
}));
vi.mock("@quieter/gmail", () => ({
  batchModifyMessages: async (
    _accessToken: string,
    messageIds: readonly string[],
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
    signal?: AbortSignal
  ) => {
    await fixture.state.beforeWrite?.();
    signal?.throwIfAborted();
    fixture.state.providerWrites += 1;
    for (const message of fixture.state.messages) {
      if (!messageIds.includes(message.id)) {
        continue;
      }
      const labels = new Set(message.labelIds);
      for (const label of changes.removeLabelIds ?? []) {
        labels.delete(label);
      }
      for (const label of changes.addLabelIds ?? []) {
        labels.add(label);
      }
      message.labelIds = [...labels];
    }
    if (fixture.state.ambiguousWrite) {
      throw new Error("Provider response was lost after accepting the write.");
    }
    await Promise.resolve();
  },
  getGmailCaptureMetadata: async (
    _accessToken: string,
    messageId: string,
    signal?: AbortSignal
  ) => {
    await fixture.state.beforeMetadata?.();
    signal?.throwIfAborted();
    return {
      labelIds:
        fixture.state.messages.find((message) => message.id === messageId)
          ?.labelIds ?? [],
      providerRevision: "1",
    };
  },
  getGmailMessageThreadAssociations: async (
    _accessToken: string,
    messageIds: readonly string[],
    signal?: AbortSignal
  ) => {
    const associations = fixture.state.messages
      .filter((message) => messageIds.includes(message.id))
      .map((message) => ({ id: message.id, threadId: message.threadId }));
    await fixture.state.beforeAdmission?.();
    signal?.throwIfAborted();
    return associations;
  },
  getGmailThreadMessageCount: async (
    _accessToken: string,
    threadId: string,
    signal?: AbortSignal
  ) => {
    const count = fixture.state.messages.filter(
      (message) => message.threadId === threadId
    ).length;
    await fixture.state.beforeCount?.();
    signal?.throwIfAborted();
    return count;
  },
  getThreadWithDetails: async (
    _accessToken: string,
    threadId: string,
    signal?: AbortSignal,
    _onSnapshot?: unknown,
    maxMessages?: number
  ) => {
    const messages = structuredClone(
      fixture.state.messages.filter((message) => message.threadId === threadId)
    );
    if (maxMessages !== undefined && messages.length > maxMessages) {
      throw Object.assign(new Error("Conversation grew before capture."), {
        status: 413,
      });
    }
    fixture.state.hydratedMessages += messages.length;
    await fixture.state.beforeSnapshot?.();
    signal?.throwIfAborted();
    return { messages, threadId };
  },
  isGmailServiceError: (error: unknown) =>
    error instanceof Error && "status" in error,
}));

const seedManaged = async ({
  direction = "inbound",
  id,
  mailboxId = "mailbox",
  sentAt = 1,
  receivedAt = sentAt,
  state = "active",
  threadId = "conversation",
}: {
  direction?: "inbound" | "outbound";
  id: string;
  mailboxId?: string;
  receivedAt?: number;
  sentAt?: number;
  state?: "active" | "done" | "draft" | "spam" | "trash";
  threadId?: string;
}) => {
  await fixture.client`
    insert into "managedMailMessage" (id, "mailboxId", "threadId", direction, "mailboxState", "createdAt", "sentAt", "updatedAt", "bodyText", "isRead")
    values (${id}, ${mailboxId}, ${threadId}, ${direction}, ${state}, ${new Date(receivedAt).toISOString()}, ${new Date(sentAt).toISOString()}, ${new Date(receivedAt).toISOString()}, ${`Original fixture body for ${id}`}, false)
  `;
};

describe("placement command admission", () => {
  test("rejects an oversized placement reference before command admission", () => {
    const result = mailInputSchemas.applyChanges.safeParse({
      command: { kind: "set-placement", placement: "done" },
      mailboxId: "mailbox",
      requestId: randomUUID(),
      targets: [{ messageIds: ["anchor"], threadId: "x".repeat(1024) }],
    });
    expect(result.success).toBeFalsy();
  });
});

describe.skipIf(!fixture.enabled)("durable mail placement commands", () => {
  beforeAll(async () => {
    await fixture.client.unsafe(`
      create table if not exists mailbox (
        id text primary key,
        "contentRevision" bigint not null default 0,
        "updatedAt" timestamptz not null default now()
      );
      create table if not exists "rateLimitBucket" (
        key text primary key,
        count integer not null,
        "windowStart" timestamptz not null,
        "expiresAt" timestamptz not null
      );
      create table if not exists "managedMailMessage" (
        id text primary key,
        "mailboxId" text not null references mailbox(id),
        "threadId" text not null,
        direction text not null,
        "mailboxState" text not null,
        "createdAt" timestamptz not null,
        "sentAt" timestamptz not null,
        "updatedAt" timestamptz not null,
        "bodyText" text not null,
        "isRead" boolean not null
      );
      create table if not exists "mailPlacementOperation" (
        id text primary key,
        sequence bigserial not null unique,
        "actorUserId" text not null,
        "mailboxId" text not null references mailbox(id),
        "requestId" text not null,
        "requestHash" text not null,
        "threadId" text not null,
        "requestedMessageIds" jsonb not null,
        "messageIds" jsonb not null,
        placement text not null check (placement in ('done', 'inbox')),
        status text not null check (status in ('pending', 'submitting', 'applied', 'failed', 'superseded', 'uncertain')),
        code text,
        message text,
        "createdAt" timestamptz not null,
        "updatedAt" timestamptz not null,
        unique ("actorUserId", "mailboxId", "requestId", "threadId")
      );
      create table if not exists "mailSnooze" (
        id text primary key,
        "mailboxId" text not null references mailbox(id) on delete cascade,
        "threadId" text not null,
        "actorUserId" text,
        version integer not null,
        "returnAt" timestamptz not null,
        "timeZone" text not null,
        status text not null,
        "hideRequestId" text not null,
        "returnRequestId" text,
        "hideOperationId" text references "mailPlacementOperation"(id) on delete set null,
        "returnOperationId" text references "mailPlacementOperation"(id) on delete set null,
        "knownIncomingMessageIds" jsonb not null,
        "hiddenMessageIds" jsonb not null,
        "nextWakeAt" timestamptz,
        "leaseToken" text,
        "leaseUntil" timestamptz,
        attempts integer not null default 0,
        code text,
        message text,
        "createdAt" timestamptz not null,
        "updatedAt" timestamptz not null,
        unique ("mailboxId", "threadId")
      );
    `);
  });

  beforeEach(async () => {
    await fixture.client.unsafe(
      'truncate "rateLimitBucket", "mailPlacementOperation", "managedMailMessage", mailbox restart identity cascade'
    );
    await fixture.client`insert into mailbox (id) values ('mailbox'), ('other-mailbox')`;
    fixture.state.access = true;
    fixture.state.write = true;
    fixture.state.provider = "managed";
    fixture.state.messages = [];
    fixture.state.providerWrites = 0;
    fixture.state.ambiguousWrite = false;
    fixture.state.beforeAdmission = undefined;
    fixture.state.beforeCount = undefined;
    fixture.state.beforeMetadata = undefined;
    fixture.state.beforeWrite = undefined;
    fixture.state.beforeSnapshot = undefined;
    fixture.state.hydratedMessages = 0;
  });

  afterAll(async () => {
    await fixture.client.end();
  });

  test("charges weighted costs atomically while keeping the default request cost", async () => {
    const input = { key: randomUUID(), limit: 4, windowMs: 60_000 };
    const initial = await consumeRateLimit({ ...input, cost: 3 });
    expect(initial.allowed).toBeTruthy();
    const competing = await Promise.all([
      consumeRateLimit(input),
      consumeRateLimit(input),
    ]);
    expect(competing.filter((result) => result.allowed)).toHaveLength(1);
    await fixture.client`
      update "rateLimitBucket" set "expiresAt" = now() - interval '1 second'
      where key = ${input.key}
    `;
    const reset = await consumeRateLimit({ ...input, cost: 4 });
    expect(reset.allowed).toBeTruthy();
    const exhausted = await consumeRateLimit(input);
    expect(exhausted.allowed).toBeFalsy();
  });

  test.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid server-derived budget cost %s",
    async (cost) => {
      await expect(
        consumeRateLimit({
          cost,
          key: randomUUID(),
          limit: 4,
          windowMs: 60_000,
        })
      ).rejects.toBeInstanceOf(RangeError);
      const buckets = await fixture.client`select key from "rateLimitBucket"`;
      expect(buckets).toHaveLength(0);
    }
  );

  test.each(["gmail", "managed"] as const)(
    "rejects unknown and mismatched %s anchors without retaining target receipts",
    async (provider) => {
      fixture.state.provider = provider;
      fixture.state.messages = [
        { id: "anchor", labelIds: ["INBOX"], threadId: "conversation" },
      ];
      await seedManaged({ id: "anchor" });
      await seedManaged({ id: "foreign", mailboxId: "other-mailbox" });
      const result = await applyMailPlacement({
        context: { userId: "actor" },
        input: {
          command: { kind: "set-placement", placement: "done" },
          mailboxId: "mailbox",
          requestId: randomUUID(),
          targets: [
            { messageIds: ["missing"], threadId: "missing-conversation" },
            { messageIds: ["anchor"], threadId: "wrong-conversation" },
            { messageIds: ["foreign"], threadId: "foreign-conversation" },
          ],
        },
      });
      expect(
        result.targets.every((target) => target.status === "failed")
      ).toBeTruthy();
      const receipts =
        await fixture.client`select id from "mailPlacementOperation"`;
      expect(receipts).toHaveLength(0);
      expect(fixture.state.providerWrites).toBe(0);
      const messages = await fixture.client<
        { mailboxState: string }[]
      >`select "mailboxState" from "managedMailMessage"`;
      expect(
        messages.every((message) => message.mailboxState === "active")
      ).toBeTruthy();
    }
  );

  test("denies new targets across mailboxes after the actor budget is exhausted but still replays accepted identities", async () => {
    await seedManaged({ id: "anchor" });
    await seedManaged({
      id: "second",
      mailboxId: "other-mailbox",
      threadId: "second-conversation",
    });
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    await applyMailPlacement(request);
    await fixture.client`update "rateLimitBucket" set count = 2147483647`;
    await expect(
      applyMailPlacement({
        ...request,
        input: {
          ...request.input,
          mailboxId: "other-mailbox",
          requestId: randomUUID(),
          targets: [
            { messageIds: ["second"], threadId: "second-conversation" },
          ],
        },
      })
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      data: { provider: "server" },
      status: 429,
    });
    const replay = await applyMailPlacement(request);
    expect(replay.targets).toContainEqual(
      expect.objectContaining({ replayed: true, status: "applied" })
    );
    const receipts =
      await fixture.client`select id from "mailPlacementOperation"`;
    expect(receipts).toHaveLength(1);
    const [untouched] = await fixture.client<
      { mailboxState: string }[]
    >`select "mailboxState" from "managedMailMessage" where id = 'second'`;
    expect(untouched?.mailboxState).toBe("active");
  });

  test("does not accept a native target when canonical admission fails", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      { id: "anchor", labelIds: ["INBOX"], threadId: "conversation" },
    ];
    fixture.state.beforeAdmission = async () => {
      await Promise.resolve();
      throw new Error("The canonical source could not be loaded.");
    };
    await expect(
      applyMailPlacement({
        context: { userId: "actor" },
        input: {
          command: { kind: "set-placement", placement: "done" },
          mailboxId: "mailbox",
          requestId: randomUUID(),
          targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
        },
      })
    ).rejects.toBeInstanceOf(Error);
    const receipts =
      await fixture.client`select id from "mailPlacementOperation"`;
    expect(receipts).toHaveLength(0);
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
    expect(fixture.state.providerWrites).toBe(0);
  });

  test("dispatches one native effect for concurrent copies of an accepted request", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    const responses = await Promise.all([
      applyMailPlacement(request),
      applyMailPlacement(request),
    ]);
    expect(
      responses.some((response) =>
        response.targets.some((target) => target.replayed === true)
      )
    ).toBeTruthy();
    expect(fixture.state.providerWrites).toBe(1);
    expect(fixture.state.messages[0]?.labelIds).not.toContain("INBOX");
    const receipts =
      await fixture.client`select id from "mailPlacementOperation"`;
    expect(receipts).toHaveLength(1);
  });

  test("rejects a large managed prefix without changing its source rows", async () => {
    await fixture.client`
      insert into "managedMailMessage" (id, "mailboxId", "threadId", direction, "mailboxState", "createdAt", "sentAt", "updatedAt", "bodyText", "isRead")
      select concat('long-', ordinal), 'mailbox', 'conversation', 'inbound', 'active',
        timestamp '2020-01-01' + ordinal * interval '1 millisecond',
        timestamp '2020-01-01' + ordinal * interval '1 millisecond', now(), 'Retained fixture body', false
      from generate_series(1, 1500) as ordinal
    `;
    const result = await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["long-1500"], threadId: "conversation" }],
      },
    });
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "BAD_REQUEST", status: "failed" })
    );
    const handled = await fixture.client`
      select id from "managedMailMessage" where "mailboxState" = 'done'
    `;
    expect(handled).toHaveLength(0);
  });

  test("bounds aggregate Gmail history before hydrating later bulk targets", async () => {
    fixture.state.provider = "gmail";
    const targets = Array.from({ length: 50 }, (_, thread) => ({
      messageIds: [`thread-${thread}-message-99`],
      threadId: `thread-${thread}`,
    }));
    fixture.state.messages = targets.flatMap((target) =>
      Array.from({ length: 100 }, (_, ordinal) => ({
        id: `${target.threadId}-message-${ordinal}`,
        internalDate: String(ordinal + 1),
        labelIds: ["INBOX"],
        threadId: target.threadId,
      }))
    );
    const result = await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets,
      },
    });
    expect(
      result.targets.some((target) => target.status === "applied")
    ).toBeTruthy();
    expect(
      result.targets.some((target) => target.status === "failed")
    ).toBeTruthy();
    const handled = fixture.state.messages.filter(
      (message) => message.labelIds?.includes("INBOX") !== true
    );
    expect(handled.length).toBeGreaterThan(0);
    expect(handled.length).toBeLessThan(fixture.state.messages.length);
    expect(fixture.state.hydratedMessages).toBe(handled.length);
  });

  test("charges expanded native work before hydration or mutation", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "older",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
      {
        id: "anchor",
        internalDate: "2",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    fixture.state.beforeCount = async () => {
      fixture.state.beforeCount = undefined;
      await fixture.client`update "rateLimitBucket" set count = 2147483647`;
    };
    const result = await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    });
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "RATE_LIMITED", status: "failed" })
    );
    expect(fixture.state.hydratedMessages).toBe(0);
    expect(fixture.state.providerWrites).toBe(0);
    expect(
      fixture.state.messages.every(
        (message) => message.labelIds?.includes("INBOX") === true
      )
    ).toBeTruthy();
  });

  test("does not hydrate a native thread that grows after its work was admitted", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    fixture.state.beforeCount = async () => {
      fixture.state.beforeCount = undefined;
      fixture.state.messages.push({
        id: "new-reply",
        internalDate: "2",
        labelIds: ["INBOX"],
        threadId: "conversation",
      });
      await Promise.resolve();
    };
    const result = await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    });
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "BAD_REQUEST", status: "failed" })
    );
    expect(fixture.state.hydratedMessages).toBe(0);
    expect(fixture.state.providerWrites).toBe(0);
  });

  test("cancels native eligibility work without submitting a placement effect", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const controller = new AbortController();
    fixture.state.beforeMetadata = async () => {
      controller.abort();
      await Promise.resolve();
    };
    const result = await applyMailPlacement({
      context: { signal: controller.signal, userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    });
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "placement_failed", status: "failed" })
    );
    expect(fixture.state.providerWrites).toBe(0);
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
    const [receipt] = await fixture.client<{ status: string }[]>`
      select status from "mailPlacementOperation"
    `;
    expect(receipt?.status).toBe("failed");
  });

  test("keeps an interrupted native dispatch uncertain without replaying it", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const controller = new AbortController();
    fixture.state.beforeWrite = async () => {
      controller.abort();
      await Promise.resolve();
    };
    const request = {
      context: { signal: controller.signal, userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    const result = await applyMailPlacement(request);
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "placement_uncertain", status: "failed" })
    );
    const replay = await applyMailPlacement({
      ...request,
      context: { userId: "actor" },
    });
    expect(replay.targets).toContainEqual(
      expect.objectContaining({ code: "placement_uncertain", replayed: true })
    );
    expect(fixture.state.providerWrites).toBe(0);
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
  });

  test("allows a newer intent while an older eligibility read is outstanding", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const metadataStarted = Promise.withResolvers<null>();
    const releaseMetadata = Promise.withResolvers<null>();
    fixture.state.beforeMetadata = async () => {
      fixture.state.beforeMetadata = undefined;
      metadataStarted.resolve(null);
      await releaseMetadata.promise;
    };
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    const older = applyMailPlacement(request);
    await metadataStarted.promise;
    try {
      await applyMailPlacement({
        ...request,
        input: {
          ...request.input,
          command: { kind: "set-placement", placement: "inbox" },
          requestId: randomUUID(),
        },
      });
    } finally {
      releaseMetadata.resolve(null);
    }
    const result = await older;
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "newer_intent", status: "failed" })
    );
    expect(fixture.state.providerWrites).toBe(0);
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
  });

  test("handles incoming history through its anchor, preserves native metadata and leaves a newer reply in Inbox", async () => {
    await seedManaged({ id: "older-incoming" });
    await seedManaged({ direction: "outbound", id: "sent-reply", sentAt: 2 });
    await seedManaged({ id: "trash", sentAt: 3, state: "trash" });
    await seedManaged({ id: "anchor", sentAt: 4 });
    await seedManaged({ id: "new-reply", receivedAt: 5, sentAt: 0 });
    const result = await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    });
    expect(result.targets).toContainEqual(
      expect.objectContaining({
        messageIds: ["older-incoming", "anchor"],
        status: "applied",
      })
    );
    const messages = await fixture.client<
      { bodyText: string; id: string; isRead: boolean; mailboxState: string }[]
    >`
      select id, "mailboxState", "bodyText", "isRead" from "managedMailMessage" order by "sentAt"
    `;
    expect(messages).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "older-incoming", mailboxState: "done" }),
        expect.objectContaining({ id: "sent-reply", mailboxState: "active" }),
        expect.objectContaining({ id: "trash", mailboxState: "trash" }),
        expect.objectContaining({ id: "new-reply", mailboxState: "active" }),
      ])
    );
    expect(
      messages.every(
        (message) =>
          message.bodyText.includes("Original fixture body") && !message.isRead
      )
    ).toBeTruthy();
  });

  test("replays an earlier Done receipt without overriding a later return or handling newly received mail", async () => {
    await seedManaged({ id: "anchor" });
    const done = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    await applyMailPlacement(done);
    await applyMailPlacement({
      ...done,
      input: {
        ...done.input,
        command: { kind: "set-placement", placement: "inbox" },
        requestId: randomUUID(),
      },
    });
    await seedManaged({ id: "new-reply", sentAt: 2 });
    const replay = await applyMailPlacement(done);
    expect(replay.targets).toContainEqual(
      expect.objectContaining({ replayed: true, status: "applied" })
    );
    const active = await fixture.client<
      { id: string }[]
    >`select id from "managedMailMessage" where "mailboxState" = 'active'`;
    expect(active.map((message) => message.id)).toStrictEqual(
      expect.arrayContaining(["anchor", "new-reply"])
    );
  });

  test("rejects changed payloads and added targets under an existing request identity without adding receipts", async () => {
    await seedManaged({ id: "anchor" });
    await seedManaged({ id: "second", threadId: "second-conversation" });
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    await applyMailPlacement(request);
    await expect(
      applyMailPlacement({
        ...request,
        input: {
          ...request.input,
          command: { kind: "set-placement", placement: "inbox" },
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      applyMailPlacement({
        ...request,
        input: {
          ...request.input,
          targets: [
            ...request.input.targets,
            { messageIds: ["second"], threadId: "second-conversation" },
          ],
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const operations = await fixture.client<
      { threadId: string }[]
    >`select "threadId" from "mailPlacementOperation"`;
    expect(operations.map((operation) => operation.threadId)).toStrictEqual([
      "conversation",
    ]);
    const [untouched] = await fixture.client<
      { mailboxState: string }[]
    >`select "mailboxState" from "managedMailMessage" where id = 'second'`;
    expect(untouched?.mailboxState).toBe("active");
  });

  test("rechecks managed write permission before replay and isolates canonical targets to their mailbox", async () => {
    await seedManaged({ id: "anchor" });
    await seedManaged({ id: "foreign", mailboxId: "other-mailbox" });
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    await applyMailPlacement(request);
    fixture.state.write = false;
    await expect(applyMailPlacement(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    fixture.state.write = true;
    const foreign = await applyMailPlacement({
      ...request,
      input: {
        ...request.input,
        requestId: randomUUID(),
        targets: [{ messageIds: ["foreign"], threadId: "conversation" }],
      },
    });
    expect(foreign.targets).toContainEqual(
      expect.objectContaining({ status: "failed" })
    );
    const [message] = await fixture.client<
      { mailboxState: string }[]
    >`select "mailboxState" from "managedMailMessage" where id = 'foreign'`;
    expect(message?.mailboxState).toBe("active");
  });

  test("reports each bulk target independently when one conversation is unavailable", async () => {
    await seedManaged({ id: "anchor" });
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [
          { messageIds: ["anchor"], threadId: "conversation" },
          { messageIds: ["missing"], threadId: "missing-conversation" },
        ],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    const result = await applyMailPlacement(request);
    expect(result.targets).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "applied",
          threadId: "conversation",
        }),
        expect.objectContaining({
          status: "failed",
          threadId: "missing-conversation",
        }),
      ])
    );
    const [handled] = await fixture.client<
      { mailboxState: string }[]
    >`select "mailboxState" from "managedMailMessage" where id = 'anchor'`;
    expect(handled?.mailboxState).toBe("done");
    await seedManaged({ id: "missing", threadId: "missing-conversation" });
    const replay = await applyMailPlacement(request);
    expect(replay.targets).toContainEqual(
      expect.objectContaining({
        replayed: true,
        status: "failed",
        threadId: "missing-conversation",
      })
    );
    const [stillActive] = await fixture.client<
      { mailboxState: string }[]
    >`select "mailboxState" from "managedMailMessage" where id = 'missing'`;
    expect(stillActive?.mailboxState).toBe("active");
    const receipts =
      await fixture.client`select id from "mailPlacementOperation"`;
    expect(receipts).toHaveLength(1);
    await expect(
      applyMailPlacement({
        ...request,
        input: {
          ...request.input,
          targets: request.input.targets.map((target) => ({
            ...target,
            messageIds:
              target.threadId === "missing-conversation"
                ? ["another-missing-message"]
                : target.messageIds,
          })),
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("does not return mail after a newer native action moved it to Spam", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: [],
        threadId: "conversation",
      },
    ];
    fixture.state.beforeSnapshot = async () => {
      fixture.state.beforeSnapshot = undefined;
      fixture.state.messages[0]?.labelIds?.push("SPAM");
      await Promise.resolve();
    };
    const result = await applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "inbox" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    });
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "CONFLICT", status: "failed" })
    );
    expect(fixture.state.messages[0]?.labelIds).toContain("SPAM");
    expect(fixture.state.providerWrites).toBe(0);
  });

  test("never redispatches an ambiguous Gmail write and permits a fresh explicit recovery", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        bodyText: "Original Gmail fixture body",
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX", "UNREAD", "custom-label"],
        threadId: "conversation",
      },
    ];
    fixture.state.ambiguousWrite = true;
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    const uncertain = await applyMailPlacement(request);
    expect(uncertain.targets).toContainEqual(
      expect.objectContaining({ code: "placement_uncertain", status: "failed" })
    );
    expect(fixture.state.messages[0]?.labelIds).not.toContain("INBOX");
    const acceptedWrites = fixture.state.providerWrites;
    const replay = await applyMailPlacement(request);
    expect(replay.targets).toContainEqual(
      expect.objectContaining({ code: "placement_uncertain", replayed: true })
    );
    expect(fixture.state.providerWrites).toBe(acceptedWrites);
    fixture.state.ambiguousWrite = false;
    await applyMailPlacement({
      ...request,
      input: {
        ...request.input,
        command: { kind: "set-placement", placement: "inbox" },
        requestId: randomUUID(),
      },
    });
    expect(fixture.state.messages[0]?.bodyText).toContain(
      "Original Gmail fixture body"
    );
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
    expect(fixture.state.messages[0]?.labelIds).toContain("UNREAD");
    expect(fixture.state.messages[0]?.labelIds).toContain("custom-label");
  });

  test("supersedes an older accepted intent while its provider snapshot is still outstanding", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const snapshotStarted = Promise.withResolvers<null>();
    const releaseSnapshot = Promise.withResolvers<null>();
    fixture.state.beforeSnapshot = async () => {
      fixture.state.beforeSnapshot = undefined;
      snapshotStarted.resolve(null);
      await releaseSnapshot.promise;
    };
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    const older = applyMailPlacement(request);
    await snapshotStarted.promise;
    await applyMailPlacement({
      ...request,
      input: {
        ...request.input,
        command: { kind: "set-placement", placement: "inbox" },
        requestId: randomUUID(),
      },
    });
    releaseSnapshot.resolve(null);
    const result = await older;
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "newer_intent", status: "failed" })
    );
    expect(fixture.state.messages[0]?.labelIds).toContain("INBOX");
    expect(fixture.state.providerWrites).toBe(0);
  });

  test("fences a pending conversation action before a legacy placement write", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const snapshotStarted = Promise.withResolvers<null>();
    const releaseSnapshot = Promise.withResolvers<null>();
    fixture.state.beforeSnapshot = async () => {
      fixture.state.beforeSnapshot = undefined;
      snapshotStarted.resolve(null);
      await releaseSnapshot.promise;
    };
    const request = {
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    } satisfies Parameters<typeof applyMailPlacement>[0];
    const pending = applyMailPlacement(request);
    await snapshotStarted.promise;
    await supersedePendingMailPlacement({
      context: request.context,
      mailboxId: "mailbox",
      threadIds: ["conversation"],
    });
    fixture.state.messages[0]?.labelIds?.push("TRASH");
    releaseSnapshot.resolve(null);
    const result = await pending;
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "newer_intent", status: "failed" })
    );
    expect(fixture.state.messages[0]?.labelIds).toContain("TRASH");
    expect(fixture.state.providerWrites).toBe(0);
  });

  test("orders a legacy placement after an in-flight canonical admission", async () => {
    fixture.state.provider = "gmail";
    fixture.state.messages = [
      {
        id: "anchor",
        internalDate: "1",
        labelIds: ["INBOX"],
        threadId: "conversation",
      },
    ];
    const admissionStarted = Promise.withResolvers<null>();
    const releaseAdmission = Promise.withResolvers<null>();
    const legacyFinished = Promise.withResolvers<null>();
    fixture.state.beforeAdmission = async () => {
      fixture.state.beforeAdmission = undefined;
      admissionStarted.resolve(null);
      await releaseAdmission.promise;
    };
    fixture.state.beforeSnapshot = async () => {
      fixture.state.beforeSnapshot = undefined;
      await legacyFinished.promise;
    };
    const pending = applyMailPlacement({
      context: { userId: "actor" },
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: "mailbox",
        requestId: randomUUID(),
        targets: [{ messageIds: ["anchor"], threadId: "conversation" }],
      },
    });
    await admissionStarted.promise;
    const legacy = supersedePendingMailPlacement({
      context: { userId: "actor" },
      mailboxId: "mailbox",
      threadIds: ["conversation"],
    }).then(() => {
      fixture.state.messages[0]?.labelIds?.push("TRASH");
      legacyFinished.resolve(null);
    });
    try {
      await vi.waitFor(async () => {
        const [lock] = await fixture.client<{ waiting: boolean }[]>`
          select exists (
            select 1 from pg_stat_activity
            where datname = current_database()
              and wait_event_type = 'Lock'
              and query like '%mailbox%'
          ) as waiting
        `;
        expect(lock?.waiting).toBeTruthy();
      });
    } finally {
      releaseAdmission.resolve(null);
    }
    try {
      await legacy;
    } finally {
      legacyFinished.resolve(null);
    }
    const result = await pending;
    expect(result.targets).toContainEqual(
      expect.objectContaining({ code: "newer_intent", status: "failed" })
    );
    expect(fixture.state.messages[0]?.labelIds).toContain("TRASH");
    expect(fixture.state.providerWrites).toBe(0);
  });
});
