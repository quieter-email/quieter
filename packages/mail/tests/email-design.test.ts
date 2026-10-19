import { parseSync } from "oxc-parser";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { describe, expect, test } from "vite-plus/test";

import {
  appendEmailUnsubscribe,
  createEmailDesign,
  emailContentSchema,
  emailDesignSchema,
  exportEmailDesign,
  importEmailTheme,
  renderEmailContent,
} from "../src/email-design";

describe("email content validation", () => {
  test.each([
    "<script>alert(1)</script>",
    '<img src="https://example.com/a.png" onerror="alert(1)">',
    '<a href="&#106;avascript:alert(1)">Click</a>',
    '<a href="java&#10;script:alert(1)">Click</a>',
    '<iframe src="https://example.com"></iframe>',
    '<form action="https://example.com"><input></form>',
    '<svg><a href="https://example.com">Click</a></svg>',
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<p style="width:expression(alert(1))">Hello</p>',
    '<p style="width:expre\\73sion(alert(1))">Hello</p>',
    '<p style="background:url(\\6a avascript:alert)">Hello</p>',
    "<p style=\"background:u\\72l('javascript:alert')\">Hello</p>",
    '<p style="\\62 ehavior:url(https://example.com/a.htc)">Hello</p>',
    '<style>@import "https://example.com/styles.css";</style>',
    '<!--[if mso]><img src="https://example.com/a.png" onerror="alert(1)"><![endif]-->',
    "<!--[if mso]><script>alert(1)</script><![endif]-->",
    "<template><script>alert(1)</script></template>",
    '<body style="display:none">Hello</body>',
    '<body style="opacity:0!important">Hello</body>',
    "<html hidden><body>Hello</body></html>",
  ])("rejects active markup or CSS: %s", (html) => {
    expect(
      emailContentSchema.safeParse({ html, kind: "html", text: "Hello" })
        .success
    ).toBeFalsy();
  });

  test("retains imported email source and conditional formatting exactly", () => {
    const html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><style>@media (max-width:600px){.container{width:100%!important}}</style></head><body><!--[if mso]><table role="presentation"><tr><td><![endif]--><table role="presentation" style="border-collapse:collapse"><tr><td><img src="https://example.com/logo.png" alt="Logo"><p style="font-family:Arial;font-size:16px;mso-line-height-rule:exactly">Hello &amp; welcome</p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></body></html>`;
    const result = renderEmailContent({
      html,
      kind: "html",
      text: "Hello & welcome",
    });
    expect(result.html).toBe(html);
    expect(result.text).toContain("Hello & welcome");
    expect(result.warnings.join(" ")).toMatch(
      /external images.*custom CSS|custom CSS.*external images/iu
    );
  });

  test("rejects excessive nesting and oversized Unicode source before parsing", () => {
    const deeplyNested = `${"<div>".repeat(70)}Hello${"</div>".repeat(70)}`;
    const oversized = "🔥".repeat(60_000);
    expect(
      emailContentSchema.safeParse({
        html: deeplyNested,
        kind: "html",
        text: "",
      }).success
    ).toBeFalsy();
    expect(
      emailContentSchema.safeParse({ html: oversized, kind: "html", text: "" })
        .success
    ).toBeFalsy();
  });

  test("derives a readable alternative from visible document content and link destinations", () => {
    const html =
      '<!DOCTYPE html><html><head><title>Internal title</title><style>p{color:#111}</style></head><body><div style="display:none;max-height:0;mso-hide:all">Hidden preheader</div><p>Hello <strong>friend</strong><br>Welcome &amp; enjoy.</p><p><a href="https://example.com/update?edition=2&amp;source=email">Read the update</a></p><img src="https://example.com/photo.jpg" alt="A quiet morning"><div hidden>Hidden details</div><span aria-hidden="true">Decorative icon</span></body></html>';
    const result = renderEmailContent({ html, kind: "html", text: " \n " });
    expect(result.html).toBe(html);
    expect(result.text).toMatch(
      /Hello friend\nWelcome & enjoy\.\n\nRead the update/iu
    );
    expect(result.text).toContain(
      "Read the update (https://example.com/update?edition=2&source=email)"
    );
    expect(result.text).toContain("A quiet morning");
    expect(result.text).not.toMatch(
      /Internal title|Hidden preheader|Hidden details|Decorative icon|color:#111/iu
    );
    const explicit = "  Custom alternative\nwith deliberate spacing.  ";
    expect(
      renderEmailContent({ html, kind: "html", text: explicit }).text
    ).toBe(explicit);
  });

  test("rejects unsafe design URLs, duplicate IDs, arbitrary styles and nonfinite dimensions", () => {
    const design = createEmailDesign();
    expect(
      emailDesignSchema.safeParse({
        ...design,
        blocks: [
          {
            alt: "",
            id: "image",
            src: "data:image/svg+xml,unsafe",
            type: "image",
            width: 100,
          },
        ],
      }).success
    ).toBeFalsy();
    expect(
      emailDesignSchema.safeParse({
        ...design,
        blocks: [
          {
            align: "left",
            // oxlint-disable-next-line eslint/no-script-url -- Exercise rejection of executable link schemes.
            href: "javascript:alert(1)",
            id: "button",
            text: "Click",
            type: "button",
          },
        ],
      }).success
    ).toBeFalsy();
    expect(
      emailDesignSchema.safeParse({
        ...design,
        blocks: [
          { id: "same", type: "divider" },
          { id: "same", type: "divider" },
        ],
      }).success
    ).toBeFalsy();
    expect(
      emailDesignSchema.safeParse({
        ...design,
        theme: { ...design.theme, css: "background:red" },
      }).success
    ).toBeFalsy();
    expect(
      emailDesignSchema.safeParse({
        ...design,
        theme: { ...design.theme, width: Number.POSITIVE_INFINITY },
      }).success
    ).toBeFalsy();
  });
});

describe("email exports", () => {
  test("escapes authored text and keeps source interpolation inert", () => {
    const payload =
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- The export must preserve interpolation syntax as inert text.
      "</script><img src=x onerror=alert(1)>${globalThis.compromised=true}`";
    const result = exportEmailDesign({
      ...createEmailDesign(),
      blocks: [
        { align: "left", id: "payload", text: payload, type: "text" },
        {
          align: "right",
          href: "https://example.com/?a=1&b=2",
          id: "action",
          text: "Open",
          type: "button",
        },
      ],
    });
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;/script&gt;");
    expect(result.html).toContain("a=1&amp;b=2");
    expect(result.text).toContain(payload);
    expect(result.text).toContain("https://example.com/?a=1&b=2");
    expect(result.react).not.toContain("</script><img");
    const source = /const design = (?<document>[\s\S]*?) as const;/u.exec(
      result.react
    )?.groups?.document;
    expect(source).toBeDefined();
    expect(JSON.parse(source ?? "null")).toMatchObject({
      blocks: [{ text: payload }, { href: "https://example.com/?a=1&b=2" }],
    });
    const compiled = parseSync("email.tsx", result.react);
    expect(compiled.errors).toHaveLength(0);
    expect(
      emailContentSchema.safeParse({
        html: result.html,
        kind: "html",
        text: result.text,
      }).success
    ).toBeTruthy();
  });

  test("inserts an unsubscribe link inside the document while preserving source", () => {
    const html =
      "<!DOCTYPE html><html><head><style>p{margin:0}</style></head><body><!--[if mso]><table><tr><td><![endif]--><p>Hello</p><!--[if mso]></td></tr></table><![endif]--></body></html>";
    const result = appendEmailUnsubscribe(
      html,
      'https://example.com/unsubscribe?token=one&two="quoted"'
    );
    expect(result).toContain("token=one&amp;two=&quot;quoted&quot;");
    expect(
      result.replace(
        /<table role="presentation"[\s\S]*?Unsubscribe<\/a><\/td><\/tr><\/table>/u,
        ""
      )
    ).toBe(html);
    const tree = parse(result);
    const stack: DefaultTreeAdapterTypes.Node[] = [tree];
    let foundInsideBody = false;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node && "tagName" in node && node.tagName === "a") {
        let parent = node.parentNode;
        while (parent && "tagName" in parent) {
          foundInsideBody ||= parent.tagName === "body";
          parent = parent.parentNode;
        }
      }
      if (node && "childNodes" in node) {
        stack.push(...node.childNodes);
      }
    }
    expect(foundInsideBody).toBeTruthy();
    // oxlint-disable-next-line eslint/no-script-url -- Exercise rejection at the unsubscribe URL boundary.
    expect(() => appendEmailUnsubscribe(html, "javascript:alert(1)")).toThrow(
      Error
    );
  });

  test.each(["<p>Hello</p><!--unfinished", "<p>Hello</p><style>p{margin:0}"])(
    "keeps unsubscribe visible with an unfinished trailing comment or style",
    (html) => {
      const result = appendEmailUnsubscribe(
        html,
        "https://example.com/unsubscribe"
      );
      expect(result.indexOf("Unsubscribe")).toBeLessThan(
        result.indexOf(html.includes("<!--") ? "<!--" : "<style>")
      );
    }
  );
});

