import { randomUUID } from "node:crypto";

import { db, withRequestDatabaseClient } from "@quieter/database/client";
import {
  mailbox,
  member,
  organization,
  outlookCredential,
  outlookFolder,
  outlookMessageFolder,
  outlookReadCursor,
  outlookSyncState,
  user,
} from "@quieter/database/schema";
import { requireServerEnv } from "@quieter/env/server";
import type { OutlookFolder } from "@quieter/outlook/graph";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { encryptGmailCredentialSecret } from "../src/gmail-credential-crypto";
import { runAuthorizedOutlookMailbox } from "../src/outlook/auth";
import { loadOutlookCapturedMessages } from "../src/outlook/capture";
import { listOwnedOutlookMailboxState } from "../src/outlook/mailbox-state";
import { createOutlookProjection } from "../src/outlook/projection";
import {
  getOutlookMessageInspector,
  getOutlookThread,
} from "../src/outlook/queries";
import { disconnectOutlookMailbox } from "../src/outlook/service";
import {
  cacheOutlookMessage,
  claimOutlookDiscovery,
  claimOutlookMessageSlice,
  commitOutlookDiscovery,
  commitOutlookMessagePage,
  createOutlookReadCursor,
  getOutlookCachedMessage,
  getOutlookCachedThread,
  readOutlookCacheRevision,
  readOutlookFolders,
  readOutlookReadCursor,
  readOutlookSyncState,
  releaseOutlookDiscovery,
  releaseOutlookMessageSlice,
  reconcileOutlookThreadMembership,
} from "../src/outlook/storage";
import type { OutlookCacheScope } from "../src/outlook/storage";

const fixtureId = randomUUID();
const ownerId = `native214-owner-${fixtureId}`;
const memberId = `native214-member-${fixtureId}`;
const organizationId = `native214-team-${fixtureId}`;
const ownedMailboxIds = new Set<string>();
const systemFolders = {
  archive: "native-archive",
  drafts: "native-drafts",
  inbox: "native-inbox",
  sent: "native-sent",
  spam: "native-spam",
  trash: "native-trash",
};

const projection = (input?: {
  changeKey?: string;
  folderId?: string;
  id?: string;
  subject?: string;
  threadId?: string;
}) =>
  createOutlookProjection({
    attachments: [
      {
        "@odata.type": "#microsoft.graph.referenceAttachment",
        contentType: "text/plain",
        id: "native-reference",
        isInline: false,
        name: "Synthetic reference",
        size: 31,
      },
    ],
    kind: "full",
    message: {
      body: { content: "Synthetic private body", contentType: "text" },
      categories: ["Synthetic category"],
      changeKey: input?.changeKey ?? "opaque:revision/one+",
      conversationId: input?.threadId ?? "same-provider-thread",
      from: {
        emailAddress: { address: "sender@example.invalid", name: "Sender" },
      },
      hasAttachments: true,
      id: input?.id ?? "same-provider-message",
      importance: "high",
      internetMessageHeaders: [
        { name: "In-Reply-To", value: "<synthetic@example.invalid>" },
      ],
      internetMessageId: "<native214@example.invalid>",
      isDraft: false,
      isRead: false,
      parentFolderId: input?.folderId ?? systemFolders.inbox,
      receivedDateTime: "2026-11-16T01:02:03Z",
      replyTo: [{ emailAddress: { address: "reply@example.invalid" } }],
      subject: input?.subject ?? "Synthetic private mail",
      toRecipients: [
        { emailAddress: { address: "recipient@example.invalid" } },
      ],
      webLink: "https://outlook.example.invalid/synthetic",
    },
  });

