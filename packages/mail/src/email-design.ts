import generate from "css-tree/generator";
import parseCss from "css-tree/parser";
import { ident } from "css-tree/utils";
import walkCss from "css-tree/walker";
import { html as htmlNamespace, parse, parseFragment } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";

const colorSchema = z.string().regex(/^#[\da-f]{6}$/iu);
const alignmentSchema = z.enum(["left", "center", "right"]);
const idSchema = z.string().min(1).max(80);

const linkSchema = z
  .string()
  .max(2048)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        !/^(?:https?:\/\/|mailto:)/iu.test(value) ||
        !["https:", "http:", "mailto:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        // oxlint-disable-next-line eslint/no-control-regex -- Reject controls before URL normalization can hide them.
        /[\u0000-\u0020\\]/u.test(value)
      ) {
        throw new Error("Invalid URL");
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Use an absolute web or email address.",
      });
    }
  });

const imageSchema = linkSchema.refine((value) => /^https:\/\//iu.test(value), {
  message: "Images must use an absolute HTTPS address.",
});

export const emailThemeSchema = z.strictObject({
  backgroundColor: colorSchema,
  borderRadius: z.number().int().min(0).max(32),
  canvasColor: colorSchema,
  fontFamily: z.enum(["sans", "serif", "mono"]),
  mutedColor: colorSchema,
  padding: z.number().int().min(0).max(64),
  primaryColor: colorSchema,
  primaryTextColor: colorSchema,
  textColor: colorSchema,
  width: z.number().int().min(480).max(800),
});

const emailBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({
    align: alignmentSchema,
    id: idSchema,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().max(1000),
    type: z.literal("heading"),
  }),
  z.strictObject({
    align: alignmentSchema,
    id: idSchema,
    text: z.string().max(20_000),
    type: z.literal("text"),
  }),
  z.strictObject({
    alt: z.string().max(1000),
    href: linkSchema.optional(),
    id: idSchema,
    src: imageSchema,
    type: z.literal("image"),
    width: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    align: alignmentSchema,
    href: linkSchema,
    id: idSchema,
    text: z.string().max(200),
    type: z.literal("button"),
  }),
  z.strictObject({ id: idSchema, type: z.literal("divider") }),
  z.strictObject({
    height: z.number().int().min(0).max(160),
    id: idSchema,
    type: z.literal("spacer"),
  }),
]);

export const emailDesignSchema = z
  .strictObject({
    blocks: z.array(emailBlockSchema).max(100),
    preheader: z.string().max(300),
    theme: emailThemeSchema,
    version: z.literal(2),
  })
  .superRefine((design, context) => {
    if (
      new Set(design.blocks.map((block) => block.id)).size !==
      design.blocks.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Each email block must have a unique ID.",
        path: ["blocks"],
      });
    }
    if (new TextEncoder().encode(JSON.stringify(design)).byteLength > 100_000) {
      context.addIssue({
        code: "custom",
        message: "This email design is too large.",
      });
    }
  });

export type EmailTheme = z.infer<typeof emailThemeSchema>;
export type EmailBlock = z.infer<typeof emailBlockSchema>;
export type EmailDesign = z.infer<typeof emailDesignSchema>;

const safeTags = new Set([
  "html",
  "head",
  "body",
  "title",
  "meta",
  "link",
  "style",
  "div",
  "span",
  "p",
  "a",
  "img",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "small",
  "big",
  "sub",
  "sup",
  "font",
  "center",
  "blockquote",
  "pre",
  "code",
  "abbr",
  "address",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "v:rect",
  "v:roundrect",
  "v:fill",
  "v:textbox",
  "v:stroke",
  "w:anchorlock",
  "o:officedocumentsettings",
  "o:allowpng",
  "o:pixelsperinch",
]);
const safeAttributes = new Set([
  "id",
  "class",
  "style",
  "title",
  "lang",
  "dir",
  "role",
  "align",
  "valign",
  "width",
  "height",
  "border",
  "cellpadding",
  "cellspacing",
  "bgcolor",
  "color",
  "size",
  "face",
  "colspan",
  "rowspan",
  "scope",
  "headers",
  "summary",
  "alt",
  "href",
  "src",
  "background",
  "target",
  "rel",
  "name",
  "content",
  "charset",
  "http-equiv",
  "as",
  "type",
  "start",
  "reversed",
  "value",
  "nowrap",
  "hidden",
  "xmlns",
  "xmlns:v",
  "xmlns:o",
  "xmlns:w",
  "arcsize",
  "fillcolor",
  "strokecolor",
  "strokeweight",
  "filled",
  "stroked",
  "inset",
  "opacity",
  "aspect",
  "origin",
  "position",
  "coordsize",
  "coordorigin",
]);

