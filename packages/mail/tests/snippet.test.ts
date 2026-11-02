import { describe, expect, test } from "vite-plus/test";

import { createMailSnippet } from "../src/snippet";

describe(createMailSnippet, () => {
  test.each([
    { bodyHtml: "<".repeat(32_000), expected: "<".repeat(240) },
    { bodyHtml: `<style>${"<style>".repeat(8000)}`, expected: undefined },
    { bodyHtml: `<script>${"<script>".repeat(8000)}`, expected: undefined },
    {
      bodyHtml: `<div>${"<div>".repeat(8000)}${"</unknown>".repeat(8000)}`,
      expected: "Visible",
    },
  ])(
    "handles malformed HTML without suffix rescans",
    ({ bodyHtml, expected }) => {
      expect(createMailSnippet({ bodyHtml: `${bodyHtml}<p>Visible</p>` })).toBe(
        expected
      );
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

  test("preserves the API caller's script and style text mode", () => {
    expect(
      createMailSnippet({
        bodyHtml:
          "<style>style text</style><p>Visible</p><script>script text</script>",
        includeScriptAndStyleText: true,
      })
    ).toBe("style text Visible script text");
  });

  test("preserves malformed visible text in the API caller's mode", () => {
    const bodyHtml = "<".repeat(32_000);
    expect(
      createMailSnippet({ bodyHtml, includeScriptAndStyleText: true })
    ).toBe(bodyHtml.slice(0, 240));
  });

  test("strips tags within script and style text in the API caller's mode", () => {
    expect(
      createMailSnippet({
        bodyHtml: "<script>before<b>inside</b>after</script>",
        includeScriptAndStyleText: true,
      })
    ).toBe("before inside after");
  });

  test.each(["title", "textarea", "xmp"])(
    "keeps existing tag separators inside %s elements",
    (tag) => {
      expect(
        createMailSnippet({
          bodyHtml: `<${tag}>before<b>inside</b>after</${tag}>`,
        })
      ).toBe("before inside after");
    }
  );

  test.each(["", " \n\t "])(
    "keeps empty text precedence over HTML",
    (bodyText) => {
      expect(
        createMailSnippet({ bodyHtml: "<p>Hidden</p>", bodyText })
      ).toBeUndefined();
    }
  );

  test("keeps a separator at the output boundary only when text follows it", () => {
    const prefix = "a".repeat(239);
    expect(createMailSnippet({ bodyHtml: `<p>${prefix}</p> \n` })).toBe(prefix);
    expect(createMailSnippet({ bodyHtml: `<p>${prefix}</p>b` })).toBe(
      `${prefix} `
    );
  });
});