const createMailbox = async (): Promise<OutlookCacheScope> => {
  const id = `native214-mailbox-${randomUUID()}`;
  ownedMailboxIds.add(id);
  const now = new Date();
  await db.transaction(async (database) => {
    await database.insert(mailbox).values({
      accessMode: "private",
      createdAt: now,
      emailAddress: `${id}@example.invalid`,
      id,
      organizationId,
      ownerUserId: ownerId,
      provider: "outlook",
      status: "connected",
      updatedAt: now,
    });
    await database.insert(outlookCredential).values({
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: now,
      encryptedAccessToken: encryptGmailCredentialSecret(
        "synthetic-native-access",
        {
          legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
        }
      ),
      generation: 0,
      graphAccountId: id,
      issuer: "https://login.microsoftonline.com/native-tenant/v2.0",
      mailboxId: id,
      ownerUserId: ownerId,
      scopes: "openid profile offline_access User.Read Mail.Read",
      status: "connected",
      subject: id,
      updatedAt: now,
    });
  });
  return { generation: 0, mailboxId: id, userId: ownerId };
};

const discoverFolders = async (
  scope: OutlookCacheScope,
  extraFolders: OutlookFolder[] = []
) => {
  const lease = await claimOutlookDiscovery({ scope, systemFolders });
  if (lease === null) {
    throw new Error("Native folder discovery could not claim a fresh mailbox.");
  }
  await commitOutlookDiscovery({
    lease,
    page: {
      values: [
        ...Object.values(systemFolders).map((id) => ({
          childFolderCount: 0,
          displayName: id,
          id,
          totalItemCount: 0,
          unreadItemCount: 0,
        })),
        ...extraFolders,
      ],
    },
  });
};

const hydrateMailbox = async (scope: OutlookCacheScope) => {
  await discoverFolders(scope);
  for (const folderId of Object.values(systemFolders)) {
    const lease = await claimOutlookMessageSlice({ scope });
    if (lease === null) {
      throw new Error(`Native hydration stopped before ${folderId}.`);
    }
    await commitOutlookMessagePage({
      changes: [],
      continuation: {
        kind: "delta",
        url: `https://graph.microsoft.com/v1.0/me/mailFolders/${lease.folderId}/messages/delta?$deltatoken=synthetic`,
      },
      lease,
    });
  }
};

const makeInboxDue = async (scope: OutlookCacheScope) => {
  await db
    .update(outlookFolder)
    .set({ lastCompletedAt: new Date(0) })
    .where(
      and(
        eq(outlookFolder.mailboxId, scope.mailboxId),
        eq(outlookFolder.folderId, systemFolders.inbox)
      )
    );
  const lease = await claimOutlookMessageSlice({ scope });
  if (lease === null || lease.folderId !== systemFolders.inbox) {
    throw new Error("Native fixture did not claim its due inbox.");
  }
  return lease;
};

beforeAll(async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Native storage proof forbids external transport.");
  });
  await withRequestDatabaseClient(async (database) => {
    if (database.$client.options.max !== 1) {
      throw new Error(
        "Native Outlook proof requires the real local pool of one."
      );
    }
    const [target] = await database.$client<
      { name: string }[]
    >`select current_database() as name`;
    const expected = new URL(requireServerEnv("DATABASE_URL")).pathname.slice(
      1
    );
    if (
      target?.name !== expected ||
      !/^quieter_outlook_native_214_[a-f0-9]{12}$/u.test(expected)
    ) {
      throw new Error(
        "The actual database differs from the allocated disposable fixture."
      );
    }
    await database
      .select({ mailboxId: outlookCredential.mailboxId })
      .from(outlookCredential)
      .limit(1);
    const now = new Date();
    await database.insert(user).values([
      {
        createdAt: now,
        email: `${ownerId}@example.invalid`,
        emailVerified: true,
        id: ownerId,
        name: "Synthetic owner",
        updatedAt: now,
      },
      {
        createdAt: now,
        email: `${memberId}@example.invalid`,
        emailVerified: true,
        id: memberId,
        name: "Synthetic teammate",
        updatedAt: now,
      },
    ]);
    await database.insert(organization).values({
      createdAt: now,
      id: organizationId,
      name: "Native synthetic team",
      slug: organizationId,
      updatedAt: now,
    });
    await database.insert(member).values([
      {
        createdAt: now,
        id: randomUUID(),
        organizationId,
        role: "owner",
        userId: ownerId,
      },
      {
        createdAt: now,
        id: randomUUID(),
        organizationId,
        role: "member",
        userId: memberId,
      },
    ]);
    await database
      .update(organization)
      .set({ billingOwnerUserId: ownerId })
      .where(eq(organization.id, organizationId));
  });
});