const inspectCss = (
  source: string,
  context: "stylesheet" | "declarationList",
  warnings: Set<string>,
  documentRoot = false
): void => {
  const tree = parseCss(source, {
    context,
    onParseError: () => {
      throw new Error("This HTML contains CSS that could not be validated.");
    },
    parseCustomProperty: true,
  });
  walkCss(tree, (node) => {
    if (documentRoot && node.type === "Declaration") {
      const property = ident.decode(node.property).toLowerCase();
      const value = ident.decode(generate(node.value)).toLowerCase();
      if (
        (property === "display" && value === "none") ||
        (property === "visibility" && ["hidden", "collapse"].includes(value)) ||
        (property === "content-visibility" && value === "hidden") ||
        (property === "opacity" && Number(value) === 0)
      ) {
        throw new Error("The email document must remain visible.");
      }
    }
    if (
      node.type === "Raw" ||
      (node.type === "Function" &&
        ["expression", "url"].includes(
          ident.decode(node.name).toLowerCase()
        )) ||
      (node.type === "Declaration" &&
        ["behavior", "-ms-behavior", "-moz-binding", "-o-link"].includes(
          ident.decode(node.property).toLowerCase()
        )) ||
      (node.type === "Atrule" &&
        ident.decode(node.name).toLowerCase() === "import")
    ) {
      throw new Error("This HTML contains unsupported or active CSS.");
    }
    if (node.type === "Url") {
      if (!imageSchema.safeParse(node.value).success) {
        throw new Error(
          "CSS images and fonts must use absolute HTTPS addresses."
        );
      }
      warnings.add("External images and fonts may be blocked by email apps.");
    }
  });
};

const inspectHtml = (html: string): string[] => {
  const warnings = new Set<string>();
  const tree = parse(html);
  const stack: { node: DefaultTreeAdapterTypes.Node; depth: number }[] = [
    { depth: 0, node: tree },
  ];
  let count = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      break;
    }
    const { node, depth } = item;
    count += 1;
    if (count > 4000 || depth > 64) {
      throw new Error("This HTML contains too many nested elements.");
    }
    if ("tagName" in node) {
      if (
        node.namespaceURI !== htmlNamespace.NS.HTML ||
        !safeTags.has(node.tagName)
      ) {
        throw new Error(
          "This HTML contains an element that is not supported in emails."
        );
      }
      for (const attribute of node.attrs) {
        const name = attribute.name.toLowerCase();
        if (
          name.startsWith("on") ||
          attribute.namespace ||
          (!safeAttributes.has(name) &&
            !name.startsWith("aria-") &&
            !name.startsWith("data-"))
        ) {
          throw new Error(
            "This HTML contains an attribute that is not supported in emails."
          );
        }
        if (name === "href" && !linkSchema.safeParse(attribute.value).success) {
          throw new Error(
            "Email links must use absolute web or email addresses."
          );
        }
        if (["src", "background"].includes(name)) {
          if (!imageSchema.safeParse(attribute.value).success) {
            throw new Error("Email images must use absolute HTTPS addresses.");
          }
          warnings.add("External images may be blocked by email apps.");
        }
        if (name === "style") {
          inspectCss(
            attribute.value,
            "declarationList",
            warnings,
            ["html", "body"].includes(node.tagName)
          );
          warnings.add(
            "Custom CSS support varies between email apps. Send a test before publishing."
          );
        }
        if (name === "hidden" && ["html", "body"].includes(node.tagName)) {
          throw new Error("The email document must remain visible.");
        }
      }
      if (node.tagName === "meta") {
        const directive = node.attrs.find(
          (attribute) => attribute.name === "http-equiv"
        );
        if (
          directive &&
          !["content-type", "x-ua-compatible"].includes(
            directive.value.toLowerCase()
          )
        ) {
          throw new Error("Active metadata is not supported in email HTML.");
        }
      }
      if (node.tagName === "link") {
        const relationship = node.attrs
          .find((attribute) => attribute.name === "rel")
          ?.value.toLowerCase();
        const destination = node.attrs
          .find((attribute) => attribute.name === "as")
          ?.value.toLowerCase();
        const href = node.attrs.find(
          (attribute) => attribute.name === "href"
        )?.value;
        if (
          !imageSchema.safeParse(href).success ||
          (relationship !== "stylesheet" &&
            !(relationship === "preload" && destination === "image"))
        ) {
          throw new Error(
            "Only HTTPS stylesheets and image preloads are supported in email HTML."
          );
        }
        warnings.add(
          "External images and stylesheets may be blocked by email apps."
        );
      }
      if (node.tagName === "style") {
        inspectCss(
          node.childNodes
            .map((child) => ("value" in child ? child.value : ""))
            .join(""),
          "stylesheet",
          warnings
        );
        warnings.add(
          "Custom CSS support varies between email apps. Send a test before publishing."
        );
      }
    }
    if (
      "data" in node &&
      node.nodeName === "#comment" &&
      node.data.includes("<")
    ) {
      // Outlook conditional comments contain real markup in some email clients.
      const conditional = parseFragment(node.data);
      stack.push({ depth: depth + 1, node: conditional });
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes) {
        stack.push({ depth: depth + 1, node: child });
      }
    }
  }
  return [...warnings];
};

