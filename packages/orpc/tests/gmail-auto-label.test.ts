import {
  getAutoLabelEligibleLabels,
  resolveAutoLabelDecisions,
  sanitizeAutoLabelSelection,
} from "@quieter/ai";
import { describe, expect, test } from "bun:test";

describe("Gmail auto-label eligibility", () => {
  test("only labels with inclusion criteria are eligible", () => {
    const eligible = getAutoLabelEligibleLabels([
      { description: "Work mail", id: "a", inclusionCriteria: "Client projects", name: "Business" },
      { description: null, id: "b", inclusionCriteria: null, name: "Personal" },
      { description: null, id: "c", inclusionCriteria: "   ", name: "University" },
    ]);

    expect(eligible).toEqual([
      { description: "Work mail", id: "a", inclusionCriteria: "Client projects", name: "Business" },
    ]);
  });
});

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

  test("resolves model decisions against eligible labels only", () => {
    const eligibleLabelIds = new Set(["business", "personal"]);

    expect(
      resolveAutoLabelDecisions(
        [
          { applies: true, labelId: "business" },
          { applies: true, labelId: "personal" },
          { applies: true, labelId: "ignored" },
        ],
        eligibleLabelIds,
      ),
    ).toEqual([]);
  });
});
