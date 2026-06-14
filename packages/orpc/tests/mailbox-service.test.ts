import { describe, expect, test } from "bun:test";
import {
  applyMailboxSwitcherOrder,
  canonicalizeMailboxSwitcherOrder,
  resolveDefaultMailboxId,
  type MailboxGroup,
  type MailboxListItem,
} from "../src/mailbox";

const gmailMailbox = (id: string, emailAddress: string): MailboxListItem => ({
  connectionStatus: "connected",
  displayName: null,
  emailAddress,
  grantRole: null,
  gmailAutoLabelEnabled: false,
  groupId: "personal",
  groupKind: "personal",
  groupName: "Personal",
  id,
  organizationId: null,
  ownerUserId: "user_1",
  provider: "gmail",
});

const managedMailbox = (
  id: string,
  emailAddress: string,
  organizationId: string,
  organizationName: string,
): MailboxListItem => ({
  connectionStatus: "connected",
  displayName: null,
  emailAddress,
  grantRole: "manager",
  gmailAutoLabelEnabled: false,
  groupId: organizationId,
  groupKind: "organization",
  groupName: organizationName,
  id,
  organizationId,
  ownerUserId: null,
  provider: "managed",
});

const mailboxGroups: MailboxGroup[] = [
  {
    id: "personal",
    kind: "personal",
    mailboxes: [
      gmailMailbox("gmail-one-id", "one@example.com"),
      gmailMailbox("gmail-two-id", "two@example.com"),
    ],
    name: "Personal",
    slug: null,
  },
  {
    id: "org_a",
    kind: "organization",
    mailboxes: [
      managedMailbox("a1", "a1@example.com", "org_a", "Organization A"),
      managedMailbox("a2", "a2@example.com", "org_a", "Organization A"),
    ],
    name: "Organization A",
    slug: "org-a",
  },
  {
    id: "org_b",
    kind: "organization",
    mailboxes: [managedMailbox("b1", "b1@example.com", "org_b", "Organization B")],
    name: "Organization B",
    slug: "org-b",
  },
];

describe("resolveDefaultMailboxId", () => {
  test("keeps an accessible global default mailbox", () => {
    expect(
      resolveDefaultMailboxId([{ id: "gmail-one-id" }, { id: "managed_one" }], "managed_one"),
    ).toBe("managed_one");
  });

  test("clears a missing global default mailbox", () => {
    expect(resolveDefaultMailboxId([{ id: "gmail-one-id" }], "managed_missing")).toBeNull();
  });

  test("keeps a null default mailbox unset", () => {
    expect(resolveDefaultMailboxId([{ id: "gmail-one-id" }], null)).toBeNull();
  });
});

describe("mailbox switcher order", () => {
  test("reorders groups while preserving group mailbox membership", () => {
    const orderedGroups = applyMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["org_b", "personal", "org_a"],
      mailboxIdsByGroupId: {},
    });

    expect(orderedGroups.map((group) => group.id)).toEqual(["org_b", "personal", "org_a"]);
    expect(orderedGroups[0]?.mailboxes.map((mailbox) => mailbox.id)).toEqual(["b1"]);
    expect(orderedGroups[1]?.mailboxes.map((mailbox) => mailbox.id)).toEqual([
      "gmail-one-id",
      "gmail-two-id",
    ]);
  });

  test("reorders mailboxes within one group", () => {
    const orderedGroups = applyMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["personal", "org_a", "org_b"],
      mailboxIdsByGroupId: {
        org_a: ["a2", "a1"],
      },
    });

    expect(
      orderedGroups.find((group) => group.id === "org_a")?.mailboxes.map((mailbox) => mailbox.id),
    ).toEqual(["a2", "a1"]);
  });

  test("drops mailbox ids listed under the wrong group", () => {
    const canonicalOrder = canonicalizeMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["org_a", "org_b", "personal"],
      mailboxIdsByGroupId: {
        org_a: ["b1", "a2"],
        org_b: ["a1", "b1"],
      },
    });

    expect(canonicalOrder.mailboxIdsByGroupId.org_a).toEqual(["a2", "a1"]);
    expect(canonicalOrder.mailboxIdsByGroupId.org_b).toEqual(["b1"]);
  });

  test("appends accessible groups and mailboxes missing from saved order", () => {
    const canonicalOrder = canonicalizeMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["org_a"],
      mailboxIdsByGroupId: {
        org_a: ["a1"],
      },
    });

    expect(canonicalOrder.groupIds).toEqual(["org_a", "personal", "org_b"]);
    expect(canonicalOrder.mailboxIdsByGroupId.org_a).toEqual(["a1", "a2"]);
    expect(canonicalOrder.mailboxIdsByGroupId.personal).toEqual(["gmail-one-id", "gmail-two-id"]);
  });
});