const htmlSchema = z
  .string()
  .max(200_000)
  .superRefine((html, context) => {
    if (new TextEncoder().encode(html).byteLength > 200_000) {
      context.addIssue({
        code: "custom",
        message: "This HTML is too large to save.",
      });
      return;
    }
    try {
      inspectHtml(html);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "This HTML is not supported.",
      });
    }
  });

export const emailContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string().max(100_000) }),
  z.strictObject({ design: emailDesignSchema, kind: z.literal("visual") }),
  z.strictObject({
    html: htmlSchema,
    kind: z.literal("html"),
    text: z.string().max(100_000),
  }),
]);
export type EmailContent = z.infer<typeof emailContentSchema>;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const fonts = {
  mono: "'Courier New',Courier,monospace",
  sans: "Arial,Helvetica,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
};

const renderDesign = (
  design: EmailDesign
): { html: string; text: string; warnings: string[] } => {
  const { theme } = design;
  const plain: string[] = [];
  const rows = design.blocks
    .map((block) => {
      let html: string;
      switch (block.type) {
        case "heading": {
          plain.push(block.text);
          html = `<h${block.level} style="margin:0;font-size:${[32, 24, 20][block.level - 1]}px;line-height:1.25;font-weight:700;text-align:${block.align};color:${theme.textColor}">${escapeHtml(block.text).replaceAll("\n", "<br>")}</h${block.level}>`;
          break;
        }
        case "text": {
          plain.push(block.text);
          html = `<p style="margin:0;font-size:16px;line-height:1.6;text-align:${block.align};color:${theme.textColor}">${escapeHtml(block.text).replaceAll("\n", "<br>")}</p>`;
          break;
        }
        case "image": {
          plain.push(
            [block.alt, block.href ?? block.src].filter(Boolean).join("\n")
          );
          const width = Math.round(
            ((theme.width - theme.padding * 2) * block.width) / 100
          );
          html = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" width="${width}" style="display:block;width:${block.width}%;max-width:100%;height:auto;border:0;margin:0 auto">`;
          if (block.href) {
            html = `<a href="${escapeHtml(block.href)}" rel="noopener noreferrer">${html}</a>`;
          }
          break;
        }
        case "button": {
          plain.push(`${block.text}\n${block.href}`);
          html = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${block.align}"><tr><td align="center" bgcolor="${theme.primaryColor}" style="border-radius:${theme.borderRadius}px;mso-padding-alt:12px 24px"><a href="${escapeHtml(block.href)}" rel="noopener noreferrer" style="display:inline-block;padding:12px 24px;border-radius:${theme.borderRadius}px;background-color:${theme.primaryColor};color:${theme.primaryTextColor};font-size:16px;line-height:1.5;font-weight:700;text-decoration:none">${escapeHtml(block.text)}</a></td></tr></table>`;
          break;
        }
        case "divider": {
          html = `<hr style="margin:0;border:0;border-top:1px solid ${theme.mutedColor}">`;
          break;
        }
        case "spacer": {
          return `<tr><td height="${block.height}" style="height:${block.height}px;font-size:0;line-height:0">&#8203;</td></tr>`;
        }
        default: {
          block satisfies never;
          throw new Error("Unsupported email block.");
        }
      }
      return `<tr><td style="padding:0 0 24px;overflow-wrap:break-word">${html}</td></tr>`;
    })
    .join("");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title></head><body style="margin:0;padding:0;background-color:${theme.backgroundColor};font-family:${fonts[theme.fontFamily]};color:${theme.textColor}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(design.preheader)}</div><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${theme.backgroundColor}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="${theme.width}" border="0" cellpadding="0" cellspacing="0" bgcolor="${theme.canvasColor}" style="width:100%;max-width:${theme.width}px;background-color:${theme.canvasColor};border-radius:${theme.borderRadius}px"><tr><td style="padding:${theme.padding}px"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table></td></tr></table></body></html>`;
  return {
    html,
    text: plain.join("\n\n"),
    warnings: design.blocks.some((block) => block.type === "image")
      ? ["External images may be blocked by email apps."]
      : [],
  };
};

