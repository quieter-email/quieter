import { CssSanitizer } from "@barkleapp/css-sanitizer";
import Color, { type ColorInstance } from "color";
import DOMPurify, { type Config } from "dompurify";

const REPLACEMENT_CHARACTER_REGEX = /\uFFFD/g;
const TRACKING_PIXEL_SIZE = new Set(["0", "1"]);
const TEXT_URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/gi;
const OKLCH_COLOR_REGEX = /^oklch\(\s*(?<value>.+?)\s*\)$/i;
const SAFE_STYLE_OPTIONS = {
  allowedProperties: [
    "color",
    "background-color",
    "font-size",
    "margin",
    "padding",
    "text-align",
    "border",
    "display",
  ],
  disallowedAtRules: ["import", "keyframes"],
  disallowedFunctions: ["expression", "url"],
};
const cssSanitizer = new CssSanitizer();

export type ProcessedMailHtml = {
  hasBlockedImages: boolean;
  processedHtml: string;
};

export type MailRenderTheme = "dark" | "light";

export type LinkifiedTextSegment =
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "link";
      href: string;
      value: string;
    };

// Runs after processed mail is mounted because readable color fixes need computed DOM styles.
export const fixNonReadableColors = (
  rootElement: ParentNode,
  options?: { minContrast?: number; defaultBackground?: string },
) => {
  const { defaultBackground = "#ffffff", minContrast = 3.5 } = options || {};
  const elements = Array.from<HTMLElement>(rootElement.querySelectorAll("*"));
  if (rootElement instanceof HTMLElement) {
    elements.unshift(rootElement);
  }

  for (const element of elements) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;

    if (
      style.color.startsWith("var(") ||
      style.color === "transparent" ||
      style.color === "inherit"
    ) {
      continue;
    }

    const textColor = parseCssColor(style.color);
    if (!textColor) continue;

    const effectiveBackground = getEffectiveBackgroundColor(element, defaultBackground);
    const blendedText =
      textColor.alpha() < 1 ? effectiveBackground.mix(textColor, textColor.alpha()) : textColor;
    const contrast = blendedText.contrast(effectiveBackground);

    if (contrast < minContrast) {
      const blackContrast = Color("#000000").contrast(effectiveBackground);
      const whiteContrast = Color("#ffffff").contrast(effectiveBackground);
      element.style.color = blackContrast >= whiteContrast ? "#000000" : "#ffffff";
    }
  }
};

const getEffectiveBackgroundColor = (element: HTMLElement, defaultBackground: string) => {
  let current: HTMLElement | null = element;
  while (current) {
    const background = parseCssColor(getComputedStyle(current).backgroundColor);
    if (background && background.alpha() >= 1) return background.rgb();
    current = current.parentElement;
  }
  return Color(defaultBackground);
};

const parseCssColor = (value: string): ColorInstance | undefined => {
  const color = value.trim();
  if (!color || color.startsWith("var(") || color === "inherit") return undefined;

  try {
    return Color(color);
  } catch {
    return parseOklchColor(color);
  }
};

const parseOklchColor = (value: string): ColorInstance | undefined => {
  const match = OKLCH_COLOR_REGEX.exec(value);
  const rawValue = match?.groups?.value;
  if (!rawValue) return undefined;

  const [rawChannels, rawAlpha] = rawValue.split("/");
  if (!rawChannels) return undefined;

  const [rawLightness, rawChroma, rawHue] = rawChannels
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (!rawLightness || !rawChroma || !rawHue) return undefined;

  const lightness = parseCssColorNumber(rawLightness);
  const chroma = parseCssColorNumber(rawChroma);
  const hue = parseCssHue(rawHue);
  const alpha = rawAlpha ? parseCssColorNumber(rawAlpha.trim()) : 1;
  if (lightness === undefined || chroma === undefined || hue === undefined || alpha === undefined) {
    return undefined;
  }

  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l ** 3;
  const m3 = m ** 3;
  const s3 = s ** 3;

  return Color.rgb(
    linearSrgbToRgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    linearSrgbToRgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    linearSrgbToRgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ).alpha(clamp(alpha, 0, 1));
};

