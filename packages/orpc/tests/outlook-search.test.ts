import { describe, expect, test } from "vite-plus/test";

import { translateOutlookSearch } from "../src/outlook/search";

describe("Outlook search expression boundary", () => {
  test("preserves grouped boolean expressions and literal operator words", () => {
    const translated = translateOutlookSearch(
      '(from:alice@example.test OR from:bob@example.test) subject:"release AND recovery" -has:attachment'
    );
    expect(translated).toContain(" OR ");
    expect(translated).toContain(" AND ");
    expect(translated).toContain("NOT hasAttachments:true");
    expect(translated).toContain('subject:\\"release AND recovery\\"');
  });

  test.each([
    "is:unread",
    "label:clients",
    "header:X-Private:value",
    "newer_than:2d",
  ])("rejects unsupported filters without dropping them", (query) => {
    expect(() =>
      translateOutlookSearch(`from:alice@example.test OR ${query}`)
    ).toThrow(/search|filter|date|quoted/iu);
  });

  test.each([
    'subject:"literal\\" OR from:attacker"',
    "subject:foo*",
    "before:2026/02/30",
  ])("rejects syntax or values that cannot be represented exactly", (query) => {
    expect(() => translateOutlookSearch(query)).toThrow(
      /search|filter|date|quoted/iu
    );
  });

  test("retains calendar comparison boundaries and rejects an unfinished expression", () => {
    const translated = translateOutlookSearch(
      "after:2026/11/01 before:2026/12/01"
    );
    expect(translated).toContain("received>=2026-11-01");
    expect(translated).toContain("received<2026-12-01");
    expect(() => translateOutlookSearch("from:alice@example.test OR")).toThrow(
      /search|filter|date|quoted/iu
    );
  });
});
