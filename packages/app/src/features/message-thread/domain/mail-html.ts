import DOMPurify from "dompurify";
import type { Config } from "dompurify";

import { sanitizeMailCss } from "./mail-css";

const TRACKING_PIXEL_SIZE = new Set(["0", "1"]);
const TEXT_URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/giu;

export type ProcessedMailHtml = {
  calendarLinks: CalendarLink[];
  hasBlockedImages: boolean;
  processedHtml: string;
  referencedContentIds: string[];
};

export type CalendarLink = {
  href: string;
  label: string;
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

const EMAIL_SANITIZE_CONFIG: Config = {
  ADD_ATTR: [
    "align",
    "bgcolor",
    "border",
    "background",
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
  FORBID_TAGS: [
    "audio",
    "base",
    "button",
    "dialog",
    "embed",
    "form",
    "iframe",
    "input",
    "link",
    "meta",
    "object",
    "select",
    "textarea",
    "video",
  ],
  USE_PROFILES: { html: true },
  WHOLE_DOCUMENT: true,
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
    const [matchedText] = match;
    const index = match.index ?? 0;
    const url = matchedText.replace(/[.,;:!?]+$/u, "");
    const trailing = matchedText.slice(url.length);

    if (index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, index) });
    }

    segments.push({ href: url, kind: "link", value: url });
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

const OUTLOOK_CALENDAR_HOSTS = new Set([
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
]);
const MAX_CALENDAR_LINKS = 3;

const isGoogleCalendarUrl = (url: URL): boolean => {
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "calendar.google.com" && hostname !== "www.google.com") {
    return false;
  }

  const pathname = url.pathname.toLowerCase().replace(/\/+$/u, "");
  const googleAction = url.searchParams.get("action")?.toLowerCase();
  if (pathname === "/calendar/event") {
    return url.searchParams.has("eid") || googleAction === "view";
  }
  if (pathname === "/calendar/render") {
    return googleAction === "template";
  }
  return false;
};

const isOutlookCalendarUrl = (url: URL): boolean => {
  const hostname = url.hostname.toLowerCase();
  if (!OUTLOOK_CALENDAR_HOSTS.has(hostname)) {
    return false;
  }

  const pathname = url.pathname.toLowerCase();
  const outlookPath = url.searchParams.get("path")?.toLowerCase();
  if (pathname.includes("/calendar/0/deeplink/compose")) {
    return true;
  }
  if (pathname.includes("/calendar/item/")) {
    return true;
  }
  if ((outlookPath ?? "").startsWith("/calendar/action/compose")) {
    return true;
  }
  return url.searchParams.get("rru")?.toLowerCase() === "addevent";
};

export const getCalendarLink = (href: string): CalendarLink | null => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (isGoogleCalendarUrl(url)) {
    return { href: url.href, label: "Open in Google Calendar" };
  }

  if (isOutlookCalendarUrl(url)) {
    return { href: url.href, label: "Open in Outlook Calendar" };
  }

  const pathname = url.pathname.toLowerCase().replace(/\/+$/u, "");
  if (pathname.endsWith(".ics")) {
    return { href: url.href, label: "Open calendar invite" };
  }

  return null;
};

export const getCalendarLinks = (hrefs: Iterable<string>): CalendarLink[] => {
  const links: CalendarLink[] = [];
  const seen = new Set<string>();

  for (const href of hrefs) {
    const calendarLink = getCalendarLink(href);
    if (!calendarLink || seen.has(calendarLink.href)) {
      continue;
    }

    seen.add(calendarLink.href);
    links.push(calendarLink);
    if (links.length === MAX_CALENDAR_LINKS) {
      break;
    }
  }

  return links;
};

const linkifyBareUrls = (document: Document) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      continue;
    }
    const textNode = node;
    TEXT_URL_REGEX.lastIndex = 0;
    if (!TEXT_URL_REGEX.test(textNode.data)) {
      continue;
    }
    if (textNode.parentElement?.closest("a, style, script, textarea, title")) {
      continue;
    }
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
      link.rel = "noopener noreferrer";
      fragment.append(link);
    }

    node.replaceWith(fragment);
  }
};

const isHiddenPreheaderStyle = (style: string): boolean =>
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
  style.includes("opacity: 0");

const removePreheaderContent = (document: Document) => {
  for (const element of document.querySelectorAll(
    ".preheader, .preheaderText, [class*='preheader']"
  )) {
    const style = element.getAttribute("style") ?? "";
    if (isHiddenPreheaderStyle(style)) {
      element.remove();
    }
  }
};

const collapseQuoted = (document: Document) => {
  for (const element of document.querySelectorAll(".gmail_quote")) {
    if (element.closest("details.quoted-toggle")) {
      continue;
    }

    const details = document.createElement("details");
    details.className = "quoted-toggle";
    const summary = document.createElement("summary");
    summary.textContent = "Show quoted text";
    element.replaceWith(details);
    details.append(summary, element);
  }
};

