import { CssSanitizer } from "@barkleapp/css-sanitizer";
import Color from "color";
import sanitizeHtml, { type IOptions } from "sanitize-html";

const REPLACEMENT_CHARACTER_REGEX = /\uFFFD/g;
const TRACKING_PIXEL_SIZE = new Set(["0", "1"]);
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

    try {
      const textColor = Color(style.color);
      const effectiveBackground = getEffectiveBackgroundColor(element, defaultBackground);
      const blendedText =
        textColor.alpha() < 1
          ? effectiveBackground.mix(textColor, effectiveBackground.alpha())
          : textColor;
      const contrast = blendedText.contrast(effectiveBackground);

      if (contrast < minContrast) {
        const blackContrast = Color("#000000").contrast(effectiveBackground);
        const whiteContrast = Color("#ffffff").contrast(effectiveBackground);
        element.style.color = blackContrast >= whiteContrast ? "#000000" : "#ffffff";
      }
    } catch (error) {
      console.error("Error fixing non-readable colors:", error);
    }
  }
};

const getEffectiveBackgroundColor = (element: HTMLElement, defaultBackground: string) => {
  let current: HTMLElement | null = element;
  while (current) {
    const background = Color(getComputedStyle(current).backgroundColor);
    if (background.alpha() >= 1) return background.rgb();
    current = current.parentElement;
  }
  return Color(defaultBackground);
};

const mergeRelValues = (value: string | undefined): string => {
  const values = new Set(["noopener", "noreferrer"]);
  for (const token of value?.split(/\s+/) ?? []) {
    const normalized = token.trim().toLowerCase();
    if (normalized) values.add(normalized);
  }
  return Array.from(values).join(" ");
};

const EMAIL_SANITIZE_CONFIG: IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "img",
    "title",
    "details",
    "summary",
    "style",
  ]),
  allowedAttributes: {
    "*": [
      "class",
      "style",
      "align",
      "valign",
      "width",
      "height",
      "cellpadding",
      "cellspacing",
      "border",
      "bgcolor",
      "colspan",
      "rowspan",
    ],
    a: ["href", "name", "target", "rel", "class", "style"],
    img: ["src", "alt", "width", "height", "class", "style"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel", "data", "cid"],
  allowedSchemesByTag: {
    img: ["http", "https", "data", "cid"],
  },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        target: attribs.target || "_blank",
        rel: mergeRelValues(attribs.rel),
      },
    }),
  },
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
        text-decoration: underline;
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
  const sanitized = sanitizeHtml(rawHtml, EMAIL_SANITIZE_CONFIG);
  return sanitized.replaceAll(REPLACEMENT_CHARACTER_REGEX, "");
};

const createDocument = (html: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
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
