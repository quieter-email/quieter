import { ORPCError } from "@orpc/server";
import type { MailboxSavedViewDefinition } from "@quieter/mail/mailbox-organization";
import { describe, expect, test } from "vite-plus/test";

import {
  assertSavedViewDefinitionSupported,
  assertSavedViewRowAccess,
  resolveSavedViewOwnerUserId,
} from "../src/saved-views/service";
import type { SavedViewMailboxContext } from "../src/saved-views/service";

const gmailContext = (): SavedViewMailboxContext => ({
  provider: "gmail",
  role: null,
});
const managedContext = (
  role: "manager" | "reader" | "responder"
): SavedViewMailboxContext => ({
  provider: "managed",
  role,
});

const createDefinitionWithFilters = (
  filters: MailboxSavedViewDefinition["search"]["filters"]
): MailboxSavedViewDefinition => ({
  color: null,
  icon: null,
  name: "Support queue",
  search: { filters, text: "" },
  sort: "newest",
});

describe("saved view ownership policy", () => {
  test("keeps Gmail views private and rejects sharing", () => {
    expect(
      resolveSavedViewOwnerUserId({
        context: gmailContext(),
        shared: false,
        userId: "user-1",
      })
    ).toBe("user-1");
    expect(() =>
      resolveSavedViewOwnerUserId({
        context: gmailContext(),
        shared: true,
        userId: "user-1",
      })
    ).toThrow(ORPCError);
  });

  test("requires the manager role to share a managed mailbox view", () => {
    expect(
      resolveSavedViewOwnerUserId({
        context: managedContext("manager"),
        shared: true,
        userId: "user-1",
      })
    ).toBeNull();
    expect(
      resolveSavedViewOwnerUserId({
        context: managedContext("manager"),
        shared: false,
        userId: "user-1",
      })
    ).toBe("user-1");
    for (const role of ["reader", "responder"] as const) {
      expect(() =>
        resolveSavedViewOwnerUserId({
          context: managedContext(role),
          shared: true,
          userId: "user-1",
        })
      ).toThrow(/manager access is required/iu);
    }
  });

  test("rejects rows that belong to another user", () => {
    expect(() => {
      assertSavedViewRowAccess({
        context: gmailContext(),
        userId: "user-1",
        viewOwnerUserId: "user-2",
      });
    }).toThrow(/belongs to another user/iu);
    expect(() => {
      assertSavedViewRowAccess({
        context: managedContext("reader"),
        userId: "user-2",
        viewOwnerUserId: "user-2",
      });
    }).not.toThrow();
    expect(() => {
      assertSavedViewRowAccess({
        context: managedContext("reader"),
        userId: "user-2",
        viewOwnerUserId: null,
      });
    }).toThrow(/manager access is required/iu);
    expect(() => {
      assertSavedViewRowAccess({
        context: managedContext("manager"),
        userId: "user-1",
        viewOwnerUserId: null,
      });
    }).not.toThrow();
  });
});

describe("saved view provider filter support", () => {
  test("accepts Gmail-supported search filters", () => {
    expect(() => {
      assertSavedViewDefinitionSupported({
        definition: createDefinitionWithFilters([
          { type: "from", value: "billing@example.com" },
          { type: "is", value: "unread" },
          { type: "label", value: "Support" },
          { negated: true, type: "has", value: "attachment" },
        ]),
        provider: "gmail",
      });
    }).not.toThrow();
  });

  test("rejects Gmail-unsupported search filters", () => {
    for (const unsupportedFilter of [
      { type: "subject", value: "invoice" },
      { type: "content", value: "invoice totals" },
      { type: "header", value: "list-unsubscribe" },
      { type: "is", value: "sent" },
    ] as const) {
      expect(() => {
        assertSavedViewDefinitionSupported({
          definition: createDefinitionWithFilters([unsupportedFilter]),
          provider: "gmail",
        });
      }).toThrow(/unavailable for this mailbox/iu);
    }
  });

  test("keeps every structured filter available for managed mailboxes", () => {
    expect(() => {
      assertSavedViewDefinitionSupported({
        definition: createDefinitionWithFilters([
          { type: "subject", value: "invoice" },
          { type: "content", value: "invoice totals" },
          { type: "is", value: "outbound" },
        ]),
        provider: "managed",
      });
    }).not.toThrow();
  });
});
