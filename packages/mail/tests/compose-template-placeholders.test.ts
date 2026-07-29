import { describe, expect, test } from "vite-plus/test";
import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
  hasUnresolvedTemplatePlaceholders,
} from "../src/compose/schema";

const draft = {
  bcc: "",
  bodyHtml: "<p>Hello {{quieter:First name}},</p>",
  bodyText: "Hello {{quieter:First name}},",
  cc: "",
  subject: "Hello",
  to: "person@example.com",
};

describe("compose template placeholders", () => {
  test("allows unresolved placeholders in provider drafts", () => {
    expect(composeDraftFormValuesSchema.safeParse(draft).success).toBe(true);
  });

  test("blocks sending until every placeholder is filled", () => {
    const result = composeSendFormValuesSchema.safeParse(draft);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (issue) => issue.message === "Fill every template placeholder before sending.",
      ),
    ).toBe(true);
  });

  test("does not treat ordinary braces as template placeholders", () => {
    expect(hasUnresolvedTemplatePlaceholders("Use {{firstName}} in the sample.")).toBe(false);
  });

  test("also rejects unsanitized editor placeholder nodes", () => {
    expect(
      hasUnresolvedTemplatePlaceholders(
        '<span data-quieter-template-placeholder="First name">First name</span>',
      ),
    ).toBe(true);
  });
});
