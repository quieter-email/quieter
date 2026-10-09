import { z } from "zod";

const remoteUrlSchema = z
  .string()
  .max(2048)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        !/^https?:\/\//iu.test(value) ||
        !["http:", "https:"].includes(url.protocol) ||
        // oxlint-disable-next-line eslint/no-control-regex -- Reject URL control characters before HTML handoff.
        /[\u0000-\u0020\\]/u.test(value)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Use an absolute web address for images.",
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use an absolute web address for images.",
      });
    }
  });

const linkUrlSchema = z
  .string()
  .max(2048)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        !/^(?:https?:\/\/|mailto:)/iu.test(value) ||
        !["http:", "https:", "mailto:"].includes(url.protocol) ||
        // oxlint-disable-next-line eslint/no-control-regex -- Reject URL control characters before HTML handoff.
        /[\u0000-\u0020\\]/u.test(value)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Use a web or email address for links.",
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use a web or email address for links.",
      });
    }
  });

const visualEmailMarkSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bold") }),
  z.strictObject({ type: z.literal("italic") }),
  z.strictObject({ type: z.literal("strike") }),
  z.strictObject({ type: z.literal("underline") }),
  z.strictObject({ type: z.literal("code") }),
  z.strictObject({
    attrs: z.strictObject({
      class: z.string().max(256).nullable().optional(),
      href: linkUrlSchema,
      rel: z.string().max(256).nullable().optional(),
      target: z
        .enum(["_blank", "_self", "_parent", "_top"])
        .nullable()
        .optional(),
      title: z.string().max(2048).nullable().optional(),
    }),
    type: z.literal("link"),
  }),
]);

const visualEmailMarksSchema = z
  .array(visualEmailMarkSchema)
  .max(6)
  .superRefine((marks, ctx) => {
    if (new Set(marks.map((mark) => mark.type)).size !== marks.length) {
      ctx.addIssue({
        code: "custom",
        message: "Apply each text format only once.",
      });
    }
    if (marks.length > 1 && marks.some((mark) => mark.type === "code")) {
      ctx.addIssue({
        code: "custom",
        message: "Code text cannot include other formats.",
      });
    }
  });

const visualEmailTextSchema = z.strictObject({
  marks: visualEmailMarksSchema.optional(),
  text: z.string().min(1),
  type: z.literal("text"),
});

