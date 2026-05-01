"use client";

import { cn } from "@quieter/ui";
import DOMPurify from "isomorphic-dompurify";
import { useEffect, useRef } from "react";

type MessageBodyProps = {
  html?: string;
  text?: string;
  isLoading?: boolean;
};

const getBaseStyles = (): string => {
  return `<style>
  :host {
    display: block;
    color-scheme: light;
    background: #ffffff;
    color: #18181b;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  :where(html, body) {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #18181b;
  }
  :where(img, picture, svg) { max-width: 100%; height: auto; }
  :where(a) { color: inherit; text-decoration: underline; }
  :where(hr) { border-color: #e4e4e7; }
  :where(blockquote) { border-left: 3px solid #e4e4e7; padding-left: 12px; }
</style>`;
};

const LINK_TAG_REGEX = /<link\b[^>]*>/gi;
const MALFORMED_VIEWPORT_DECLARATION_REGEX = /width\s*(?:=|\uFFFD)\s*(?:de)?vice-width/gi;
const REPLACEMENT_CHARACTER_REGEX = /\uFFFD/g;
const DOCUMENT_WRAPPER_REGEX = /<\/?(html|head)\b[^>]*>/gi;
const STYLE_TAG_REGEX = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;

const EMAIL_ADD_TAGS = ["html", "head", "body", "img", "picture", "source", "center", "font"];
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

const sanitizeHtml = (rawHtml: string): string => {
  const sanitized = String(DOMPurify.sanitize(rawHtml, EMAIL_SANITIZE_CONFIG));
  return sanitized
    .replaceAll(STYLE_TAG_REGEX, "")
    .replaceAll(LINK_TAG_REGEX, "")
    .replaceAll(MALFORMED_VIEWPORT_DECLARATION_REGEX, "width: device-width")
    .replaceAll(REPLACEMENT_CHARACTER_REGEX, "");
};

const prepareShadowContent = (rawHtml: string): string => {
  const sanitized = sanitizeHtml(rawHtml);
  const content = sanitized.trim().replaceAll(DOCUMENT_WRAPPER_REGEX, "");
  return `${getBaseStyles()}${content}`;
};

const HtmlMessageBody = ({ html }: { html: string }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    shadowRootRef.current ??= hostRef.current.attachShadow({ mode: "open" });
    shadowRootRef.current.innerHTML = prepareShadowContent(html);
  }, [html]);

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
  const fallbackText = text?.trim();

  if (!html?.trim() && !fallbackText && isLoading) {
    return <MessageBodyLoadingSkeleton />;
  }

  if (!html?.trim()) {
    return (
      <p
        className={cn(
          "p-4 text-base leading-7 wrap-break-word whitespace-pre-wrap text-foreground",
        )}
      >
        {fallbackText || "No content."}
      </p>
    );
  }

  return <HtmlMessageBody html={html} />;
};
