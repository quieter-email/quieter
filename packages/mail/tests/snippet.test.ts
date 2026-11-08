import { describe, expect, test } from "vite-plus/test";

import { createMailSnippet } from "../src/snippet";

describe(createMailSnippet, () => {
  test.each([
    { bodyHtml: `<style>${"<style>".repeat(8000)}`, expected: undefined },
    { bodyHtml: `<script>${"<script>".repeat(8000)}`, expected: undefined },
    {
      bodyHtml: `<div>${"<div>".repeat(8000)}${"</unknown>".repeat(8000)}`,
      expected: "Visible",
    },
  ])(
    "handles malformed HTML without suffix rescans",
    ({ bodyHtml, expected }) => {
      expect(
        createMailSnippet({ bodyHtml: `${bodyHtml}<p>Visible</p>` })
      ).toStrictEqual(expected);
    }
  );

  test("finds text after long non-visible content without truncating the input", () => {
    const snippet = createMailSnippet({
      bodyHtml: `<style>${"x".repeat(50_000)}</style><p>Visible</p>`,
    });
    expect(snippet).toBe("Visible");
  });

  test("preserves whitespace, Unicode, entity spellings, and tag separators", () => {
    expect(
      createMailSnippet({
        bodyHtml:
          '<STYLE media="all">hidden</STYLE><p> Hello\n<b>world</b><!-- note -->&amp; 東京 😀</p><script>secret</script>',
      })
    ).toBe("Hello world &amp; 東京 😀");
  });
});
