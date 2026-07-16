import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { describe, expect, test } from "vite-plus/test";
import type { MailboxGroup, MailboxListItem } from "../src/mailbox/types";
import {
  applyMailboxSwitcherOrder,
  canonicalizeMailboxSwitcherOrder,
  resolveDefaultMailboxId,
} from "../src/mailbox/preferences";

const gmailMailbox = (id: string, emailAddress: string): MailboxListItem => ({
  capabilities: getMailboxCapabilities({ provider: "gmail", role: null }),
  connectionStatus: "connected",
  directGrantRole: null,
  displayName: null,
  divisionGrantRoles: [],
  divisionId: null,
  divisionName: null,
  emailAddress,
  grantRole: null,
  autoLabelEnabled: false,
  usefulDetailsEnabled: false,
  groupId: "org_default",
  groupKind: "organization",
  groupName: "Default Team",
  id,
  includeApiSentMessages: false,
  organizationId: "org_default",
  ownerUserId: "user_1",
  provider: "gmail",
  unreadNonSpamCount: 0,
});

const managedMailbox = (
  id: string,
  emailAddress: string,
  organizationId: string,
  organizationName: string,
): MailboxListItem => ({
  capabilities: getMailboxCapabilities({ provider: "managed", role: "manager" }),
  connectionStatus: "connected",
  directGrantRole: "manager",
  displayName: null,
  divisionGrantRoles: [],
  divisionId: organizationId,
  divisionName: organizationName,
  emailAddress,
  grantRole: "manager",
  autoLabelEnabled: false,
  usefulDetailsEnabled: false,
  groupId: organizationId,
  groupKind: "division",
  groupName: organizationName,
  id,
  includeApiSentMessages: false,
  organizationId,
  ownerUserId: null,
  provider: "managed",
  unreadNonSpamCount: 0,
});

const mailboxGroups: MailboxGroup[] = [
  {
    id: "org_default",
    kind: "organization",
    mailboxes: [
      gmailMailbox("gmail-one-id", "one@example.com"),
      gmailMailbox("gmail-two-id", "two@example.com"),
    ],
    name: "Default Team",
    organizationId: "org_default",
    slug: "default-team",
  },
  {
    id: "org_a",
    kind: "division",
    mailboxes: [
      managedMailbox("a1", "a1@example.com", "org_a", "Organization A"),
      managedMailbox("a2", "a2@example.com", "org_a", "Organization A"),
    ],
    name: "Organization A",
    organizationId: "org_a",
    slug: "org-a",
  },
  {
    id: "org_b",
    kind: "division",
    mailboxes: [managedMailbox("b1", "b1@example.com", "org_b", "Organization B")],
    name: "Organization B",
    organizationId: "org_b",
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
      groupIds: ["org_b", "org_default", "org_a"],
      mailboxIdsByGroupId: {},
    });

    expect(orderedGroups.map((group) => group.id)).toEqual(["org_b", "org_default", "org_a"]);
    expect(orderedGroups[0]?.mailboxes.map((mailbox) => mailbox.id)).toEqual(["b1"]);
    expect(orderedGroups[1]?.mailboxes.map((mailbox) => mailbox.id)).toEqual([
      "gmail-one-id",
      "gmail-two-id",
    ]);
  });

  test("reorders mailboxes within one group", () => {
    const orderedGroups = applyMailboxSwitcherOrder(mailboxGroups, {
      groupIds: ["org_default", "org_a", "org_b"],
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
      groupIds: ["org_a", "org_b", "org_default"],
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

    expect(canonicalOrder.groupIds).toEqual(["org_a", "org_default", "org_b"]);
    expect(canonicalOrder.mailboxIdsByGroupId.org_a).toEqual(["a1", "a2"]);
    expect(canonicalOrder.mailboxIdsByGroupId.org_default).toEqual([
      "gmail-one-id",
      "gmail-two-id",
    ]);
  });
});
