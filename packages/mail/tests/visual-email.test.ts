import { describe, expect, test } from "vite-plus/test";

import {
  renderVisualEmailDocument,
  visualEmailDocumentSchema,
} from "../src/visual-email";
import type { VisualEmailDocument } from "../src/visual-email";

describe("visual email documents", () => {
  test("renders supported editor blocks and inline formatting as semantic HTML", () => {
    const document: VisualEmailDocument = {
      content: {
        content: [
          {
            content: [
              {
                marks: [{ type: "bold" }, { type: "italic" }],
                text: "Hello",
                type: "text",
              },
              { type: "hardBreak" },
              { marks: [{ type: "strike" }], text: "Old", type: "text" },
              { marks: [{ type: "underline" }], text: "New", type: "text" },
              {
                marks: [{ type: "code" }],
                text: "let value = 1;",
                type: "text",
              },
              {
                attrs: { label: "First name" },
                marks: [{ type: "bold" }],
                type: "templatePlaceholder",
              },
            ],
            type: "paragraph",
          },
          {
            attrs: { start: 3, type: null },
            content: [
              {
                content: [
                  {
                    content: [{ text: "Step", type: "text" }],
                    type: "paragraph",
                  },
                ],
                type: "listItem",
              },
            ],
            type: "orderedList",
          },
          {
            content: [
              {
                content: [
                  { type: "paragraph" },
                  { content: [{ type: "paragraph" }], type: "blockquote" },
                ],
                type: "listItem",
              },
            ],
            type: "bulletList",
          },
          {
            attrs: { language: "javascript" },
            content: [{ text: "a < b", type: "text" }],
            type: "codeBlock",
          },
          { type: "horizontalRule" },
          {
            attrs: {
              alt: "Portrait",
              src: "https://example.com/photo.jpg",
              title: null,
            },
            type: "image",
          },
        ],
        type: "doc",
      },
      version: 1,
    };

    const html = renderVisualEmailDocument(document);

    expect(html).toContain("<strong><em>Hello</em></strong><br>");
    expect(html).toContain("<s>Old</s><u>New</u><code>let value = 1;</code>");
    expect(html).toContain("<strong>{{quieter:First name}}</strong>");
    expect(html).toContain('<ol start="3"><li><p>Step</p></li></ol>');
    expect(html).toContain(
      "<ul><li><p></p><blockquote><p></p></blockquote></li></ul>"
    );
    expect(html).toContain("<pre><code>a &lt; b</code></pre><hr>");
    expect(html).toContain(
      '<img src="https://example.com/photo.jpg" alt="Portrait">'
    );
  });

  test("escapes message text and attributes without losing source whitespace", () => {
    const document: VisualEmailDocument = {
      content: {
        content: [
          {
            content: [
              {
                marks: [
                  {
                    attrs: {
                      class: "custom",
                      href: 'https://example.com/?q="&value=<test>',
                      rel: "opener",
                      target: "_blank",
                    },
                    type: "link",
                  },
                ],
                text: '  <script>alert("hello")</script> & \'  ',
                type: "text",
              },
            ],
            type: "paragraph",
          },
          {
            attrs: {
              alt: '" onerror="alert(1)',
              "data-compose-inline-id": "private-editor-id",
              src: "https://example.com/photo.jpg",
              title: "<Portrait>",
            },
            type: "image",
          },
        ],
        type: "doc",
      },
      version: 1,
    };

    const html = renderVisualEmailDocument(document);

    expect(html).toContain(
      'href="https://example.com/?q=&quot;&amp;value=&lt;test&gt;"'
    );
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain(
      "  &lt;script&gt;alert(&quot;hello&quot;)&lt;/script&gt; &amp; &#39;  "
    );
    expect(html).toContain(
      'alt="&quot; onerror=&quot;alert(1)" title="&lt;Portrait&gt;"'
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("private-editor-id");
    expect(
      visualEmailDocumentSchema.parse(document).content.content
    ).toMatchObject(document.content.content);
  });

  test.each([
    // oxlint-disable-next-line eslint/no-script-url -- Ensure stored visual documents reject executable URLs.
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/image",
    "cid:attachment",
    "//example.com/image",
    "https://example.com/\\unsafe",
  ])("rejects unsafe image source %s with the attribute path", (src) => {
    const result = visualEmailDocumentSchema.safeParse({
      content: { content: [{ attrs: { src }, type: "image" }], type: "doc" },
      version: 1,
    });

    expect(result.success).toBeFalsy();
    expect(result.error?.issues).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["content", "content", 0, "attrs", "src"],
        }),
      ])
    );
  });

  test.each([
    // oxlint-disable-next-line eslint/no-script-url -- Ensure stored visual documents reject executable URLs.
    "javascript:alert(1)",
    "file:///private/file",
    "https://example.com/\nunsafe",
    "/relative",
  ])("rejects unsafe link %s", (href) => {
    const result = visualEmailDocumentSchema.safeParse({
      content: {
        content: [
          {
            content: [
              {
                marks: [{ attrs: { href }, type: "link" }],
                text: "Link",
                type: "text",
              },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      version: 1,
    });

    expect(result.success).toBeFalsy();
    expect(result.error?.issues[0]?.path).toContain("href");
  });

  test("allows an email link with encoded subject text", () => {
    const document: VisualEmailDocument = {
      content: {
        content: [
          {
            content: [
              {
                marks: [
                  {
                    attrs: {
                      href: "mailto:person@example.com?subject=Hello%20there",
                    },
                    type: "link",
                  },
                ],
                text: "Reply",
                type: "text",
              },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      version: 1,
    };

    expect(renderVisualEmailDocument(document)).toContain(
      'href="mailto:person@example.com?subject=Hello%20there"'
    );
  });

  test("preserves apostrophes in placeholder tokens for editor hydration", () => {
    const document: VisualEmailDocument = {
      content: {
        content: [
          {
            content: [
              {
                attrs: { label: "Customer's name" },
                type: "templatePlaceholder",
              },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      version: 1,
    };

    expect(renderVisualEmailDocument(document)).toContain(
      "{{quieter:Customer's name}}"
    );
  });

  test("accepts current editor image and link attributes and renders bounded dimensions", () => {
    const document: VisualEmailDocument = {
      content: {
        content: [
          {
            attrs: {
              alt: null,
              "data-compose-inline-id": null,
              height: null,
              src: "https://example.com/default.png",
              title: null,
              width: null,
            },
            type: "image",
          },
          {
            attrs: {
              alt: "Resized",
              "data-compose-inline-id": null,
              height: "200",
              src: "https://example.com/resized.png",
              title: null,
              width: 300,
            },
            type: "image",
          },
          {
            content: [
              {
                marks: [
                  {
                    attrs: {
                      class: null,
                      href: "https://example.com",
                      rel: "noopener noreferrer nofollow",
                      target: "_blank",
                      title: null,
                    },
                    type: "link",
                  },
                ],
                text: "Link",
                type: "text",
              },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      version: 1,
    };

    const parsed = visualEmailDocumentSchema.parse(document);
    const html = renderVisualEmailDocument(parsed);

    expect(html).toContain('src="https://example.com/default.png" alt="">');
    expect(html).toContain('width="300" height="200"');
    expect(html).toContain('href="https://example.com"');
    expect(parsed.content.content).toMatchObject(document.content.content);
  });

  test.each([
    0,
    -1,
    Number.POSITIVE_INFINITY,
    "300px",
    '300" onerror="alert(1)',
  ])("rejects unsafe or invalid image dimension %s", (width) => {
    const result = visualEmailDocumentSchema.safeParse({
      content: {
        content: [
          {
            attrs: { src: "https://example.com/image.png", width },
            type: "image",
          },
        ],
        type: "doc",
      },
      version: 1,
    });

    expect(result.success).toBeFalsy();
    expect(result.error?.issues[0]?.path).toContain("width");
  });

  test.each([
    { content: { content: [{ type: "paragraph" }], type: "doc" }, version: 2 },
    { content: { content: [{ type: "heading" }], type: "doc" }, version: 1 },
    {
      content: { content: [{ text: "Root text", type: "text" }], type: "doc" },
      version: 1,
    },
    {
      content: {
        content: [{ content: [{ type: "paragraph" }], type: "bulletList" }],
        type: "doc",
      },
      version: 1,
    },
    {
      content: {
        content: [
          {
            content: [
              { content: [{ type: "horizontalRule" }], type: "listItem" },
            ],
            type: "bulletList",
          },
        ],
        type: "doc",
      },
      version: 1,
    },
    {
      content: {
        content: [
          {
            attrs: { onerror: "alert(1)", src: "https://example.com/image" },
            type: "image",
          },
        ],
        type: "doc",
      },
      version: 1,
    },
    {
      content: {
        content: [
          {
            content: [
              { attrs: { label: "First}}name" }, type: "templatePlaceholder" },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      version: 1,
    },
  ])(
    "rejects unsupported versions, nodes, nesting and attributes",
    (document) => {
      expect(visualEmailDocumentSchema.safeParse(document).success).toBeFalsy();
    }
  );

  test("rejects excessive nesting before recursive parsing", () => {
    let node: unknown = { type: "paragraph" };
    for (let index = 0; index < 10_000; index += 1) {
      node = { content: [node], type: "blockquote" };
    }

    const result = visualEmailDocumentSchema.safeParse({
      content: { content: [node], type: "doc" },
      version: 1,
    });

    expect(result.success).toBeFalsy();
    expect(result.error?.issues[0]?.message).toMatch(/nested/iu);
  });

  test("rejects oversized serialized documents and escaped output", () => {
    const serializedResult = visualEmailDocumentSchema.safeParse({
      content: {
        content: [
          {
            content: [{ text: "x".repeat(250_000), type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      version: 1,
    });
    const renderedResult = visualEmailDocumentSchema.safeParse({
      content: {
        content: [
          {
            content: [{ text: "<".repeat(30_000), type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      version: 1,
    });

    expect(serializedResult.success).toBeFalsy();
    expect(renderedResult.success).toBeFalsy();
    expect(renderedResult.error?.issues[0]?.path).toContain("content");
  });

  test("rejects excessive elements and circular input", () => {
    const circular: { content: unknown[]; type: string } = {
      content: [],
      type: "blockquote",
    };
    circular.content.push(circular);
    const circularResult = visualEmailDocumentSchema.safeParse({
      content: { content: [circular], type: "doc" },
      version: 1,
    });
    const countResult = visualEmailDocumentSchema.safeParse({
      content: {
        content: Array.from({ length: 3000 }, () => ({ type: "paragraph" })),
        type: "doc",
      },
      version: 1,
    });

    expect(circularResult.success).toBeFalsy();
    expect(circularResult.error?.issues[0]?.message).toMatch(/circular/iu);
    expect(countResult.success).toBeFalsy();
    expect(countResult.error?.issues[0]?.message).toMatch(/elements/iu);
  });
});
