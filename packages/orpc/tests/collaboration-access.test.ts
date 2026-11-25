import type { MailboxGrantRole } from "@quieter/database/schema";
import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, test } from "vite-plus/test";

import { authorizeCollaborationThread } from "../src/mailbox/collaboration/access";

type MailboxFixture = {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  provider: "gmail" | "managed";
};
type MembershipFixture = { id: string; organizationId: string; userId: string };
type DirectGrantFixture = {
  mailboxId: string;
  memberId: string;
  role: MailboxGrantRole;
  userId: string;
};
type CollaborationFixtures = {
  direct: Map<string, DirectGrantFixture>;
  divisionMembers: Set<string>;
  divisionRole: MailboxGrantRole | null;
  mailboxes: Map<string, MailboxFixture>;
  members: Map<string, MembershipFixture>;
  threads: Set<string>;
};

const scope = {
  mailboxId: "shared-box",
  threadId: "thread-1",
  userId: "actor",
};
const fixtures: CollaborationFixtures = {
  direct: new Map(),
  divisionMembers: new Set<string>(),
  divisionRole: null,
  mailboxes: new Map(),
  members: new Map(),
  threads: new Set<string>(),
};

// oxlint-disable-next-line eslint/require-await -- Drizzle's remote callback requires a promise.
const database = drizzle(async (query: string, parameters: unknown[]) => {
  const mailboxParameter = /"mailbox"\."id" = \$(?<index>\d+)/u.exec(query)
    ?.groups?.index;
  const requestedMailbox = mailboxParameter
    ? parameters[Number(mailboxParameter) - 1]
    : undefined;
  const userParameter = /"member"\."userId" = \$(?<index>\d+)/u.exec(query)
    ?.groups?.index;
  const requestedUser = userParameter
    ? parameters[Number(userParameter) - 1]
    : undefined;
  const selected =
    typeof requestedMailbox === "string"
      ? fixtures.mailboxes.get(requestedMailbox)
      : undefined;
  const membership =
    typeof requestedUser === "string"
      ? fixtures.members.get(requestedUser)
      : undefined;
  const hasMembership =
    selected !== undefined &&
    membership !== undefined &&
    membership.organizationId === selected.organizationId;
  let role: MailboxGrantRole | null = null;
  if (query.includes('from "mailboxGrant"')) {
    const grant = fixtures.direct.get(String(requestedUser));
    if (
      hasMembership &&
      grant?.memberId === membership.id &&
      grant.userId === membership.userId &&
      grant.mailboxId === selected.id
    ) {
      ({ role } = grant);
    }
  } else if (query.includes('from "mailboxDivisionGrant"')) {
    if (
      hasMembership &&
      selected.ownerUserId === null &&
      fixtures.divisionMembers.has(membership.id)
    ) {
      role = fixtures.divisionRole;
    }
  } else if (query.includes('from "mailbox"')) {
    if (
      hasMembership &&
      selected.provider === "managed" &&
      selected.ownerUserId === requestedUser
    ) {
      return {
        rows: [
          [
            "1",
            "Mailbox",
            "mailbox@example.test",
            selected.id,
            selected.organizationId,
            selected.ownerUserId,
            selected.provider,
          ],
        ],
      };
    }
    return { rows: [] };
  } else if (query.includes('from "managedMailMessage"')) {
    const mailboxIndex =
      /"managedMailMessage"\."mailboxId" = \$(?<index>\d+)/u.exec(query)?.groups
        ?.index;
    const threadIndex =
      /"managedMailMessage"\."threadId" = \$(?<index>\d+)/u.exec(query)?.groups
        ?.index;
    const key = JSON.stringify([
      mailboxIndex ? parameters[Number(mailboxIndex) - 1] : null,
      threadIndex ? parameters[Number(threadIndex) - 1] : null,
    ]);
    return {
      rows: fixtures.threads.has(key) ? [["source-message"]] : [],
    };
  } else {
    throw new Error(`Unexpected collaboration fixture query: ${query}`);
  }
  return {
    rows:
      selected?.provider === "managed" && role !== null
        ? [
            [
              "1",
              "Mailbox",
              "mailbox@example.test",
              selected.id,
              selected.organizationId,
              selected.ownerUserId,
              selected.provider,
              role,
            ],
          ]
        : [],
  };
});

