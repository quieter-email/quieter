import {
  buildAutoLabelPromptInput,
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

  test("passes recent user corrections as explicit classifier context", () => {
    const input = buildAutoLabelPromptInput({
      labels: [
        {
          description: null,
          id: "label-dev",
          inclusionCriteria: "Only direct repository or build activity.",
          name: "Dev",
        },
      ],
      message: {
        from: "GitHub <noreply@github.com>",
        id: "message-1",
        subject: "Weekly product digest",
      },
      userCorrectionContext: JSON.stringify({
        corrections: [
          {
            count: 2,
            labelId: "label-dev",
            labelName: "Dev",
            signal: "removed",
            source: "github.com",
          },
        ],
        kind: "auto_label_user_corrections",
      }),
    });

    expect(input).toMatchObject({
      recentUserLabelCorrections: expect.stringContaining('"signal":"removed"'),
    });
    expect(input).not.toHaveProperty("pastDecisions");
  });

  test("passes shared user context as advisory classifier context", () => {
    const input = buildAutoLabelPromptInput({
      labels: [
        {
          description: null,
          id: "label-receipts",
          inclusionCriteria: null,
          name: "Receipts",
        },
      ],
      message: {
        from: "Store <orders@example.com>",
        id: "message-1",
        subject: "Your invoice",
      },
      userAiContext: "## Labeling\n- Treat invoices as receipts.",
    });

    expect(input).toMatchObject({
      userAiContext: "## Labeling\n- Treat invoices as receipts.",
    });
  });

  test("caps shared user context in classifier payloads", () => {
    const input = buildAutoLabelPromptInput({
      labels: [
        {
          description: null,
          id: "label-receipts",
          inclusionCriteria: null,
          name: "Receipts",
        },
      ],
      message: {
        id: "message-1",
        subject: "Invoice",
      },
      userAiContext: "x".repeat(5_000),
    });

    expect(input.userAiContext).toHaveLength(4_000);
  });
});
