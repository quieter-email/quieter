import { describe, expect, test } from "vite-plus/test";
import {
  createTemplatePlaceholderToken,
  hydrateTemplatePlaceholders,
  serializeTemplatePlaceholders,
} from "./template-placeholders";

describe("template placeholders", () => {
  test("normalizes placeholder labels into Quieter-only tokens", () => {
    expect(createTemplatePlaceholderToken("  First   name  ")).toBe("{{quieter:First name}}");
    expect(createTemplatePlaceholderToken('Invoice <id> & "date"')).toBe(
      "{{quieter:Invoice id date}}",
    );
  });

  test("hydrates provider-safe tokens for editing and serializes them before persistence", () => {
    const providerHtml = "<p>Hello {{quieter:First name}},</p>";
    const editorHtml = hydrateTemplatePlaceholders(providerHtml);

    expect(editorHtml).toBe(
      '<p>Hello <span data-quieter-template-placeholder="First name">First name</span>,</p>',
    );
    expect(
      serializeTemplatePlaceholders(
        '<p>Hello <span class="quieter-template-placeholder" contenteditable="false" data-quieter-template-placeholder="First name">First name</span>,</p>',
      ),
    ).toBe(providerHtml);
  });
});