const emailNodeText = (
  node: DefaultTreeAdapterTypes.Node,
  preserveWhitespace = false
): string => {
  if ("value" in node) {
    return preserveWhitespace
      ? node.value
      : node.value.replaceAll(/\s+/gu, " ");
  }
  if (!("childNodes" in node)) {
    return "";
  }
  if (!("tagName" in node)) {
    return node.childNodes
      .map((child) => emailNodeText(child, preserveWhitespace))
      .join("");
  }
  if (["head", "style", "title", "script"].includes(node.tagName)) {
    return "";
  }
  let hidden = node.attrs.some(
    (attribute) =>
      attribute.name === "hidden" ||
      (attribute.name === "aria-hidden" &&
        attribute.value.toLowerCase() === "true")
  );
  const style = node.attrs.find(
    (attribute) => attribute.name === "style"
  )?.value;
  if (style && !hidden) {
    walkCss(
      parseCss(style, {
        context: "declarationList",
        parseCustomProperty: true,
      }),
      (declaration) => {
        if (declaration.type !== "Declaration") {
          return;
        }
        const property = ident.decode(declaration.property).toLowerCase();
        const value = ident.decode(generate(declaration.value)).toLowerCase();
        hidden ||=
          (property === "display" && value === "none") ||
          (property === "visibility" &&
            ["hidden", "collapse"].includes(value)) ||
          (property === "opacity" && ["0", "0%"].includes(value)) ||
          (property === "content-visibility" && value === "hidden") ||
          (property === "mso-hide" && value === "all");
      }
    );
  }
  if (hidden) {
    return "";
  }
  if (node.tagName === "br") {
    return "\n";
  }
  if (node.tagName === "img") {
    return (
      node.attrs.find((attribute) => attribute.name === "alt")?.value ?? ""
    );
  }
  const content = node.childNodes
    .map((child) =>
      emailNodeText(child, preserveWhitespace || node.tagName === "pre")
    )
    .join("");
  if (node.tagName === "a") {
    const href = node.attrs.find(
      (attribute) => attribute.name === "href"
    )?.value;
    if (href && href !== content.trim()) {
      return content.trim() ? `${content.trim()} (${href})` : href;
    }
  }
  if (node.tagName === "li") {
    return `\n- ${content.trim()}\n`;
  }
  if (["td", "th"].includes(node.tagName)) {
    return `${content}\t`;
  }
  if (node.tagName === "tr") {
    return `${content}\n`;
  }
  if (
    [
      "p",
      "div",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "section",
      "article",
      "header",
      "footer",
      "main",
      "blockquote",
      "pre",
      "ul",
      "ol",
      "table",
      "hr",
    ].includes(node.tagName)
  ) {
    return `\n\n${content}\n\n`;
  }
  return content;
};

export const renderEmailContent = (
  content: EmailContent
): { html: string | null; text: string; warnings: string[] } => {
  const validated = emailContentSchema.parse(content);
  switch (validated.kind) {
    case "text": {
      return { html: null, text: validated.text, warnings: [] };
    }
    case "html": {
      return {
        html: validated.html,
        text: validated.text.trim()
          ? validated.text
          : emailNodeText(parse(validated.html))
              .split("\n")
              .map((line) => line.trim())
              .join("\n")
              .replaceAll(/\n{3,}/gu, "\n\n")
              .trim(),
        warnings: inspectHtml(validated.html),
      };
    }
    case "visual": {
      return renderDesign(validated.design);
    }
    default: {
      validated satisfies never;
      throw new Error("Unsupported email content.");
    }
  }
};