describe("shared conversation authorization", () => {
  beforeEach(() => {
    fixtures.direct.clear();
    fixtures.divisionMembers.clear();
    fixtures.divisionRole = null;
    fixtures.mailboxes.clear();
    fixtures.mailboxes.set(scope.mailboxId, {
      id: scope.mailboxId,
      organizationId: "team",
      ownerUserId: null,
      provider: "managed",
    });
    fixtures.members.clear();
    fixtures.members.set(scope.userId, {
      id: "membership-1",
      organizationId: "team",
      userId: scope.userId,
    });
    fixtures.direct.set(scope.userId, {
      mailboxId: scope.mailboxId,
      memberId: "membership-1",
      role: "responder",
      userId: scope.userId,
    });
    fixtures.threads.clear();
    fixtures.threads.add(JSON.stringify([scope.mailboxId, scope.threadId]));
  });

  test("uses the current strongest direct or division role on every read", async () => {
    fixtures.divisionRole = "manager";
    fixtures.divisionMembers.add("membership-1");
    await expect(
      authorizeCollaborationThread(scope, database)
    ).resolves.toMatchObject({ role: "manager" });
    fixtures.divisionMembers.clear();
    await expect(
      authorizeCollaborationThread(scope, database)
    ).resolves.toMatchObject({ role: "responder" });
    fixtures.direct.set(scope.userId, {
      mailboxId: scope.mailboxId,
      memberId: "membership-1",
      role: "reader",
      userId: scope.userId,
    });
    await expect(
      authorizeCollaborationThread(scope, database)
    ).resolves.toMatchObject({ role: "reader" });
  });

  test("a reused session loses access after direct or division revocation", async () => {
    await authorizeCollaborationThread(scope, database);
    fixtures.direct.clear();
    await expect(
      authorizeCollaborationThread(scope, database)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    fixtures.divisionRole = "responder";
    fixtures.divisionMembers.add("membership-1");
    await authorizeCollaborationThread(scope, database);
    fixtures.divisionRole = null;
    await expect(
      authorizeCollaborationThread(scope, database)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    fixtures.divisionRole = "responder";
    await authorizeCollaborationThread(scope, database);
    fixtures.divisionMembers.clear();
    await expect(
      authorizeCollaborationThread(scope, database)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("departure and rejoin do not revive an old membership grant", async () => {
    fixtures.members.delete(scope.userId);
    await expect(
      authorizeCollaborationThread(scope, database)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    fixtures.members.set(scope.userId, {
      id: "membership-2",
      organizationId: "team",
      userId: scope.userId,
    });
    await expect(
      authorizeCollaborationThread(scope, database)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test.each(["gmail", "managed"] satisfies MailboxFixture["provider"][])(
    "refuses a private %s mailbox even when the actor owns it",
    async (provider) => {
      fixtures.mailboxes.set(scope.mailboxId, {
        id: scope.mailboxId,
        organizationId: "team",
        ownerUserId: scope.userId,
        provider,
      });
      await expect(
        authorizeCollaborationThread(scope, database)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  );

  test("refuses a private managed direct grantee who is not its owner", async () => {
    fixtures.mailboxes.set(scope.mailboxId, {
      id: scope.mailboxId,
      organizationId: "team",
      ownerUserId: "another-user",
      provider: "managed",
    });
    await expect(
      authorizeCollaborationThread(scope, database)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("refuses missing and cross-mailbox thread identities", async () => {
    fixtures.threads.clear();
    fixtures.threads.add(JSON.stringify(["other-box", scope.threadId]));
    await expect(
      authorizeCollaborationThread(scope, database)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      authorizeCollaborationThread(
        { ...scope, mailboxId: "other-box" },
        database
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
