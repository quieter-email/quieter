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
    expect(match("billing")).toStrictEqual(["organization"]);
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
});
