import { cn } from "@quietr/ui";
import DOMPurify from "isomorphic-dompurify";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";

type MessageBodyProps = {
  html?: string;
  text?: string;
  snippet?: string;
  colorScheme?: "auto" | "light" | "dark";
  compact?: boolean;
};

type ResolvedColorScheme = "light" | "dark";

// Base typography/layout styles are injected into the Shadow DOM so email CSS stays isolated.
const getBaseStyles = (colorScheme: ResolvedColorScheme): string => `<style>
  :host {
    display: block;
    color-scheme: ${colorScheme};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
    line-height: 1.5;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  :where(body) { margin: 0; }
  :where(img) { max-width: 100%; height: auto; }
</style>`;

const TRUE_MEDIA_CONDITION = "(min-width: 0px)";
const FALSE_MEDIA_CONDITION = "(max-width: 0px)";

// Regex cleanup handles known email-client artifacts that can break rendering.
const LINK_TAG_REGEX = /<link\b[^>]*>/gi;
const LEGACY_VIEWPORT_AT_RULE_REGEX = /@(?:-ms-)?viewport\s*{[\s\S]*?}/gi;
const MALFORMED_VIEWPORT_DECLARATION_REGEX = /width\s*(?:=|\uFFFD)\s*(?:de)?vice-width/gi;
const REPLACEMENT_CHARACTER_REGEX = /\uFFFD/g;
const DOCUMENT_WRAPPER_REGEX = /<\/?(html|head)\b[^>]*>/gi;

const EMAIL_ADD_TAGS = [
  "html",
  "head",
  "body",
  "style",
  "img",
  "picture",
  "source",
  "center",
  "font",
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
];

// Always enforce safe rel values on external links while preserving existing rel tokens.
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

  // Normalize anchor/image attributes post-sanitize for security and email UX.
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

// Flip prefers-color-scheme media queries so we can force a single visual mode.
const forcePrefersColorSchemeQueries = (html: string, colorScheme: ResolvedColorScheme): string => {
  const targetScheme = colorScheme === "dark" ? "dark" : "light";
  const oppositeScheme = targetScheme === "dark" ? "light" : "dark";

  let normalized = html.replace(
    new RegExp(`\\(\\s*prefers-color-scheme\\s*:\\s*${targetScheme}\\s*\\)`, "gi"),
    TRUE_MEDIA_CONDITION,
  );

  normalized = normalized.replace(
    new RegExp(`\\(\\s*prefers-color-scheme\\s*:\\s*${oppositeScheme}\\s*\\)`, "gi"),
    FALSE_MEDIA_CONDITION,
  );

  return normalized;
};

// Final sanitize pass strips unsafe content plus problematic legacy email rules.
const sanitizeHtml = (rawHtml: string): string => {
  const sanitized = String(DOMPurify.sanitize(rawHtml, EMAIL_SANITIZE_CONFIG));
  return sanitized
    .replaceAll(LINK_TAG_REGEX, "")
    .replaceAll(LEGACY_VIEWPORT_AT_RULE_REGEX, "")
    .replaceAll(MALFORMED_VIEWPORT_DECLARATION_REGEX, "width: device-width")
    .replaceAll(REPLACEMENT_CHARACTER_REGEX, "");
};

// Build the exact HTML payload that gets mounted into Shadow DOM.
const prepareShadowContent = (rawHtml: string, colorScheme: ResolvedColorScheme): string => {
  const sanitized = sanitizeHtml(rawHtml);
  const withScheme = forcePrefersColorSchemeQueries(sanitized.trim(), colorScheme);
  const content = withScheme.replaceAll(DOCUMENT_WRAPPER_REGEX, "");
  return `${getBaseStyles(colorScheme)}${content}`;
};

// Read host app theme classes/attributes and map to a strict light/dark value.
const resolveDocumentColorScheme = (): ResolvedColorScheme => {
  if (typeof document === "undefined") return "light";

  const root = document.documentElement;
  const body = document.body;
  const dataTheme = root.getAttribute("data-theme")?.toLowerCase();
  const bodyDataTheme = body?.getAttribute("data-theme")?.toLowerCase();

  if (root.classList.contains("dark") || dataTheme === "dark") return "dark";
  if (body?.classList.contains("dark") || bodyDataTheme === "dark") return "dark";
  if (root.classList.contains("light") || dataTheme === "light") return "light";
  if (body?.classList.contains("light") || bodyDataTheme === "light") return "light";

  return "light";
};

export const MessageBody = (props: MessageBodyProps) => {
  const fallbackText = () => props.text?.trim() || props.snippet?.trim() || "No content.";
  const [autoColorScheme, setAutoColorScheme] = createSignal<ResolvedColorScheme>(
    resolveDocumentColorScheme(),
  );

  onMount(() => {
    const root = document.documentElement;
    const body = document.body;

    const update = () => {
      setAutoColorScheme(resolveDocumentColorScheme());
    };

    update();
    // Keep auto mode aligned with host app theme changes (class/data-theme toggles).
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    const bodyObserver = body ? new MutationObserver(update) : null;
    if (bodyObserver && body) {
      bodyObserver.observe(body, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    }

    onCleanup(() => {
      observer.disconnect();
      bodyObserver?.disconnect();
    });
  });

  const colorScheme = (): ResolvedColorScheme => {
    // Explicit prop wins; "auto" follows the observed document theme.
    if (props.colorScheme === "light") return "light";
    if (props.colorScheme === "dark") return "dark";
    return autoColorScheme();
  };

  return (
    <Show
      when={props.html?.trim()}
      keyed
      fallback={
        <p
          class={cn(
            "text-base leading-7 wrap-break-word whitespace-pre-wrap text-foreground",
            props.compact ? "mt-3" : "mt-6",
          )}
        >
          {fallbackText()}
        </p>
      }
    >
      {(html) => (
        <div
          class={cn(props.compact ? "mt-3" : "mt-6")}
          ref={(el) => {
            const shadow = el.attachShadow({ mode: "open" });
            createEffect(() => {
              // Re-render sanitized email HTML whenever content or resolved theme changes.
              shadow.innerHTML = prepareShadowContent(html, colorScheme());
            });
          }}
        />
      )}
    </Show>
  );
};
