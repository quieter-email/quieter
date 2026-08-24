import { describe, expect, test } from "vite-plus/test";

import { parseNaturalLanguageMailSearch } from "../src/natural-language-search";
import { serializeStructuredSearchState } from "../src/search";

const NOW = new Date(2026, 7, 22, 15, 30);

const parse = (text: string, labels: string[] = []) =>
  parseNaturalLanguageMailSearch({ labels, now: NOW, text });

describe("natural language mail search", () => {
  test("parses the canonical example", () => {
    const result = parse("my unread mails from the last 30 days");

    expect(result.filters).toStrictEqual([
      { type: "is", value: "unread" },
      { type: "newer_than", value: "30d" },
    ]);
    expect(result.text).toBe("");
  });

  test("parses read state, attachments and folders", () => {
    const result = parse("read messages with attachments in spam");

    expect(result.filters).toStrictEqual([
      { type: "is", value: "read" },
      { type: "has", value: "attachment" },
      { type: "is", value: "spam" },
    ]);
  });

  test("negates filters", () => {
    const result = parse("without attachments not read");

    expect(result.filters).toStrictEqual([
      { negated: true, type: "has", value: "attachment" },
      { type: "is", value: "unread" },
    ]);
  });

  test("captures sender and recipient values", () => {
    const result = parse(
      "mails from billing@example.com to john about invoices"
    );

    expect(result.filters).toStrictEqual([
      { type: "from", value: "billing@example.com" },
      { type: "to", value: "john" },
    ]);
    expect(result.text).toBe("invoices");
  });

  test("captures multi-word sender names and stops at date boundaries", () => {
    const result = parse("from mary ann lee this week");

    expect(result.filters).toStrictEqual([
      { type: "from", value: "mary ann lee" },
      { type: "after", value: "2026/8/17" },
    ]);
  });

  test("parses relative ranges with number words", () => {
    expect(parse("older than two years").filters).toStrictEqual([
      { type: "older_than", value: "2y" },
    ]);
    expect(parse("last week").filters).toStrictEqual([
      { type: "newer_than", value: "7d" },
    ]);
    expect(parse("past three months").filters).toStrictEqual([
      { type: "newer_than", value: "3m" },
    ]);
    expect(parse("last day").filters).toStrictEqual([
      { type: "newer_than", value: "1d" },
    ]);
    expect(parse("past day").filters).toStrictEqual([
      { type: "newer_than", value: "1d" },
    ]);
  });

  test("negates labels mentioned after a negator", () => {
    const result = parse("without receipts", ["Receipts"]);

    expect(result.filters).toStrictEqual([
      { negated: true, type: "label", value: "Receipts" },
    ]);
    expect(result.text).toBe("");
  });

  test("parses today and yesterday as absolute bounds", () => {
    expect(parse("today").filters).toStrictEqual([
      { type: "after", value: "2026/8/22" },
    ]);
    expect(parse("yesterday").filters).toStrictEqual([
      { type: "after", value: "2026/8/21" },
      { type: "before", value: "2026/8/22" },
    ]);
  });

  test("parses since and before with absolute dates", () => {
    expect(parse("since 2026-03-05").filters).toStrictEqual([
      { type: "after", value: "2026/3/5" },
    ]);
    expect(parse("before march 3").filters).toStrictEqual([
      { type: "before", value: "2026/3/3" },
    ]);
    expect(parse("until january 5th").filters).toStrictEqual([
      { type: "before", value: "2026/1/5" },
    ]);
  });

  test("rejects calendar-invalid absolute dates", () => {
    const result = parse("since 2026-02-31");

    expect(result.filters).toStrictEqual([]);
    expect(result.text).toBe("since 2026-02-31");
  });

  test("moves future month-day dates into the past year", () => {
    const result = parse("since september 1");

    expect(result.filters).toStrictEqual([
      { type: "after", value: "2025/9/1" },
    ]);
  });

  test("matches known labels case-insensitively", () => {
    const result = parse("unread work projects stuff", [
      "Work Projects",
      "receipts",
    ]);

    expect(result.text).toBe("stuff");
    expect(result.filters).toContainEqual({
      type: "is",
      value: "unread",
    });
    expect(
      serializeStructuredSearchState({
        filters: result.filters,
        text: result.text,
      })
    ).toContain('label:"Work Projects"');
  });

  test("keeps unrecognized prose as leftover text", () => {
    const result = parse("quarterly budget spreadsheet");

    expect(result.filters).toStrictEqual([]);
    expect(result.text).toBe("quarterly budget spreadsheet");
  });

  test("drops bare prepositions without a captured value", () => {
    const result = parse("mails from the boss");

    expect(result.filters).toStrictEqual([{ type: "from", value: "boss" }]);
    expect(result.text).toBe("");
  });
});
