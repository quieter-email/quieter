import {
  buildAutoLabelPromptInput,
  sanitizeAutoLabelSelection,
} from "@quieter/ai/classify-gmail-message";
import { describe, expect, test } from "vite-plus/test";

describe("Gmail auto-label selection", () => {
  test("drops the result when every available label was selected", () => {
    const availableLabelIds = new Set(["label-a", "label-b", "label-c"]);

    expect(
      sanitizeAutoLabelSelection(
        ["label-a", "label-b", "label-c"],
        availableLabelIds
      )
    ).toStrictEqual([]);
  });

  test("drops the result when more than half of the labels were selected", () => {
    const availableLabelIds = new Set(["label-a", "label-b", "label-c"]);

    expect(
      sanitizeAutoLabelSelection(["label-a", "label-b"], availableLabelIds)
    ).toStrictEqual([]);
  });

  test("keeps a single confident label", () => {
    const availableLabelIds = new Set(["label-a", "label-b", "label-c"]);

    expect(
      sanitizeAutoLabelSelection(["label-b"], availableLabelIds)
    ).toStrictEqual(["label-b"]);
  });

  test("keeps two labels when many are available", () => {
    const availableLabelIds = new Set([
      "receipts",
      "amazon",
      "tax",
      "travel",
      "finance",
      "health",
    ]);

    expect(
      sanitizeAutoLabelSelection(["receipts", "amazon"], availableLabelIds)
    ).toStrictEqual(["receipts", "amazon"]);
  });

  test("ignores unknown label ids", () => {
    const availableLabelIds = new Set(["label-a"]);

    expect(
      sanitizeAutoLabelSelection(["label-a", "label-z"], availableLabelIds)
    ).toStrictEqual(["label-a"]);
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
      memoryContext:
        "Current mailbox memory (more specific):\n- Do not apply Dev to GitHub product digests.",
      message: {
        from: "GitHub <noreply@github.com>",
        id: "message-1",
        subject: "Weekly product digest",
      },
    });

    expect(input.relevantMemory).toContain("Do not apply Dev");
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
      memoryContext:
        "User-authored instructions:\nTreat invoices as receipts.\n\nRelevant learned memory:\n- Store receipts usually arrive from orders@example.com.",
      message: {
        from: "Store <orders@example.com>",
        id: "message-1",
        subject: "Your invoice",
      },
    });

    expect(input.relevantMemory).toContain("User-authored instructions");
    expect(input.relevantMemory).toContain(
      "Store receipts usually arrive from orders@example.com."
    );
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
      memoryContext: "x".repeat(8000),
      message: {
        id: "message-1",
        subject: "Invoice",
      },
    });

    expect(input.relevantMemory).toHaveLength(6000);
  });
});