const parseCssColorNumber = (value: string): number | undefined => {
  if (value === "none") return undefined;

  if (value.endsWith("%")) {
    const percentage = Number(value.slice(0, -1));
    return Number.isFinite(percentage) ? percentage / 100 : undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const parseCssHue = (value: string): number | undefined => {
  if (value === "none") return undefined;

  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return undefined;

  if (value.endsWith("rad")) return number;
  if (value.endsWith("turn")) return number * 2 * Math.PI;
  if (value.endsWith("grad")) return (number / 200) * Math.PI;

  return (number * Math.PI) / 180;
};

const linearSrgbToRgb = (value: number): number => {
  const channel =
    value <= 0.0031308
      ? 12.92 * value
      : 1.055 * Math.abs(value) ** (1 / 2.4) * Math.sign(value) - 0.055;
  return Math.round(clamp(channel, 0, 1) * 255);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const mergeRelValues = (value: string | undefined): string => {
  const values = new Set(["noopener", "noreferrer"]);
  for (const token of value?.split(/\s+/) ?? []) {
    const normalized = token.trim().toLowerCase();
    if (normalized) values.add(normalized);
  }
  return Array.from(values).join(" ");
};

const EMAIL_SANITIZE_CONFIG: Config = {
  ADD_ATTR: [
    "align",
    "bgcolor",
    "border",
    "cellpadding",
    "cellspacing",
    "colspan",
    "height",
    "rowspan",
    "target",
    "valign",
    "width",
  ],
  ADD_TAGS: ["details", "summary", "style"],
};

const createMailRenderStyles = (theme: MailRenderTheme): string => {
  const isDarkTheme = theme === "dark";

  return `
    <style type="text/css">
      :host {
        display: block;
        line-height: 1.5;
        background-color: ${isDarkTheme ? "#1A1A1A" : "#ffffff"};
        color: ${isDarkTheme ? "#ffffff" : "#000000"};
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 0;
      }

      a {
        cursor: pointer;
        color: ${isDarkTheme ? "#60a5fa" : "#2563eb"};
        overflow-wrap: anywhere;
        text-decoration-line: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 0.14em;
      }

      table {
        border-collapse: collapse;
      }

      ::selection {
        background: #b3d4fc;
        text-shadow: none;
      }

      details.quoted-toggle {
        border-left: 2px solid ${isDarkTheme ? "#374151" : "#d1d5db"};
        padding-left: 8px;
        margin-top: 0.75rem;
      }

      details.quoted-toggle summary {
        cursor: pointer;
        color: ${isDarkTheme ? "#9CA3AF" : "#6B7280"};
        list-style: none;
        user-select: none;
      }

      details.quoted-toggle summary::-webkit-details-marker {
        display: none;
      }

      [data-theme-color="muted"] {
        color: ${isDarkTheme ? "#9CA3AF" : "#6B7280"};
      }
    </style>
  `;
};

const sanitizeEmailHtml = (rawHtml: string): string => {
  const sanitized = DOMPurify.sanitize(rawHtml, EMAIL_SANITIZE_CONFIG);
  return sanitized.replaceAll(REPLACEMENT_CHARACTER_REGEX, "");
};

const createDocument = (html: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
};

export const linkifyText = (text: string): LinkifiedTextSegment[] => {
  const segments: LinkifiedTextSegment[] = [];
  let cursor = 0;

  TEXT_URL_REGEX.lastIndex = 0;
  for (const match of text.matchAll(TEXT_URL_REGEX)) {
    const matchedText = match[0];
    const index = match.index ?? 0;
    const url = matchedText.replace(/[.,;:!?]+$/, "");
    const trailing = matchedText.slice(url.length);

    if (index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, index) });
    }

    segments.push({ kind: "link", href: url, value: url });
    if (trailing) {
      segments.push({ kind: "text", value: trailing });
    }

    cursor = index + matchedText.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }

  return segments.length ? segments : [{ kind: "text", value: text }];
};

const linkifyBareUrls = (document: Document) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    TEXT_URL_REGEX.lastIndex = 0;
    if (!TEXT_URL_REGEX.test(textNode.data)) continue;
    if (textNode.parentElement?.closest("a, style, script, textarea, title")) continue;
    nodes.push(textNode);
  }

  for (const node of nodes) {
    const fragment = document.createDocumentFragment();

    for (const segment of linkifyText(node.data)) {
      if (segment.kind === "text") {
        fragment.append(segment.value);
        continue;
      }

      const link = document.createElement("a");
      link.href = segment.href;
      link.textContent = segment.value;
      link.target = "_blank";
      link.rel = mergeRelValues(undefined);
      fragment.append(link);
    }

    node.replaceWith(fragment);
  }
};