afterEach(async () => {
  if (ownedMailboxIds.size === 0) {
    return;
  }
  await db.transaction(async (database) => {
    await database.execute(
      sql`select set_config('quieter.action_protocol', 'personal-actions-v1', true)`
    );
    await database
      .delete(mailbox)
      .where(
        and(
          eq(mailbox.ownerUserId, ownerId),
          inArray(mailbox.id, [...ownedMailboxIds])
        )
      );
  });
  ownedMailboxIds.clear();
});

afterAll(async () => {
  try {
    await db.transaction(async (database) => {
      await database.execute(
        sql`select set_config('quieter.action_protocol', 'personal-actions-v1', true)`
      );
      await database
        .delete(organization)
        .where(eq(organization.id, organizationId));
      await database.delete(user).where(inArray(user.id, [ownerId, memberId]));
    });
  } finally {
    await withRequestDatabaseClient(async (database) => {
      await database.$client.end({ timeout: 3 });
    });
    vi.unstubAllGlobals();
  }
});

describe("native Outlook storage and current authorization", () => {
  it("prunes an absent member of a nonempty authoritative thread from reads and capture", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const first = projection({ id: "retired-member" });
    const kept = projection({ id: "current-member" });
    for (const value of [first, kept]) {
      const revision = await readOutlookCacheRevision(scope);
      await cacheOutlookMessage({
        expectedChangeKey: null,
        expectedContentRevision: revision,
        projection: value,
        scope,
      });
    }
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (resource, options) => {
        const request = new Request(resource, options);
        await request.arrayBuffer();
        const url = new URL(request.url);
        if (url.origin !== "https://graph.microsoft.com") {
          throw new Error("Unexpected native transport host.");
        }
        if (url.pathname === "/v1.0/me/messages") {
          return Response.json({ value: [kept.message] });
        }
        if (
          url.pathname === `/v1.0/me/messages/${kept.message.id}/attachments`
        ) {
          return Response.json({ value: kept.attachments });
        }
        if (url.pathname === `/v1.0/me/messages/${kept.message.id}`) {
          return Response.json(kept.message);
        }
        throw new Error("Unexpected native thread request.");
      });
    try {
      await getOutlookThread({
        ...scope,
        threadId: kept.message.conversationId,
      });
    } finally {
      transport.mockRestore();
    }
    const thread = await getOutlookCachedThread(
      scope,
      kept.message.conversationId
    );
    expect(thread.map((value) => value.message.id)).toStrictEqual([
      kept.message.id,
    ]);
    const captures = await loadOutlookCapturedMessages({
      database: db,
      mailboxId: scope.mailboxId,
      threadIds: [kept.message.conversationId],
    });
    expect(captures.map((value) => value.snapshot.id)).toStrictEqual([
      kept.message.id,
    ]);
  });

  it("returns unread counts with their actual incomplete and completed coverage", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const first = projection({
      id: "first-unread",
      threadId: "first-unread-thread",
    });
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: first,
      scope,
    });
    const lease = await makeInboxDue(scope);
    const second = projection({
      id: "second-unread",
      threadId: "second-unread-thread",
    });
    await commitOutlookMessagePage({
      changes: [{ kind: "message", projection: second }],
      continuation: {
        kind: "next",
        url: `https://graph.microsoft.com/v1.0/me/mailFolders/${systemFolders.inbox}/messages/delta?$skiptoken=synthetic`,
      },
      lease,
    });
    const pending = await listOwnedOutlookMailboxState(scope.userId);
    expect(pending.find((value) => value.id === scope.mailboxId)).toMatchObject(
      { unreadCountCoverage: { complete: false }, unreadNonSpamCount: 2 }
    );
    const next = await claimOutlookMessageSlice({ scope });
    if (next === null) {
      throw new Error("Missing actual pending-page lease.");
    }
    await commitOutlookMessagePage({
      changes: [],
      continuation: {
        kind: "delta",
        url: `https://graph.microsoft.com/v1.0/me/mailFolders/${systemFolders.inbox}/messages/delta?$deltatoken=synthetic`,
      },
      lease: next,
    });
    const complete = await listOwnedOutlookMailboxState(scope.userId);
    expect(
      complete.find((value) => value.id === scope.mailboxId)
    ).toMatchObject({
      unreadCountCoverage: { complete: true },
      unreadNonSpamCount: 2,
    });
    expect(await listOwnedOutlookMailboxState(memberId)).toHaveLength(0);
  });

  it("refuses to cache a body whose upstream revision changed while attachments loaded", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const first = projection();
    let messageReads = 0;
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (resource, options) => {
        const request = new Request(resource, options);
        await request.arrayBuffer();
        const url = new URL(request.url);
        if (url.origin !== "https://graph.microsoft.com") {
          throw new Error("Unexpected native transport host.");
        }
        if (url.pathname.endsWith("/attachments")) {
          return Response.json({ value: first.attachments });
        }
        if (url.pathname === `/v1.0/me/messages/${first.message.id}`) {
          messageReads += 1;
          return Response.json(
            messageReads === 1
              ? first.message
              : { ...first.message, changeKey: "upstream-opaque-new" }
          );
        }
        throw new Error("Unexpected native message request.");
      });
    try {
      await expect(
        getOutlookMessageInspector({ ...scope, messageId: first.message.id })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await getOutlookCachedMessage(scope, first.message.id)).toBeNull();
    } finally {
      transport.mockRestore();
    }
  });

  it("isolates identical provider identities by mailbox and denies a teammate", async () => {
    const first = await createMailbox();
    const second = await createMailbox();
    await hydrateMailbox(first);
    await hydrateMailbox(second);
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(first),
      projection: projection({ subject: "Mailbox one" }),
      scope: first,
    });
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(second),
      projection: projection({ subject: "Mailbox two" }),
      scope: second,
    });
    expect(
      await getOutlookCachedMessage(first, "same-provider-message")
    ).toMatchObject({
      attachments: [{ "@odata.type": "#microsoft.graph.referenceAttachment" }],
      message: { subject: "Mailbox one" },
    });
    expect(
      await getOutlookCachedThread(second, "same-provider-thread")
    ).toMatchObject([
      {
        message: {
          categories: ["Synthetic category"],
          replyTo: [{ emailAddress: { address: "reply@example.invalid" } }],
          subject: "Mailbox two",
        },
      },
    ]);
    const teammate = { ...first, userId: memberId };
    await expect(
      getOutlookCachedMessage(teammate, "same-provider-message")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      cacheOutlookMessage({
        expectedChangeKey: null,
        expectedContentRevision: 0,
        projection: projection(),
        scope: teammate,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runAuthorizedOutlookMailbox(
        teammate,
        async () => await readOutlookCacheRevision(teammate)
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("checks current team membership with the actual authorization API", async () => {
    const scope = await createMailbox();
    await expect(
      runAuthorizedOutlookMailbox(
        scope,
        async () => await readOutlookCacheRevision(scope)
      )
    ).resolves.toBeGreaterThanOrEqual(0);
    await db
      .update(member)
      .set({ role: "owner" })
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, memberId)
        )
      );
    await db
      .update(organization)
      .set({ billingOwnerUserId: memberId })
      .where(eq(organization.id, organizationId));
    await db
      .delete(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, ownerId)
        )
      );
    try {
      await expect(
        runAuthorizedOutlookMailbox(
          scope,
          async () => await readOutlookCacheRevision(scope)
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await db.insert(member).values({
        createdAt: new Date(),
        id: randomUUID(),
        organizationId,
        role: "owner",
        userId: ownerId,
      });
      await db
        .update(organization)
        .set({ billingOwnerUserId: ownerId })
        .where(eq(organization.id, organizationId));
      await db
        .update(member)
        .set({ role: "member" })
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, memberId)
          )
        );
    }
  });

  it("serializes competing real claims and rejects old, forged and expired leases", async () => {
    const scope = await createMailbox();
    const [first, competing] = await Promise.all([
      claimOutlookDiscovery({ scope, systemFolders }),
      claimOutlookDiscovery({ scope, systemFolders }),
    ]);
    const lease = first ?? competing;
    if (lease === null) {
      throw new Error("Neither native discovery claim acquired ownership.");
    }
    expect([first, competing].filter((value) => value !== null)).toHaveLength(
      1
    );
    await expect(
      commitOutlookDiscovery({
        lease: { ...lease, leaseId: randomUUID() },
        page: { values: [] },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db
      .update(outlookSyncState)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(outlookSyncState.mailboxId, scope.mailboxId));
    const replacement = await claimOutlookDiscovery({ scope });
    if (replacement === null) {
      throw new Error("Expired real discovery lease was not recoverable.");
    }
    await expect(
      commitOutlookDiscovery({ lease, page: { values: [] } })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await releaseOutlookDiscovery({ lease: replacement, resetCursor: true });
    await expect(
      commitOutlookDiscovery({ lease: replacement, page: { values: [] } })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await discoverFolders(scope);
    const messageLease = await claimOutlookMessageSlice({ scope });
    if (messageLease === null) {
      throw new Error("Native message lease was not created.");
    }
    await db
      .update(outlookCredential)
      .set({ generation: 1 })
      .where(eq(outlookCredential.mailboxId, scope.mailboxId));
    await expect(
      commitOutlookMessagePage({
        changes: [],
        continuation: {
          kind: "delta",
          url: "https://graph.microsoft.com/native",
        },
        lease: messageLease,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readOutlookCacheRevision(scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a delayed fetch after a committed membership tombstone", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const original = projection();
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: original,
      scope,
    });
    const fetchRevision = await readOutlookCacheRevision(scope);
    const lease = await makeInboxDue(scope);
    await commitOutlookMessagePage({
      changes: [{ kind: "removed", messageId: original.message.id }],
      continuation: {
        kind: "delta",
        url: "https://graph.microsoft.com/native-tombstone",
      },
      lease,
    });
    expect(
      await cacheOutlookMessage({
        expectedChangeKey: original.message.changeKey,
        expectedContentRevision: fetchRevision,
        projection: original,
        scope,
      })
    ).toMatchObject({ cached: false });
    expect(
      await getOutlookCachedThread(scope, original.message.conversationId)
    ).toHaveLength(0);
    expect(
      await getOutlookCachedMessage(scope, original.message.id)
    ).toMatchObject({ message: { changeKey: original.message.changeKey } });
  });

  it("uses opaque change keys and fetch revisions without ordering provider versions", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const first = projection({ changeKey: "z/opaque+first" });
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: first,
      scope,
    });
    const fetchedAt = await readOutlookCacheRevision(scope);
    const second = projection({
      changeKey: "a/opaque+second",
      subject: "Current revision",
    });
    await cacheOutlookMessage({
      expectedChangeKey: first.message.changeKey,
      expectedContentRevision: fetchedAt,
      projection: second,
      scope,
    });
    const currentRevision = await readOutlookCacheRevision(scope);
    expect(
      await cacheOutlookMessage({
        expectedChangeKey: first.message.changeKey,
        expectedContentRevision: currentRevision,
        projection: first,
        scope,
      })
    ).toMatchObject({ cached: false });
    expect(
      await reconcileOutlookThreadMembership({
        expectedContentRevision: fetchedAt,
        messageIds: [],
        scope,
        threadId: first.message.conversationId,
      })
    ).toBe(false);
    expect(
      await getOutlookCachedThread(scope, first.message.conversationId)
    ).toMatchObject([{ message: { subject: "Current revision" } }]);
    expect(
      await reconcileOutlookThreadMembership({
        expectedContentRevision: currentRevision,
        messageIds: [],
        scope,
        threadId: first.message.conversationId,
      })
    ).toBe(true);
    expect(
      await getOutlookCachedThread(scope, first.message.conversationId)
    ).toHaveLength(0);
  });

  it("updates current parent membership and preserves canonical optional metadata", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const first = projection();
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: first,
      scope,
    });
    const moved = projection({
      changeKey: "opaque:moved",
      folderId: systemFolders.archive,
    });
    await cacheOutlookMessage({
      expectedChangeKey: first.message.changeKey,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: moved,
      scope,
    });
    const memberships = await db
      .select({ folderId: outlookMessageFolder.folderId })
      .from(outlookMessageFolder)
      .where(eq(outlookMessageFolder.mailboxId, scope.mailboxId));
    expect(memberships).toEqual([{ folderId: systemFolders.archive }]);
    expect(
      await getOutlookCachedThread(scope, first.message.conversationId)
    ).toMatchObject([
      {
        attachments: [{ id: "native-reference" }],
        message: {
          internetMessageHeaders: [{ name: "In-Reply-To" }],
          internetMessageId: "<native214@example.invalid>",
          parentFolderId: systemFolders.archive,
        },
      },
    ]);
  });

  it("keeps unseen messages until a full reconciliation round actually completes", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const first = projection();
    const unseen = projection({ id: "unseen-message" });
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: first,
      scope,
    });
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: unseen,
      scope,
    });
    const initial = await makeInboxDue(scope);
    await releaseOutlookMessageSlice({ lease: initial, resetCursor: true });
    const pageOne = await claimOutlookMessageSlice({ scope });
    if (pageOne === null) {
      throw new Error("Native full-round reconciliation was not claimable.");
    }
    await commitOutlookMessagePage({
      changes: [{ kind: "message", projection: first }],
      continuation: {
        kind: "next",
        url: "https://graph.microsoft.com/native-next",
      },
      lease: pageOne,
    });
    expect(
      await getOutlookCachedThread(scope, first.message.conversationId)
    ).toHaveLength(2);
    const finalPage = await claimOutlookMessageSlice({ scope });
    if (finalPage === null) {
      throw new Error("Native full-round continuation was not claimable.");
    }
    await commitOutlookMessagePage({
      changes: [],
      continuation: {
        kind: "delta",
        url: "https://graph.microsoft.com/native-final",
      },
      lease: finalPage,
    });
    expect(
      await getOutlookCachedThread(scope, first.message.conversationId)
    ).toMatchObject([{ message: { id: first.message.id } }]);
    await expect(
      commitOutlookMessagePage({
        changes: [{ kind: "message", projection: unseen }],
        continuation: {
          kind: "delta",
          url: "https://graph.microsoft.com/native-replay",
        },
        lease: finalPage,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("advances revisions for coverage transitions while empty replay stays idempotent", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const before = await readOutlookCacheRevision(scope);
    const unchanged = await makeInboxDue(scope);
    await commitOutlookMessagePage({
      changes: [],
      continuation: {
        kind: "delta",
        url: "https://graph.microsoft.com/native-empty",
      },
      lease: unchanged,
    });
    expect(await readOutlookCacheRevision(scope)).toBe(before);
    const partial = await makeInboxDue(scope);
    await commitOutlookMessagePage({
      changes: [],
      continuation: {
        kind: "next",
        url: "https://graph.microsoft.com/native-partial",
      },
      lease: partial,
    });
    const incomplete = await readOutlookCacheRevision(scope);
    expect(incomplete).toBeGreaterThan(before);
    const incompleteFolders = await readOutlookFolders(scope);
    expect(
      incompleteFolders.find(
        (folder) => folder.folderId === systemFolders.inbox
      )
    ).toMatchObject({ hasPendingPage: true });
    const completed = await claimOutlookMessageSlice({ scope });
    if (completed === null) {
      throw new Error("Native incomplete coverage had no continuation.");
    }
    await commitOutlookMessagePage({
      changes: [],
      continuation: {
        kind: "delta",
        url: "https://graph.microsoft.com/native-complete",
      },
      lease: completed,
    });
    expect(await readOutlookCacheRevision(scope)).toBeGreaterThan(incomplete);
    const completedFolders = await readOutlookFolders(scope);
    expect(
      completedFolders.find((folder) => folder.folderId === systemFolders.inbox)
    ).toMatchObject({ hasPendingPage: false, state: "ready" });
  });

  it("retires folders and their memberships only after the complete discovered tree", async () => {
    const scope = await createMailbox();
    await discoverFolders(scope, [
      {
        childFolderCount: 1,
        displayName: "Synthetic parent",
        id: "parent",
        totalItemCount: 0,
        unreadItemCount: 0,
      },
    ]);
    const childLease = await claimOutlookDiscovery({ scope });
    if (childLease === null || childLease.activeParentFolderId !== "parent") {
      throw new Error("Native discovery did not traverse the queued parent.");
    }
    await commitOutlookDiscovery({
      lease: childLease,
      page: {
        values: [
          {
            childFolderCount: 0,
            displayName: "Synthetic child",
            id: "child",
            parentFolderId: "parent",
            totalItemCount: 1,
            unreadItemCount: 1,
          },
        ],
      },
    });
    const childMessage = projection({ folderId: "child" });
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: await readOutlookCacheRevision(scope),
      projection: childMessage,
      scope,
    });
    await db
      .update(outlookSyncState)
      .set({ folderDiscoveryCompletedAt: new Date(0) })
      .where(eq(outlookSyncState.mailboxId, scope.mailboxId));
    const rootPage = await claimOutlookDiscovery({ scope, systemFolders });
    if (rootPage === null) {
      throw new Error("Native rediscovery was not due.");
    }
    await commitOutlookDiscovery({
      lease: rootPage,
      page: {
        nextPageUrl: "https://graph.microsoft.com/native-folder-next",
        values: Object.values(systemFolders).map((id) => ({
          childFolderCount: 0,
          displayName: id,
          id,
          totalItemCount: 0,
          unreadItemCount: 0,
        })),
      },
    });
    expect(await readOutlookSyncState(scope)).toMatchObject({
      state: "discovering",
    });
    const partialFolders = await readOutlookFolders(scope);
    expect(partialFolders.map((folder) => folder.folderId)).toContain("child");
    const finalPage = await claimOutlookDiscovery({ scope });
    if (finalPage === null) {
      throw new Error("Native folder continuation was not claimable.");
    }
    await commitOutlookDiscovery({ lease: finalPage, page: { values: [] } });
    expect(await readOutlookSyncState(scope)).toMatchObject({ state: "ready" });
    const retiredFolders = await readOutlookFolders(scope);
    expect(retiredFolders.map((folder) => folder.folderId)).not.toContain(
      "child"
    );
    expect(
      await getOutlookCachedThread(scope, childMessage.message.conversationId)
    ).toHaveLength(0);
  });

  it("rejects incomplete discovery metadata without committing coverage", async () => {
    const scope = await createMailbox();
    const lease = await claimOutlookDiscovery({ scope, systemFolders });
    if (lease === null) {
      throw new Error(
        "Native incomplete-metadata case could not claim discovery."
      );
    }
    const revision = await readOutlookCacheRevision(scope);
    await expect(
      commitOutlookDiscovery({
        lease,
        page: {
          values: [{ displayName: "Sparse folder", id: systemFolders.inbox }],
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await readOutlookCacheRevision(scope)).toBe(revision);
    expect(await readOutlookFolders(scope)).toHaveLength(0);
    expect(await readOutlookSyncState(scope)).toMatchObject({
      discoveryCompletedAt: null,
      state: "discovering",
    });
  });

  it("binds encrypted cursors to owner, mailbox, query, generation and expiry", async () => {
    const scope = await createMailbox();
    const other = await createMailbox();
    const state = { continuation: "synthetic-private-page-token", offset: 2 };
    const id = await createOutlookReadCursor({
      expiresAt: new Date(Date.now() + 60_000),
      queryHash: "query-one",
      scope,
      state,
    });
    expect(
      await readOutlookReadCursor({ id, queryHash: "query-one", scope })
    ).toMatchObject(state);
    const [stored] = await db
      .select({ encryptedState: outlookReadCursor.encryptedState })
      .from(outlookReadCursor)
      .where(eq(outlookReadCursor.id, id));
    expect(stored?.encryptedState).not.toContain(state.continuation);
    await expect(
      readOutlookReadCursor({ id, queryHash: "query-two", scope })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      readOutlookReadCursor({ id, queryHash: "query-one", scope: other })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      readOutlookReadCursor({
        id,
        queryHash: "query-one",
        scope: { ...scope, userId: memberId },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db
      .update(outlookCredential)
      .set({ generation: 1 })
      .where(eq(outlookCredential.mailboxId, scope.mailboxId));
    await expect(
      readOutlookReadCursor({
        id,
        queryHash: "query-one",
        scope: { ...scope, generation: 1 },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const expiring = await createOutlookReadCursor({
      expiresAt: new Date(Date.now() + 60_000),
      queryHash: "query-one",
      scope: other,
      state,
    });
    await db
      .update(outlookReadCursor)
      .set({ expiresAt: new Date(0) })
      .where(eq(outlookReadCursor.id, expiring));
    await expect(
      readOutlookReadCursor({
        id: expiring,
        queryHash: "query-one",
        scope: other,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("completes parallel real auth and cache transactions on the bounded pool of one", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const identities = await withRequestDatabaseClient(
      async () =>
        await Promise.all([
          runAuthorizedOutlookMailbox(scope, async (_context, identity) => ({
            mailboxId: identity.mailboxId,
            revision: await readOutlookCacheRevision(scope),
          })),
          runAuthorizedOutlookMailbox(scope, async (_context, identity) => ({
            mailboxId: identity.mailboxId,
            revision: await readOutlookCacheRevision(scope),
          })),
          runAuthorizedOutlookMailbox(scope, async (_context, identity) => ({
            mailboxId: identity.mailboxId,
            revision: await readOutlookCacheRevision(scope),
          })),
        ])
    );
    expect(identities.map((identity) => identity.mailboxId)).toEqual([
      scope.mailboxId,
      scope.mailboxId,
      scope.mailboxId,
    ]);
    expect(identities.every((identity) => identity.revision > 0)).toBe(true);
  });

  it("rejects delayed authorized results after actual receipt-first disconnect", async () => {
    const scope = await createMailbox();
    await hydrateMailbox(scope);
    const ready = Promise.withResolvers<boolean>();
    const finish = Promise.withResolvers<boolean>();
    const operation = runAuthorizedOutlookMailbox(scope, async () => {
      ready.resolve(true);
      await finish.promise;
      return "synthetic fetched content";
    });
    const rejected = expect(operation).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await ready.promise;
    try {
      await disconnectOutlookMailbox({
        mailboxId: scope.mailboxId,
        userId: scope.userId,
      });
    } finally {
      finish.resolve(true);
    }
    await rejected;
    expect(
      await db
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(eq(mailbox.id, scope.mailboxId))
    ).toHaveLength(0);
    expect(
      await db
        .select({ mailboxId: outlookCredential.mailboxId })
        .from(outlookCredential)
        .where(eq(outlookCredential.mailboxId, scope.mailboxId))
    ).toHaveLength(0);
  });
});
