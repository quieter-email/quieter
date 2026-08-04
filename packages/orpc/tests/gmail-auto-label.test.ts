import {
  buildAutoLabelPromptInput,
  resolveAutoLabelDecisions,
  sanitizeAutoLabelSelection,
} from "@quieter/ai/classify-gmail-message";
import { describe, expect, test } from "vite-plus/test";

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

  test("passes dynamically retrieved memory as advisory classifier context", () => {
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
      memoryContext:
        "Current mailbox memory (more specific):\n- Do not apply Dev to GitHub product digests.",
    });

    expect(input).toMatchObject({
      relevantMemory: expect.stringContaining("Do not apply Dev"),
    });
  });

  test("passes authored instructions and selected learned memory together", () => {
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
      memoryContext:
        "User-authored instructions:\nTreat invoices as receipts.\n\nRelevant learned memory:\n- Store receipts usually arrive from orders@example.com.",
    });

    expect(input).toMatchObject({
      relevantMemory: expect.stringContaining("User-authored instructions"),
    });
    expect(input).toMatchObject({
      relevantMemory: expect.stringContaining(
        "Store receipts usually arrive from orders@example.com.",
      ),
    });
  });

  test("caps dynamic memory in classifier payloads", () => {
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
      memoryContext: "x".repeat(8_000),
    });

    expect(input.relevantMemory).toHaveLength(6_000);
  });
});
