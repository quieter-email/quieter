import { describe, expect, test } from "vite-plus/test";

import { mergeInterpretedFilters } from "./message-list-search-utils";

describe(mergeInterpretedFilters, () => {
  test("replaces a label chip with the opposite polarity", () => {
    const merged = mergeInterpretedFilters(
      [{ type: "label", value: "Receipts" }],
      [{ negated: true, type: "label", value: "Receipts" }]
    );

    expect(merged).toStrictEqual([
      { negated: true, type: "label", value: "Receipts" },
    ]);
  });

  test("keeps distinct labels side by side", () => {
    const merged = mergeInterpretedFilters(
      [{ type: "label", value: "Receipts" }],
      [{ type: "label", value: "Work Projects" }]
    );

    expect(merged).toStrictEqual([
      { type: "label", value: "Receipts" },
      { type: "label", value: "Work Projects" },
    ]);
  });

  test("replaces non-repeatable filters of the same type and appends repeatable ones", () => {
    const merged = mergeInterpretedFilters(
      [
        { type: "newer_than", value: "7d" },
        { type: "from", value: "billing@example.com" },
      ],
      [
        { type: "newer_than", value: "30d" },
        { type: "from", value: "noreply@example.com" },
      ]
    );

    expect(merged).toStrictEqual([
      { type: "newer_than", value: "30d" },
      { type: "from", value: "billing@example.com" },
      { type: "from", value: "noreply@example.com" },
    ]);
  });
});
