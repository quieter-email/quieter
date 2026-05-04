"use client";

import { useColorMode, type ColorMode } from "@quieter/ui";
import DOMPurify from "isomorphic-dompurify";
import { useEffect, useRef } from "react";

type MessageBodyProps = {
  html?: string;
  text?: string;
  isLoading?: boolean;
};

const getLightMessageStyles = (): string => {
  return `
  :host {
    all: initial;
    display: block;
    color-scheme: light !important;
    background: var(--background-light, #ffffff);
    color: var(--foreground, #18181b);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  }
  :where(html, body) {
    margin: 0;
    padding: 0;
    background: var(--background-light, #ffffff);
    color: var(--foreground, #18181b);
    font-family: inherit;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  :where(table),
  :where(table) :where(*) {
    overflow-wrap: normal;
    word-break: normal;
    word-spacing: normal;
  }
  :where(img, picture, svg) { max-width: 100%; height: auto; }
  :where(a) { color: inherit; text-decoration: underline; }
  :where(hr) { border-color: #e4e4e7; }
  :where(blockquote) { border-left: 3px solid #e4e4e7; padding-left: 12px; }
`;
};

const getDarkMessageStyles = (): string => {
  return `
  :host {
    all: initial;
    display: block;
    color-scheme: dark !important;
    background: var(--background-light, transparent);
    color: var(--foreground, #e4e4e7);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  }
  :where(html, body) {
    margin: 0;
    padding: 0;
    background: var(--background-light, transparent);
    color: var(--foreground, #e4e4e7);
    font-family: inherit;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  :where(table),
  :where(table) :where(*) {
    overflow-wrap: normal;
    word-break: normal;
    word-spacing: normal;
  }
  :where(img, picture, svg) { max-width: 100%; height: auto; }
  :where(a) { color: inherit; text-decoration: underline; }
  :where(hr) { border-color: var(--border, #3f3f46); }
  :where(blockquote) {
    border-left: 3px solid var(--border, #3f3f46);
    padding-left: 12px;
  }
  :where(pre) { overflow-x: auto; white-space: pre-wrap; }
  :where(code, pre) { font-family: var(--font-mono, monospace); }
`;
};

const getBaseStyles = (mode: ColorMode): string => {
  return `<style>${mode === "dark" ? getDarkMessageStyles() : getLightMessageStyles()}</style>`;
};

const LINK_TAG_REGEX = /<link\b[^>]*>/gi;
const REPLACEMENT_CHARACTER_REGEX = /\uFFFD/g;
const DOCUMENT_WRAPPER_REGEX = /<\/?(html|head)\b[^>]*>/gi;
const EMAIL_ADD_TAGS = [
  "html",
  "head",
  "body",
  "img",
  "picture",
  "source",
  "center",
  "font",
  "style",
  "meta",
  "title",
];
const EMAIL_ADD_ATTR = [
  "target",
  "align",
  "valign",
  "bgcolor",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "sizes",
  "decoding",
  "referrerpolicy",
  "http-equiv",
  "content",
  "name",
  "charset",
  "scope",
  "role",
  "class",
];

const mergeRelValues = (value: string | undefined): string => {
  const values = new Set(["noopener", "noreferrer"]);
  for (const token of value?.split(/\s+/) ?? []) {
    const normalized = token.trim().toLowerCase();
    if (normalized) values.add(normalized);
  }
  return Array.from(values).join(" ");
};

const EMAIL_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  WHOLE_DOCUMENT: true,
  ADD_TAGS: EMAIL_ADD_TAGS,
  ADD_ATTR: EMAIL_ADD_ATTR,
  ADD_DATA_URI_TAGS: ["img", "source"] as string[],
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  RETURN_TRUSTED_TYPE: false,
};

let emailSanitizeHooksRegistered = false;

const registerEmailSanitizeHooks = () => {
  if (emailSanitizeHooksRegistered || !DOMPurify.isSupported) return;
  emailSanitizeHooksRegistered = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      const rel = node.getAttribute("rel");
      node.setAttribute("rel", mergeRelValues(rel ?? undefined));
    }

    if (node.tagName === "IMG") {
      if (!node.hasAttribute("loading")) {
        node.setAttribute("loading", "lazy");
      }
      node.setAttribute("decoding", "async");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
};

registerEmailSanitizeHooks();

/** DOMPurify drops leading `<style>` on bare fragments unless wrapped in `<body>`. */
const coerceEmailHtmlForSanitize = (rawHtml: string): string => {
  const trimmedStart = rawHtml.trimStart();

  if (/^<!DOCTYPE\b/i.test(trimmedStart) || /^<html\b/i.test(trimmedStart)) {
    return rawHtml;
  }

  return `<body>${rawHtml}</body>`;
};

const sanitizeHtml = (rawHtml: string): string => {
  const sanitized = String(
    DOMPurify.sanitize(coerceEmailHtmlForSanitize(rawHtml), EMAIL_SANITIZE_CONFIG),
  );
  return sanitized.replaceAll(LINK_TAG_REGEX, "").replaceAll(REPLACEMENT_CHARACTER_REGEX, "");
};

const prepareShadowContent = (rawHtml: string, colorMode: ColorMode): string => {
  const sanitized = sanitizeHtml(rawHtml);
  const content = sanitized.trim().replaceAll(DOCUMENT_WRAPPER_REGEX, "");
  return `${getBaseStyles(colorMode)}${content}`;
};

const HtmlMessageBody = ({ colorMode, html }: { colorMode: ColorMode; html: string }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    shadowRootRef.current ??= hostRef.current.attachShadow({ mode: "open" });
    shadowRootRef.current.innerHTML = prepareShadowContent(html, colorMode);
  }, [colorMode, html]);

  return <div className="p-4" ref={hostRef} />;
};

const MessageBodyLoadingSkeleton = () => (
  <div aria-label="Loading message content" className="space-y-3 p-4" role="status">
    <div aria-hidden="true" className="animate-pulse space-y-3">
      <div className="h-3.5 w-full rounded-md bg-muted/75" />
      <div className="h-3.5 w-11/12 rounded-md bg-muted/70" />
      <div className="h-3.5 w-4/5 rounded-md bg-muted/65" />
      <div className="h-3.5 w-2/3 rounded-md bg-muted/60" />
    </div>
  </div>
);

export const MessageBody = ({ html, isLoading, text }: MessageBodyProps) => {
  const { colorMode } = useColorMode();
  const fallbackText = text?.trim();
  const htmlBody = html?.trim();

  if (!htmlBody && !fallbackText && isLoading) {
    return <MessageBodyLoadingSkeleton />;
  }

  if (!htmlBody) {
    return (
      <p className="bg-background-light p-4 text-base leading-7 wrap-break-word whitespace-pre-wrap text-foreground">
        {fallbackText || "No content."}
      </p>
    );
  }

  return <HtmlMessageBody colorMode={colorMode} html={htmlBody} />;
};
