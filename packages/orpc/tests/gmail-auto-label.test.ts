import {
  resolveAutoLabelDecisions,
  sanitizeAutoLabelSelection,
} from "@quieter/ai/classify-gmail-message";
import { describe, expect, test } from "bun:test";

describe("Gmail auto-label selection", () => {
  test("drops the result when every available label was selected", () => {
    const availableLabelIds = new Set(["label-a", "label-b", "label-c"]);

    expect(
      sanitizeAutoLabelSelection(["label-a", "label-b", "label-c"], availableLabelIds),
    ).toEqual([]);
  });

  test("drops the result when more than half of the labels were selected", () => {
    const availableLabelIds = new Set(["label-a", "label-b", "label-c"]);

    expect(sanitizeAutoLabelSelection(["label-a", "label-b"], availableLabelIds)).toEqual([]);
  });

  test("keeps a single confident label", () => {
    const availableLabelIds = new Set(["label-a", "label-b", "label-c"]);

    expect(sanitizeAutoLabelSelection(["label-b"], availableLabelIds)).toEqual(["label-b"]);
  });

  test("keeps two labels when many are available", () => {
    const availableLabelIds = new Set(["receipts", "amazon", "tax", "travel", "finance", "health"]);

    expect(sanitizeAutoLabelSelection(["receipts", "amazon"], availableLabelIds)).toEqual([
      "receipts",
      "amazon",
    ]);
  });

  test("ignores unknown label ids", () => {
    const availableLabelIds = new Set(["label-a"]);

    expect(sanitizeAutoLabelSelection(["label-a", "label-z"], availableLabelIds)).toEqual([
      "label-a",
    ]);
  });

  test("resolves model decisions against available labels only", () => {
    const availableLabelIds = new Set(["business", "personal"]);

    expect(
      resolveAutoLabelDecisions(
        [
          { applies: true, labelId: "business" },
          { applies: true, labelId: "personal" },
          { applies: true, labelId: "ignored" },
        ],
        availableLabelIds,
      ),
    ).toEqual([]);
  });
});