const removeTrackingPixels = (document: Document) => {
  for (const image of document.querySelectorAll("img")) {
    const width = image.getAttribute("width");
    const height = image.getAttribute("height");
    if (
      (width ?? "") !== "" &&
      (height ?? "") !== "" &&
      TRACKING_PIXEL_SIZE.has(width ?? "") &&
      TRACKING_PIXEL_SIZE.has(height ?? "")
    ) {
      image.remove();
    }
  }
};

const BLOCKED_RESOURCE_ATTRIBUTES = new Set([
  "action",
  "archive",
  "attributionsrc",
  "autofocus",
  "cite",
  "classid",
  "codebase",
  "command",
  "commandfor",
  "data",
  "datasrc",
  "download",
  "dynsrc",
  "exportparts",
  "formaction",
  "icon",
  "is",
  "longdesc",
  "lowsrc",
  "manifest",
  "part",
  "ping",
  "popover",
  "popovertarget",
  "popovertargetaction",
  "poster",
  "profile",
  "slot",
  "srcdoc",
  "usemap",
  "xlink:href",
  "xml:base",
]);
const IMAGE_DATA_URL_REGEX =
  /^data:image\/(?:avif|bmp|gif|jpeg|png|webp|x-icon);base64,[a-z\d+/]*={0,2}$/iu;
const MAIL_RENDER_STYLES = `
  html {
    background: #ffffff;
    color: #000000;
    color-scheme: light;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
    line-height: normal;
  }
  body { margin: 0; }
  a:focus-visible, summary:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
  details.quoted-toggle {
    border-left: 2px solid #d1d5db;
    margin-top: 0.75em;
    padding-left: 8px;
  }
  details.quoted-toggle > summary {
    color: #6b7280;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  details.quoted-toggle > summary::-webkit-details-marker { display: none; }
`;

export const normalizeMailContentId = (value: string): string | undefined => {
  let normalized = value.trim();
  if (/^cid:/iu.test(normalized)) {
    try {
      normalized = decodeURIComponent(normalized.slice(4));
    } catch {
      return undefined;
    }
  }
  normalized = normalized.trim().replaceAll(/^<|>$/gu, "").toLowerCase();
  // oxlint-disable-next-line eslint/no-control-regex -- Reject URL controls and invalid CID delimiters.
  return normalized.length > 0 && !/[\u0000-\u0020<>]/u.test(normalized)
    ? normalized
    : undefined;
};

type MailImagePolicy = {
  hasBlockedImages: boolean;
  referencedContentIds: Set<string>;
  resolveImage: (value: string) => string | null;
};

const createImagePolicy = ({
  inlineImageUrls,
  preserveContentIds,
  shouldLoadImages,
}: {
  inlineImageUrls?: ReadonlyMap<string, string>;
  preserveContentIds: boolean;
  shouldLoadImages: boolean;
}): MailImagePolicy => {
  const policy: MailImagePolicy = {
    hasBlockedImages: false,
    referencedContentIds: new Set(),
    resolveImage: (value): string | null => {
      const source = value.trim();
      // oxlint-disable-next-line eslint/no-control-regex -- Reject URL controls before protocol classification.
      if (source === "" || /[\u0000-\u001F\u007F]/u.test(source)) {
        return null;
      }
      if (/^cid:/iu.test(source)) {
        const contentId = normalizeMailContentId(source);
        if (contentId === undefined) {
          return null;
        }
        policy.referencedContentIds.add(contentId);
        if (preserveContentIds) {
          return `cid:${encodeURIComponent(contentId)}`;
        }
        const ownedUrl = inlineImageUrls?.get(contentId);
        return ownedUrl !== undefined && ownedUrl.startsWith("blob:")
          ? ownedUrl
          : null;
      }
      if (source.startsWith("#") || IMAGE_DATA_URL_REGEX.test(source)) {
        return source;
      }

      let url: URL;
      try {
        url = new URL(source.startsWith("//") ? `https:${source}` : source);
      } catch {
        return null;
      }
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username !== "" ||
        url.password !== ""
      ) {
        return null;
      }
      if (!shouldLoadImages) {
        policy.hasBlockedImages = true;
        return null;
      }
      return url.href;
    },
  };
  return policy;
};

export const resolveComposeImageSource = (
  source: string,
  shouldLoadImages: boolean
): string | null => {
  if (source.startsWith("blob:")) {
    return source;
  }
  return createImagePolicy({
    preserveContentIds: true,
    shouldLoadImages,
  }).resolveImage(source);
};