export const createEmailDesign = (): EmailDesign => ({
  blocks: [
    {
      align: "left",
      id: "intro-heading",
      level: 1,
      text: "A little update from us",
      type: "heading",
    },
    {
      align: "left",
      id: "intro-text",
      text: "We have been working on a few thoughtful improvements. Here is what is new, and what it means for you.",
      type: "text",
    },
    {
      align: "left",
      id: "update-heading",
      level: 2,
      text: "More room for what matters",
      type: "heading",
    },
    {
      align: "left",
      id: "update-text",
      text: "Share your latest news here. Keep it useful, keep it personal, and give your readers one clear next step.",
      type: "text",
    },
  ],
  preheader: "A few thoughtful improvements, made for you.",
  theme: {
    backgroundColor: "#F3F2EF",
    borderRadius: 12,
    canvasColor: "#FFFFFF",
    fontFamily: "sans",
    mutedColor: "#A8A6A0",
    padding: 40,
    primaryColor: "#294D43",
    primaryTextColor: "#FFFFFF",
    textColor: "#262824",
    width: 600,
  },
  version: 2,
});

const colorTokenValueSchema = z.union([
  colorSchema,
  z.strictObject({
    alpha: z.literal(1).optional(),
    colorSpace: z.literal("srgb"),
    components: z.tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ]),
    hex: colorSchema.optional(),
  }),
]);

export const importEmailTheme = (input: unknown): EmailTheme => {
  const flat = emailThemeSchema.safeParse(input);
  if (flat.success) {
    return flat.data;
  }
  const tokens = z.record(z.string(), z.unknown()).parse(input);
  if (
    !Object.values(tokens).some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        ("$type" in value || "$value" in value)
    )
  ) {
    throw flat.error;
  }
  const output: Record<string, unknown> = {};
  const keys = new Set(Object.keys(emailThemeSchema.shape));
  for (const [name, value] of Object.entries(tokens)) {
    if (!keys.has(name)) {
      throw new Error(`Unsupported theme token: ${name}.`);
    }
    if (name.endsWith("Color")) {
      const token = z
        .strictObject({
          $description: z.string().max(1000).optional(),
          $type: z.literal("color"),
          $value: colorTokenValueSchema,
        })
        .parse(value);
      if (typeof token.$value === "string") {
        output[name] = token.$value;
      } else {
        const color = `#${token.$value.components
          .map((component) =>
            Math.round(component * 255)
              .toString(16)
              .padStart(2, "0")
          )
          .join("")}`;
        if (token.$value.hex && token.$value.hex.toLowerCase() !== color) {
          throw new Error(`Conflicting color values for ${name}.`);
        }
        output[name] = color;
      }
    } else if (name === "fontFamily") {
      output[name] = z
        .strictObject({
          $description: z.string().max(1000).optional(),
          $type: z.literal("fontFamily"),
          $value: emailThemeSchema.shape.fontFamily,
        })
        .parse(value).$value;
    } else {
      output[name] = z
        .strictObject({
          $description: z.string().max(1000).optional(),
          $type: z.literal("number"),
          $value: z.number(),
        })
        .parse(value).$value;
    }
  }
  return emailThemeSchema.parse(output);
};

