import { buildAutoLabelPromptInput } from "@quieter/ai/classify-gmail-message";
import { describe, expect, test } from "vite-plus/test";

describe("Gmail auto-label selection", () => {
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

    expect(input.relevantMemory?.length).toBeLessThanOrEqual(6000);
  });
});
