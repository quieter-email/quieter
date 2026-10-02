import { describe, expect, test } from "vite-plus/test";

import { matchSettingsEntries } from "./settings-search";

const match = (query: string, includeDevelopment = false) =>
  matchSettingsEntries(query, { includeDevelopment }).map((entry) => entry.tab);

describe("settings search", () => {
  test("returns nothing until something is typed", () => {
    expect(match("")).toStrictEqual([]);
    expect(match("   ")).toStrictEqual([]);
  });

  test("ranks a title match above a keyword match", () => {
    // "Reading" is a title; "reading" is not a keyword anywhere else.
    expect(match("reading")[0]).toBe("reading");
    // "Account" is a title, and also a keyword under Mailboxes.
    expect(match("account")[0]).toBe("account");
  });

  test("finds a destination by what a user would call it", () => {
    expect(match("dark mode")).toStrictEqual(["appearance"]);
    expect(match("hotkeys")).toStrictEqual(["shortcuts"]);
    expect(
      matchSettingsEntries("billing", { includeDevelopment: false })[0]
        ?.organizationView
    ).toBe("billing");
    expect(match("signature")).toStrictEqual(["mailboxes"]);
  });

  test("is case and whitespace insensitive", () => {
    expect(match("  DARK MODE ")).toStrictEqual(["appearance"]);
  });

  test("hides development unless it is available", () => {
    expect(match("demo mode")).toStrictEqual([]);
    expect(match("demo mode", true)).toStrictEqual(["development"]);
  });

  test("returns nothing for a query that matches no setting", () => {
    expect(match("qwertyuiop")).toStrictEqual([]);
  });

  test("tolerates typos and matches multiple words in any order", () => {
    expect(match("signatuer")).toStrictEqual(["mailboxes"]);
    expect(match("images external")).toContain("reading");
    expect(
      matchSettingsEntries("invite teammate", { includeDevelopment: false })[0]
        ?.organizationView
    ).toBe("members");
  });

  test("retains exact mailbox and team destinations supplied by the accessible index", () => {
    const results = matchSettingsEntries("support signature", {
      entries: [
        {
          description: "Acme / Support",
          id: "signature-support",
          keywords: "footer",
          mailboxId: "support",
          organizationId: "acme",
          scope: "mailbox",
          section: "signature",
          tab: "mailboxes",
          title: "Signature",
        },
      ],
      includeDevelopment: false,
    });
    expect(results[0]).toMatchObject({
      mailboxId: "support",
      organizationId: "acme",
      section: "signature",
    });
    expect(
      matchSettingsEntries("signature", {
        entries: [],
        includeDevelopment: false,
      })
    ).toStrictEqual([]);
  });
});