export const exportEmailDesign = (
  input: EmailDesign
): {
  html: string;
  text: string;
  react: string;
  document: EmailDesign;
  warnings: string[];
} => {
  const design = emailDesignSchema.parse(input);
  const rendered = renderDesign(design);
  // JSON string literals keep user text inert inside the exported source file.
  const source = JSON.stringify(design, null, 2)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const react = `import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from "react-email";

const design = ${source} as const;
const fonts = { sans: "Arial,Helvetica,sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "'Courier New',Courier,monospace" };
const theme = design.theme;
type Block = { id: string } & (
  | { type: "heading"; text: string; level: 1 | 2 | 3; align: "left" | "center" | "right" }
  | { type: "text"; text: string; align: "left" | "center" | "right" }
  | { type: "image"; src: string; alt: string; href?: string; width: number }
  | { type: "button"; text: string; href: string; align: "left" | "center" | "right" }
  | { type: "divider" }
  | { type: "spacer"; height: number }
);
const blocks: readonly Block[] = design.blocks;

export default function Email() {
  return (
    <Html lang="en">
      <Head />
      <Preview>{design.preheader}</Preview>
      <Body style={{ margin: 0, backgroundColor: theme.backgroundColor, color: theme.textColor, fontFamily: fonts[theme.fontFamily], padding: "24px 12px" }}>
        <Container style={{ width: "100%", maxWidth: theme.width, backgroundColor: theme.canvasColor, borderRadius: theme.borderRadius, padding: theme.padding }}>
          {blocks.map((block) => {
            switch (block.type) {
              case "heading": return <Heading key={block.id} as={\`h\${block.level}\`} style={{ margin: "0 0 24px", fontSize: [32, 24, 20][block.level - 1], lineHeight: "1.25", textAlign: block.align, whiteSpace: "pre-line" }}>{block.text}</Heading>;
              case "text": return <Text key={block.id} style={{ margin: "0 0 24px", fontSize: 16, lineHeight: "1.6", textAlign: block.align, whiteSpace: "pre-line" }}>{block.text}</Text>;
              case "image": {
                const image = <Img src={block.src} alt={block.alt} width={Math.round((theme.width - theme.padding * 2) * block.width / 100)} style={{ width: \`\${block.width}%\`, maxWidth: "100%", height: "auto", margin: "0 auto 24px", display: "block" }} />;
                return block.href ? <Link key={block.id} href={block.href}>{image}</Link> : <React.Fragment key={block.id}>{image}</React.Fragment>;
              }
              case "button": return <Section key={block.id} style={{ textAlign: block.align, marginBottom: 24 }}><Button href={block.href} style={{ padding: "12px 24px", backgroundColor: theme.primaryColor, color: theme.primaryTextColor, borderRadius: theme.borderRadius, fontWeight: 700, fontSize: 16, lineHeight: "1.5" }}>{block.text}</Button></Section>;
              case "divider": return <Hr key={block.id} style={{ border: 0, borderTop: \`1px solid \${theme.mutedColor}\`, margin: "0 0 24px" }} />;
              case "spacer": return <Section key={block.id}><div style={{ height: block.height, fontSize: 0, lineHeight: 0 }}>&#8203;</div></Section>;
            }
          })}
        </Container>
      </Body>
    </Html>
  );
}
`;
  return { ...rendered, document: design, react };
};

export const appendEmailUnsubscribe = (html: string, url: string): string => {
  const href = linkSchema.parse(url);
  const visible =
    "visibility:visible!important;opacity:1!important;content-visibility:visible!important;height:auto!important;max-height:none!important;overflow:visible!important;clip:auto!important;clip-path:none!important;transform:none!important";
  const footer = `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="${visible};display:table!important;width:100%!important;background-color:#ffffff!important"><tr style="${visible};display:table-row!important"><td align="center" style="${visible};display:table-cell!important;padding:24px!important;text-align:center!important"><a href="${escapeHtml(href)}" rel="noopener noreferrer" style="${visible};display:inline-block!important;font-family:Arial,Helvetica,sans-serif!important;font-size:12px!important;line-height:1.5!important;color:#555555!important;text-decoration:underline!important;pointer-events:auto!important">Unsubscribe</a></td></tr></table>`;
  const tree = parse(html, { sourceCodeLocationInfo: true });
  const stack: DefaultTreeAdapterTypes.Node[] = [tree];
  let insertion = html.length;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      break;
    }
    if (
      "tagName" in node &&
      ["body", "html"].includes(node.tagName) &&
      node.sourceCodeLocation?.endTag
    ) {
      insertion = Math.min(
        insertion,
        node.sourceCodeLocation.endTag.startOffset
      );
    }
    if (
      node.sourceCodeLocation &&
      (("tagName" in node &&
        ["style", "title"].includes(node.tagName) &&
        !node.sourceCodeLocation.endTag) ||
        (node.nodeName === "#comment" &&
          node.sourceCodeLocation.endOffset >= html.length))
    ) {
      insertion = Math.min(insertion, node.sourceCodeLocation.startOffset);
    }
    if ("childNodes" in node) {
      stack.push(...node.childNodes);
    }
  }
  return `${html.slice(0, insertion)}${footer}${html.slice(insertion)}`;
};
