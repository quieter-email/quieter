import { describe, expect, test } from "bun:test";
import {
  applyMailboxSwitcherOrder,
  canonicalizeMailboxSwitcherOrder,
  resolveDefaultMailboxId,
  type MailboxGroup,
  type MailboxListItem,
} from "../src/mailbox";

const gmailMailbox = (id: string, emailAddress: string): MailboxListItem => ({
  connectedUserId: "user_1",
  displayName: null,
  emailAddress,
  groupId: "personal",
  groupKind: "personal",
  groupName: "Personal",
  id,
  organizationId: null,
  provider: "gmail",
  providerAccountId: id.replace("gmail:", ""),
});

const managedMailbox = (
  id: string,
  emailAddress: string,
  organizationId: string,
  organizationName: string,
): MailboxListItem => ({
  connectedUserId: null,
  displayName: null,
  emailAddress,
  groupId: organizationId,
  groupKind: "team",
  groupName: organizationName,
  id,
  organizationId,
  provider: "managed",
  providerAccountId: null,
});

const mailboxGroups: MailboxGroup[] = [
  {
    id: "personal",
    kind: "personal",
    mailboxes: [
      gmailMailbox("gmail:one", "one@example.com"),
      gmailMailbox("gmail:two", "two@example.com"),
    ],
    name: "Personal",
    slug: null,
  },
  {
    id: "team_a",
    kind: "team",
    mailboxes: [
      managedMailbox("a1", "a1@example.com", "team_a", "Team A"),
      managedMailbox("a2", "a2@example.com", "team_a", "Team A"),
    ],
    name: "Team A",
    slug: "team-a",
  },
  {
    id: "team_b",
    kind: "team",
    mailboxes: [managedMailbox("b1", "b1@example.com", "team_b", "Team B")],
    name: "Team B",
    slug: "team-b",
  },
];

describe("resolveDefaultMailboxId", () => {
  test("keeps an accessible global default mailbox", () => {
    expect(
      resolveDefaultMailboxId([{ id: "gmail:one" }, { id: "managed_one" }], "managed_one"),
    ).toBe("managed_one");
  });

  test("clears a missing global default mailbox", () => {
    expect(resolveDefaultMailboxId([{ id: "gmail:one" }], "managed_missing")).toBeNull();
  });

  test("keeps a null default mailbox unset", () => {
    expect(resolveDefaultMailboxId([{ id: "gmail:one" }], null)).toBeNull();
  });
});

describe("mailbox switcher order", () => {
  test("reorders groups while preserving group mailbox membership", () => {
    const orderedGroups = applyMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["team_b", "personal", "team_a"],
      mailboxIdsByGroupId: {},
    });

    expect(orderedGroups.map((group) => group.id)).toEqual(["team_b", "personal", "team_a"]);
    expect(orderedGroups[0]?.mailboxes.map((mailbox) => mailbox.id)).toEqual(["b1"]);
    expect(orderedGroups[1]?.mailboxes.map((mailbox) => mailbox.id)).toEqual([
      "gmail:one",
      "gmail:two",
    ]);
  });

  test("reorders mailboxes within one group", () => {
    const orderedGroups = applyMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["personal", "team_a", "team_b"],
      mailboxIdsByGroupId: {
        team_a: ["a2", "a1"],
      },
    });

    expect(
      orderedGroups.find((group) => group.id === "team_a")?.mailboxes.map((mailbox) => mailbox.id),
    ).toEqual(["a2", "a1"]);
  });

  test("drops mailbox ids listed under the wrong group", () => {
    const canonicalOrder = canonicalizeMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["team_a", "team_b", "personal"],
      mailboxIdsByGroupId: {
        team_a: ["b1", "a2"],
        team_b: ["a1", "b1"],
      },
    });

    expect(canonicalOrder.mailboxIdsByGroupId.team_a).toEqual(["a2", "a1"]);
    expect(canonicalOrder.mailboxIdsByGroupId.team_b).toEqual(["b1"]);
  });

  test("appends accessible groups and mailboxes missing from saved order", () => {
    const canonicalOrder = canonicalizeMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["team_a"],
      mailboxIdsByGroupId: {
        team_a: ["a1"],
      },
    });

    expect(canonicalOrder.groupIds).toEqual(["team_a", "personal", "team_b"]);
    expect(canonicalOrder.mailboxIdsByGroupId.team_a).toEqual(["a1", "a2"]);
    expect(canonicalOrder.mailboxIdsByGroupId.personal).toEqual(["gmail:one", "gmail:two"]);
  });
});