const visualEmailInlineSchema = z.discriminatedUnion("type", [
  visualEmailTextSchema,
  z.strictObject({
    marks: visualEmailMarksSchema.optional(),
    type: z.literal("hardBreak"),
  }),
  z.strictObject({
    attrs: z.strictObject({
      label: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[^{}<>&"\r\n]+$/u, "Use plain text for placeholder names.")
        .refine((label) => label === label.trim(), {
          message: "Remove spaces around the placeholder name.",
        }),
    }),
    marks: visualEmailMarksSchema.optional(),
    type: z.literal("templatePlaceholder"),
  }),
]);

const visualEmailParagraphSchema = z.strictObject({
  content: z.array(visualEmailInlineSchema).optional(),
  type: z.literal("paragraph"),
});

const imageDimensionSchema = z
  .union([
    z.number().positive().max(10_000),
    z
      .string()
      .max(16)
      .regex(/^\d+(?:\.\d+)?$/u)
      .refine((value) => Number(value) > 0 && Number(value) <= 10_000, {
        message: "Use a positive image dimension up to 10000.",
      }),
  ])
  .nullable()
  .optional();

type VisualEmailInline = z.infer<typeof visualEmailInlineSchema>;
type VisualEmailParagraph = z.infer<typeof visualEmailParagraphSchema>;
type VisualEmailBlock =
  | VisualEmailParagraph
  | { type: "blockquote"; content: VisualEmailBlock[] }
  | {
      type: "codeBlock";
      attrs?: { language?: string | null };
      content?: { type: "text"; text: string }[];
    }
  | { type: "bulletList"; content: VisualEmailListItem[] }
  | {
      type: "orderedList";
      attrs?: {
        start?: number;
        type?: "1" | "a" | "A" | "i" | "I" | null;
      };
      content: VisualEmailListItem[];
    }
  | {
      type: "image";
      attrs: {
        src: string;
        alt?: string | null;
        title?: string | null;
        "data-compose-inline-id"?: string | null;
        height?: string | number | null;
        width?: string | number | null;
      };
    }
  | { type: "horizontalRule" };
type VisualEmailListItem = {
  type: "listItem";
  content: [VisualEmailParagraph, ...VisualEmailBlock[]];
};

const visualEmailBlockSchema: z.ZodType<VisualEmailBlock> = z.lazy(() => {
  const listItemSchema = z.strictObject({
    content: z.tuple([visualEmailParagraphSchema]).rest(visualEmailBlockSchema),
    type: z.literal("listItem"),
  });

  return z.discriminatedUnion("type", [
    visualEmailParagraphSchema,
    z.strictObject({
      content: z.array(visualEmailBlockSchema).min(1),
      type: z.literal("blockquote"),
    }),
    z.strictObject({
      attrs: z
        .strictObject({ language: z.string().max(80).nullable().optional() })
        .optional(),
      content: z
        .array(
          z.strictObject({ text: z.string().min(1), type: z.literal("text") })
        )
        .optional(),
      type: z.literal("codeBlock"),
    }),
    z.strictObject({
      content: z.array(listItemSchema).min(1),
      type: z.literal("bulletList"),
    }),
    z.strictObject({
      attrs: z
        .strictObject({
          start: z.number().int().min(1).max(1_000_000).optional(),
          type: z.enum(["1", "a", "A", "i", "I"]).nullable().optional(),
        })
        .optional(),
      content: z.array(listItemSchema).min(1),
      type: z.literal("orderedList"),
    }),
    z.strictObject({
      attrs: z.strictObject({
        alt: z.string().max(2048).nullable().optional(),
        "data-compose-inline-id": z.string().max(256).nullable().optional(),
        height: imageDimensionSchema,
        src: remoteUrlSchema,
        title: z.string().max(2048).nullable().optional(),
        width: imageDimensionSchema,
      }),
      type: z.literal("image"),
    }),
    z.strictObject({ type: z.literal("horizontalRule") }),
  ]);
});

const visualEmailContentSchema = z.strictObject({
  content: z.array(visualEmailBlockSchema).min(1),
  type: z.literal("doc"),
});

export type VisualEmailDocument = {
  version: 1;
  content: z.infer<typeof visualEmailContentSchema>;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderInline = (node: VisualEmailInline): string => {
  let html: string;
  switch (node.type) {
    case "text": {
      html = escapeHtml(node.text);
      break;
    }
    case "hardBreak": {
      html = "<br>";
      break;
    }
    case "templatePlaceholder": {
      html = `{{quieter:${node.attrs.label}}}`;
      break;
    }
    default: {
      node satisfies never;
      throw new Error("Unsupported email content.");
    }
  }

  for (const mark of node.marks?.toReversed() ?? []) {
    switch (mark.type) {
      case "bold": {
        html = `<strong>${html}</strong>`;
        break;
      }
      case "italic": {
        html = `<em>${html}</em>`;
        break;
      }
      case "strike": {
        html = `<s>${html}</s>`;
        break;
      }
      case "underline": {
        html = `<u>${html}</u>`;
        break;
      }
      case "code": {
        html = `<code>${html}</code>`;
        break;
      }
      case "link": {
        const { href, target, title } = mark.attrs;
        const attributes = [`href="${escapeHtml(href)}"`];
        if (target) {
          attributes.push(`target="${target}"`);
        }
        attributes.push('rel="noopener noreferrer"');
        if (title) {
          attributes.push(`title="${escapeHtml(title)}"`);
        }
        html = `<a ${attributes.join(" ")}>${html}</a>`;
        break;
      }
      default: {
        mark satisfies never;
        throw new Error("Unsupported text format.");
      }
    }
  }
  return html;
};

const renderBlock = (node: VisualEmailBlock): string => {
  switch (node.type) {
    case "paragraph": {
      return `<p>${node.content?.map(renderInline).join("") ?? ""}</p>`;
    }
    case "blockquote": {
      return `<blockquote>${node.content.map(renderBlock).join("")}</blockquote>`;
    }
    case "codeBlock": {
      return `<pre><code>${node.content?.map((text) => escapeHtml(text.text)).join("") ?? ""}</code></pre>`;
    }
    case "bulletList":
    case "orderedList": {
      const tag = node.type === "bulletList" ? "ul" : "ol";
      const attributes: string[] = [];
      if (node.type === "orderedList") {
        if (node.attrs?.start !== undefined && node.attrs.start !== 1) {
          attributes.push(`start="${node.attrs.start}"`);
        }
        if (node.attrs?.type) {
          attributes.push(`type="${node.attrs.type}"`);
        }
      }
      const items = node.content
        .map((item) => `<li>${item.content.map(renderBlock).join("")}</li>`)
        .join("");
      return `<${tag}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}>${items}</${tag}>`;
    }
    case "image": {
      const attributes = [
        `src="${escapeHtml(node.attrs.src)}"`,
        `alt="${escapeHtml(node.attrs.alt ?? "")}"`,
      ];
      if (node.attrs.title) {
        attributes.push(`title="${escapeHtml(node.attrs.title)}"`);
      }
      if (node.attrs.width !== null && node.attrs.width !== undefined) {
        attributes.push(`width="${node.attrs.width}"`);
      }
      if (node.attrs.height !== null && node.attrs.height !== undefined) {
        attributes.push(`height="${node.attrs.height}"`);
      }
      return `<img ${attributes.join(" ")}>`;
    }
    case "horizontalRule": {
      return "<hr>";
    }
    default: {
      node satisfies never;
      throw new Error("Unsupported email content.");
    }
  }
};

const boundedDocumentSchema = z.unknown().superRefine((document, ctx) => {
  const stack: (
    | {
        kind: "visit";
        value: unknown;
        depth: number;
        path: (string | number)[];
      }
    | { kind: "leave"; value: object }
  )[] = [{ depth: 0, kind: "visit", path: [], value: document }];
  const ancestors = new WeakSet<object>();
  let count = 0;
  let elementCount = 0;
  let textLength = 0;

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      break;
    }
    if (item.kind === "leave") {
      ancestors.delete(item.value);
      continue;
    }
    count += 1;
    if (item.depth > 64 || count > 20_000) {
      ctx.addIssue({
        code: "custom",
        message: "This email has too many nested elements.",
        path: item.path,
      });
      return;
    }
    if (typeof item.value === "string") {
      textLength += item.value.length;
      if (textLength > 200_000) {
        ctx.addIssue({
          code: "custom",
          message: "This email is too large to save.",
          path: item.path,
        });
        return;
      }
    }
    if (typeof item.value !== "object" || item.value === null) {
      continue;
    }
    if (ancestors.has(item.value)) {
      ctx.addIssue({
        code: "custom",
        message: "This email contains circular elements.",
        path: item.path,
      });
      return;
    }
    ancestors.add(item.value);
    stack.push({ kind: "leave", value: item.value });
    if (!Array.isArray(item.value)) {
      elementCount += 1;
      if (elementCount > 2000) {
        ctx.addIssue({
          code: "custom",
          message: "This email has too many elements.",
          path: item.path,
        });
        return;
      }
    }
    const entries: [string, unknown][] = Object.entries(item.value);
    if (entries.length > 2000) {
      ctx.addIssue({
        code: "custom",
        message: "This email has too many elements.",
        path: item.path,
      });
      return;
    }
    for (const [key, value] of entries) {
      stack.push({
        depth: item.depth + 1,
        kind: "visit",
        path: [...item.path, Array.isArray(item.value) ? Number(key) : key],
        value,
      });
    }
  }

  try {
    const serialized = JSON.stringify(document);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > 200_000
    ) {
      ctx.addIssue({
        code: "custom",
        message: "This email is too large to save.",
      });
    }
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "This email contains invalid elements.",
    });
  }
});

export const visualEmailDocumentSchema = boundedDocumentSchema
  .pipe(
    z.strictObject({ content: visualEmailContentSchema, version: z.literal(1) })
  )
  .superRefine((document, ctx) => {
    if (document.content.content.map(renderBlock).join("").length > 100_000) {
      ctx.addIssue({
        code: "custom",
        message: "This email is too large to save.",
        path: ["content"],
      });
    }
  });

export const renderVisualEmailDocument = (
  document: VisualEmailDocument
): string =>
  visualEmailDocumentSchema
    .parse(document)
    .content.content.map(renderBlock)
    .join("");