const sanitizeImageSet = (
  source: string,
  resolveImage: MailImagePolicy["resolveImage"]
): string => {
  const candidates: { descriptor: string; source: string }[] = [];
  let remaining = source;

  while (remaining !== "") {
    remaining = remaining.replace(/^[\s,]+/u, "");
    if (remaining === "") {
      break;
    }
    const urlMatch = /^\S+/u.exec(remaining);
    if (urlMatch === null) {
      return "";
    }
    const [rawUrl] = urlMatch;
    remaining = remaining.slice(rawUrl.length);
    const imageSource = rawUrl.replace(/,+$/u, "");
    let descriptor = "";
    if (imageSource === rawUrl) {
      const comma = remaining.indexOf(",");
      descriptor = (
        comma === -1 ? remaining : remaining.slice(0, comma)
      ).trim();
      remaining = comma === -1 ? "" : remaining.slice(comma + 1);
      if (descriptor !== "" && !/^(?:\d+w|(?:\d*\.)?\d+x)$/u.test(descriptor)) {
        return "";
      }
    }
    candidates.push({ descriptor, source: imageSource });
  }

  return candidates
    .flatMap((candidate) => {
      const resolved = resolveImage(candidate.source);
      return resolved === null
        ? []
        : [
            `${resolved}${candidate.descriptor ? ` ${candidate.descriptor}` : ""}`,
          ];
    })
    .join(", ");
};

const applyDocumentPolicy = (document: Document, policy: MailImagePolicy) => {
  // oxlint-disable-next-line unicorn/no-useless-spread -- Removing children mutates the live collection.
  for (const child of [...document.head.children]) {
    if (child.tagName !== "STYLE") {
      child.remove();
    }
  }

  for (const element of document.querySelectorAll("*")) {
    if (
      element.tagName === "SOURCE" &&
      element.parentElement?.tagName !== "PICTURE"
    ) {
      element.remove();
      continue;
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- Attribute removal mutates the live collection.
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (BLOCKED_RESOURCE_ATTRIBUTES.has(name) || name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        const css = sanitizeMailCss(attribute.value, {
          context: "declarationList",
          resolveImage: policy.resolveImage,
        });
        if (css === "") {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, css);
        }
        continue;
      }
      if (name === "background" || name === "src") {
        const resolved =
          name === "background" || element.tagName === "IMG"
            ? policy.resolveImage(attribute.value)
            : null;
        if (resolved === null) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, resolved);
        }
        continue;
      }
      if (name === "srcset") {
        const resolved =
          element.tagName === "IMG" || element.tagName === "SOURCE"
            ? sanitizeImageSet(attribute.value, policy.resolveImage)
            : "";
        if (resolved === "") {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, resolved);
        }
        continue;
      }
      if (name !== "href") {
        continue;
      }
      if (element.tagName !== "A" && element.tagName !== "AREA") {
        element.removeAttribute(name);
        continue;
      }
      const href = attribute.value.trim();
      if (href.startsWith("#")) {
        element.setAttribute(name, href);
        element.removeAttribute("target");
        continue;
      }
      let url: URL;
      try {
        url = new URL(href.startsWith("//") ? `https:${href}` : href);
      } catch {
        element.removeAttribute(name);
        continue;
      }
      if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
        element.removeAttribute(name);
        continue;
      }
      element.setAttribute(name, url.href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }

    if (element.tagName === "STYLE") {
      element.textContent = sanitizeMailCss(element.textContent ?? "", {
        context: "stylesheet",
        resolveImage: policy.resolveImage,
      });
    }
    if (element.tagName === "IMG") {
      element.setAttribute("referrerpolicy", "no-referrer");
    }
  }
};

export const preprocessEmailHtml = (html: string): string => {
  const document = createDocument(
    DOMPurify.sanitize(html, EMAIL_SANITIZE_CONFIG)
  );
  applyDocumentPolicy(
    document,
    createImagePolicy({ preserveContentIds: true, shouldLoadImages: true })
  );
  collapseQuoted(document);
  removeTrackingPixels(document);
  removePreheaderContent(document);
  linkifyBareUrls(document);
  return document.documentElement.outerHTML;
};

export const applyEmailPreferences = (
  preprocessedHtml: string,
  shouldLoadImages: boolean,
  _theme: MailRenderTheme,
  inlineImageUrls?: ReadonlyMap<string, string>
): ProcessedMailHtml => {
  const document = createDocument(preprocessedHtml);
  const policy = createImagePolicy({
    inlineImageUrls,
    preserveContentIds: false,
    shouldLoadImages,
  });
  applyDocumentPolicy(document, policy);
  const calendarLinks = getCalendarLinks(
    Array.from(document.querySelectorAll("a"), (link) =>
      link.closest("details.quoted-toggle")
        ? ""
        : (link.getAttribute("href") ?? "")
    )
  );
  const defaults = document.createElement("style");
  defaults.textContent = MAIL_RENDER_STYLES;
  document.head.prepend(defaults);

  return {
    calendarLinks,
    hasBlockedImages: policy.hasBlockedImages,
    processedHtml: document.documentElement.outerHTML,
    referencedContentIds: [...policy.referencedContentIds],
  };
};
