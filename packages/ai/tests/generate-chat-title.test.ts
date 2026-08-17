import { describe, expect, test } from "vite-plus/test";

import { normalizeChatTitle } from "../src/generate-chat-title";

describe("chat title normalization", () => {
  test("strips wrapping quotes, markdown, and trailing punctuation", () => {
    expect(normalizeChatTitle('  **"Sarah Launch Emails."**  ', "any")).toBe(
      "Sarah Launch Emails"
    );
  });

  test("collapses whitespace", () => {
    expect(normalizeChatTitle("Most\n Important   Message", "any")).toBe(
      "Most Important Message"
    );
  });

  test("drops foreign-script words when the request is plain ASCII", () => {
    expect(normalizeChatTitle("Greeting സന്ദ", "Hello")).toBe("Greeting");
  });

  test("strips the foreign-script tail of a mixed word", () => {
    expect(normalizeChatTitle("Greetingസന്ദ", "Hello")).toBe("Greeting");
  });

  test("keeps the request's own script", () => {
    expect(normalizeChatTitle("Nachricht an Sarah", "Schreib an Sarah")).toBe(
      "Nachricht an Sarah"
    );
    expect(normalizeChatTitle("സന്ദേശം", "സന്ദേശം അയയ്ക്കുക")).toBe("സന്ദേശം");
  });

  test("truncates long titles at a word boundary", () => {
    const title = normalizeChatTitle(
      "Find every single message that mentions the quarterly revenue reconciliation project",
      "any"
    );

    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith(" ")).toBeFalsy();
    expect(title).toBe(
      "Find every single message that mentions the quarterly revenue reconciliation"
    );
  });

  test("clips a title that has no word boundary to cut on", () => {
    expect(normalizeChatTitle("a".repeat(120), "any")).toBe("a".repeat(80));
  });

  test("returns an empty title when nothing usable survives", () => {
    expect(normalizeChatTitle('"സന്ദ"', "Hello")).toBe("");
  });
});
