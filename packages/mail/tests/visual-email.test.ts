import { describe, expect, test } from "vite-plus/test";

import {
  renderVisualEmailDocument,
  visualEmailDocumentSchema,
} from "../src/visual-email";
import type { VisualEmailDocument } from "../src/visual-email";

describe("visual email documents", () => {
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