describe("theme import", () => {
  test("reports the field path for an invalid flat theme value", () => {
    expect(() =>
      importEmailTheme({
        ...createEmailDesign().theme,
        primaryColor: "not-a-color",
      })
    ).toThrow(/primaryColor/u);
  });

  test("converts typed color tokens and rejects unsupported or conflicting tokens", () => {
    const { theme } = createEmailDesign();
    const tokens = Object.fromEntries(
      Object.entries(theme).map(([name, value]) => {
        let type = "number";
        if (name.endsWith("Color")) {
          type = "color";
        }
        if (name === "fontFamily") {
          type = "fontFamily";
        }
        return [name, { $type: type, $value: value }];
      })
    );
    const imported = importEmailTheme({
      ...tokens,
      primaryColor: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0.2, 0.4, 0.6] },
      },
    });
    expect(imported.primaryColor).toMatch(/^#336699$/u);
    expect(() =>
      importEmailTheme({
        ...tokens,
        primaryColor: {
          $type: "color",
          $value: {
            colorSpace: "srgb",
            components: [0.2, 0.4, 0.6],
            hex: "#ffffff",
          },
        },
      })
    ).toThrow(/conflicting/iu);
    expect(() =>
      importEmailTheme({ ...theme, customCss: "body{display:none}" })
    ).toThrow(Error);
    expect(() =>
      importEmailTheme({
        ...tokens,
        width: { $type: "number", $value: "600px" },
      })
    ).toThrow(Error);
    expect(() =>
      importEmailTheme({
        ...tokens,
        primaryColor: {
          $type: "color",
          $value: "red;background:url(https://example.com)",
        },
      })
    ).toThrow(Error);
  });
});
