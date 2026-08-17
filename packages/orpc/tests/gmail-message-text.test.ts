import { describe, expect, test } from "vite-plus/test";

import { htmlToPlainText } from "../src/gmail-useful-details/message-text";

describe("Gmail HTML to plain text", () => {
  test("drops comments and hidden sections, keeping block structure", () => {
    expect(
      htmlToPlainText(
        "<html><head><title>Preview</title></head><body><!-- tracking -->Your code is <b>123456</b><style>.a{color:red}</style><script>track()</script><p>Thanks</p></body></html>"
      )
    ).toBe("Your code is 123456\nThanks");
  });

  test("removes every hidden section in a message", () => {
    expect(
      htmlToPlainText("a<style>x</style>b<style>y</style>c<script>z</script>d")
    ).toBe("a b c d");
  });

  /**
   * Mail bodies are attacker-controlled up to the raw cap, and the extractor runs
   * inside the automation worker. Unterminated markup used to make stripping cost
   * the square of the body length, which stalls the worker and retries the event.
   */
  test("reads a code out of unterminated markup without stalling", () => {
    const startedAt = Date.now();

    for (const opener of ["<!--", "<style>", "<", "<a "]) {
      // Just short of the raw cap, so the code still survives the slice.
      const filler = opener.repeat(Math.floor(300_000 / opener.length));
      expect(htmlToPlainText(`${filler}Your code is 123456`)).toContain(
        "123456"
      );
    }

    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