const removePreheaderContent = (document: Document) => {
  document
    .querySelectorAll(".preheader, .preheaderText, [class*='preheader']")
    .forEach((element) => {
      const style = element.getAttribute("style") || "";
      if (
        style.includes("display:none") ||
        style.includes("display: none") ||
        style.includes("font-size:0") ||
        style.includes("font-size: 0") ||
        style.includes("line-height:0") ||
        style.includes("line-height: 0") ||
        style.includes("max-height:0") ||
        style.includes("max-height: 0") ||
        style.includes("mso-hide:all") ||
        style.includes("opacity:0") ||
        style.includes("opacity: 0")
      ) {
        element.remove();
      }
    });
};

const collapseQuoted = (document: Document, selector: string) => {
  document.querySelectorAll(selector).forEach((element) => {
    if (element.closest("details.quoted-toggle")) return;

    const details = document.createElement("details");
    details.className = "quoted-toggle";
    details.setAttribute("style", "margin-top:1em;");
    details.innerHTML = `<summary style="cursor:pointer;" data-theme-color="muted">
            Show quoted text
          </summary>
          ${element.innerHTML}`;
    element.replaceWith(details);
  });
};

const sanitizeStyleTags = (document: Document) => {
  document.querySelectorAll("style").forEach((styleElement) => {
    styleElement.textContent = cssSanitizer.sanitizeCss(
      styleElement.textContent || "",
      SAFE_STYLE_OPTIONS,
    );
  });
};

const removeTrackingPixels = (document: Document) => {
  document.querySelectorAll("img").forEach((image) => {
    const width = image.getAttribute("width");
    const height = image.getAttribute("height");
    if (width && height && TRACKING_PIXEL_SIZE.has(width) && TRACKING_PIXEL_SIZE.has(height)) {
      image.remove();
    }
  });
};

const getStyleDimension = (style: string, property: "height" | "width"): string | undefined => {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(style);
  return match?.[1]?.trim();
};

const normalizeCssSize = (value: string | undefined): string | undefined => {
  const size = value?.trim();
  if (!size) return undefined;

  if (/^\d+(?:\.\d+)?$/.test(size)) {
    return `${size}px`;
  }

  if (/^\d+(?:\.\d+)?(?:px|em|rem|%|vw|vh|vmin|vmax)$/i.test(size)) {
    return size;
  }

  return undefined;
};

const createBlockedImagePlaceholder = (
  document: Document,
  image: HTMLImageElement,
  src: string,
) => {
  const style = image.getAttribute("style") || "";
  const width = normalizeCssSize(image.getAttribute("width") || getStyleDimension(style, "width"));
  const height = normalizeCssSize(
    image.getAttribute("height") || getStyleDimension(style, "height"),
  );
  const placeholder = document.createElement("span");
  const placeholderStyles = width || height ? ["display:inline-block"] : ["display:none"];

  if (width) placeholderStyles.push(`width:${width}`);
  if (height) placeholderStyles.push(`height:${height}`);

  placeholder.setAttribute("aria-hidden", "true");
  placeholder.setAttribute("style", placeholderStyles.join(";"));
  placeholder.append(document.createComment(` blocked image: ${src} `));
  return placeholder;
};

export const preprocessEmailHtml = (html: string): string => {
  const document = createDocument(sanitizeEmailHtml(html));

  sanitizeStyleTags(document);
  collapseQuoted(document, "blockquote");
  collapseQuoted(document, ".gmail_quote");
  document.querySelectorAll("title").forEach((element) => element.remove());
  removeTrackingPixels(document);
  removePreheaderContent(document);
  linkifyBareUrls(document);

  return document.documentElement.outerHTML;
};

export const applyEmailPreferences = (
  preprocessedHtml: string,
  shouldLoadImages: boolean,
  theme: MailRenderTheme,
): ProcessedMailHtml => {
  let hasBlockedImages = false;
  const document = createDocument(preprocessedHtml);

  if (!shouldLoadImages) {
    document.querySelectorAll("img").forEach((image) => {
      const src = image.getAttribute("src");
      if (src && !src.startsWith("cid:")) {
        hasBlockedImages = true;
        image.replaceWith(createBlockedImagePlaceholder(document, image, src));
      }
    });
  }

  document.querySelectorAll("a").forEach((link) => {
    link.setAttribute("target", link.getAttribute("target") || "_blank");
    link.setAttribute("rel", mergeRelValues(link.getAttribute("rel") ?? undefined));
  });

  return {
    hasBlockedImages,
    processedHtml: `${createMailRenderStyles(theme)}${document.documentElement.outerHTML}`,
  };
};
