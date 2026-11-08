import { describe, expect, test } from "vite-plus/test";

import { parseNaturalLanguageMailSearch } from "../src/natural-language-search";

const NOW = new Date(2026, 7, 22, 15, 30);

const parse = (text: string, labels: string[] = []) =>
  parseNaturalLanguageMailSearch({ labels, now: NOW, text });

describe("natural language mail search", () => {
  test("captures multi-word sender names and stops at date boundaries", () => {
    const result = parse("from mary ann lee this week");

    expect(result.filters).toStrictEqual([
      { type: "from", value: "mary ann lee" },
      { type: "after", value: "2026/8/17" },
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
});
