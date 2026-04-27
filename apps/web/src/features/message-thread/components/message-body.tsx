"use client";

import { cn, useColorMode } from "@quieter/ui";
import DOMPurify from "isomorphic-dompurify";
import { useEffect, useRef } from "react";

type MessageBodyProps = {
  html?: string;
  text?: string;
  compact?: boolean;
  isLoading?: boolean;
};

type ResolvedColorMode = "light" | "dark";

const getBaseStyles = (colorMode: ResolvedColorMode): string => {
  const bg = colorMode === "dark" ? "#18181b" : "#ffffff";
  const fg = colorMode === "dark" ? "#e4e4e7" : "#18181b";
  const link = colorMode === "dark" ? "#60a5fa" : "#2563eb";
  const muted = colorMode === "dark" ? "#a1a1aa" : "#71717a";
  const border = colorMode === "dark" ? "#3f3f46" : "#e4e4e7";

  return `<style>
  :host {
    display: block;
    background: ${bg};
    color: ${fg};
    overflow-wrap: break-word;
    word-break: break-word;
  }
  :where(html, body) { margin: 0; padding: 0; }
  :where(img, picture, svg) { max-width: 100%; height: auto; }
  * { color: inherit !important; }
  :where(html, body, div, td, th, table, tr, span, p, section, article, header, footer, main, aside, nav, blockquote) {
    background-color: transparent !important;
    background-image: none !important;
  }
  a, a * { color: ${link} !important; text-decoration: underline; }
  :where(hr) { border-color: ${border}; }
  :where(blockquote) { border-left: 3px solid ${border}; padding-left: 12px; color: ${muted} !important; }
</style>`;
};

const LINK_TAG_REGEX = /<link\b[^>]*>/gi;
const LEGACY_VIEWPORT_AT_RULE_REGEX = /@(?:-ms-)?viewport\s*{[\s\S]*?}/gi;
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
    .replaceAll(LEGACY_VIEWPORT_AT_RULE_REGEX, "")
    .replaceAll(MALFORMED_VIEWPORT_DECLARATION_REGEX, "width: device-width")
    .replaceAll(REPLACEMENT_CHARACTER_REGEX, "");
};

const prepareShadowContent = (rawHtml: string, colorMode: ResolvedColorMode): string => {
  const sanitized = sanitizeHtml(rawHtml);
  const content = sanitized.trim().replaceAll(DOCUMENT_WRAPPER_REGEX, "");
  return `${getBaseStyles(colorMode)}${content}`;
};

const HtmlMessageBody = ({ compact, html }: { html: string; compact?: boolean }) => {
  const { colorMode } = useColorMode();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    shadowRootRef.current ??= hostRef.current.attachShadow({ mode: "open" });
    shadowRootRef.current.innerHTML = prepareShadowContent(
      html,
      colorMode === "dark" ? "dark" : "light",
    );
  }, [colorMode, html]);

  return <div className={cn({ "mt-3": compact, "mt-6": !compact })} ref={hostRef} />;
};

const MessageBodyLoadingSkeleton = ({ compact }: { compact?: boolean }) => (
  <div
    aria-label="Loading message content"
    className={cn("space-y-3", {
      "mt-3": compact,
      "mt-6": !compact,
    })}
    role="status"
  >
    <div aria-hidden="true" className="animate-pulse space-y-3">
      <div className="h-3.5 w-full rounded-md bg-muted/75" />
      <div className="h-3.5 w-11/12 rounded-md bg-muted/70" />
      <div className="h-3.5 w-4/5 rounded-md bg-muted/65" />
      <div className="h-3.5 w-2/3 rounded-md bg-muted/60" />
    </div>
  </div>
);

export const MessageBody = ({ compact, html, isLoading, text }: MessageBodyProps) => {
  const fallbackText = text?.trim();

  if (!html?.trim() && !fallbackText && isLoading) {
    return <MessageBodyLoadingSkeleton compact={compact} />;
  }

  if (!html?.trim()) {
    return (
      <p
        className={cn("text-base leading-7 wrap-break-word whitespace-pre-wrap text-foreground", {
          "mt-3": compact,
          "mt-6": !compact,
        })}
      >
        {fallbackText || "No content."}
      </p>
    );
  }

  return <HtmlMessageBody compact={compact} html={html} />;
};
