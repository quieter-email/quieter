"use client";

import {
  ArrowUpRight01Icon,
  Calendar03Icon,
  Image01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { useColorMode } from "@quieter/ui/color-mode";
import { useEffect, useMemo, useRef, useState } from "react";

import { useExternalImagesEnabled } from "#/features/settings/domain/external-images-setting";

import {
  applyEmailPreferences,
  fixNonReadableColors,
  getCalendarLinks,
  linkifyText,
  preprocessEmailHtml,
} from "../domain/mail-html";
import type { CalendarLink, ProcessedMailHtml } from "../domain/mail-html";

type MessageBodyProps = {
  html?: string;
  text?: string;
  isLoading?: boolean;
  loadExternalImages?: boolean;
};

const REMOTE_IMAGE_REGEX = /^https?:\/\//iu;

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

const CalendarLinkActions = ({ links }: { links: CalendarLink[] }) => {
  if (links.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Calendar actions"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/35 px-3 py-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg/90 text-muted-fg shadow-xs ring-1 ring-border/55"
        >
          <HugeiconsIcon className="size-4 shrink-0" icon={Calendar03Icon} />
        </div>
        <p className="min-w-0 text-sm/snug text-muted-fg">
          {links.length === 1
            ? "This message includes a calendar event."
            : "This message includes calendar events."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {links.map((link) => (
          <Button
            key={link.href}
            onClick={() => {
              const openedWindow = window.open(
                link.href,
                "_blank",
                "noopener,noreferrer"
              );
              if (openedWindow) {
                openedWindow.opener = null;
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {link.label}
            <HugeiconsIcon
              aria-hidden
              className="size-3.5"
              icon={ArrowUpRight01Icon}
            />
          </Button>
        ))}
      </div>
    </section>
  );
};

const HtmlMessageBodyContent = ({
  html,
  loadExternalImages,
}: {
  html: string;
  loadExternalImages?: boolean;
}) => {
  const { colorMode } = useColorMode();
  const externalImagesEnabled = useExternalImagesEnabled();
  const [cspViolation, setCspViolation] = useState(false);
  const [temporaryImagesEnabled, setTemporaryImagesEnabled] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  // react-doctor-disable-next-line react-doctor/no-event-handler
  const shouldLoadImages =
    (loadExternalImages ?? externalImagesEnabled) || temporaryImagesEnabled;
  const processedMail: ProcessedMailHtml = useMemo(
    () =>
      applyEmailPreferences(
        preprocessEmailHtml(html),
        shouldLoadImages,
        colorMode
      ),
    [colorMode, html, shouldLoadImages]
  );
  const remoteImagesPresent =
    !shouldLoadImages && processedMail.hasBlockedImages;
  const handleImageErrorRef = useRef<(event: Event) => void>((event) => {
    void event;
  });

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    let shadowRoot = shadowRootRef.current;
    if (!shadowRoot) {
      shadowRoot = hostRef.current.attachShadow({ mode: "open" });
      shadowRootRef.current = shadowRoot;
    }

    const parsedDocument = new DOMParser().parseFromString(
      processedMail.processedHtml,
      "text/html"
    );
    shadowRoot.replaceChildren(
      ...[...parsedDocument.head.childNodes].map((node) =>
        document.importNode(node, true)
      ),
      ...[...parsedDocument.body.childNodes].map((node) =>
        document.importNode(node, true)
      )
    );
    fixNonReadableColors(shadowRoot, {
      defaultBackground: colorMode === "dark" ? "#1A1A1A" : "#ffffff",
    });
  }, [colorMode, processedMail]);

  useEffect(() => {
    handleImageErrorRef.current = (event) => {
      const { target } = event;
      if (!(target instanceof HTMLImageElement)) {
        return;
      }

      if (
        !shouldLoadImages &&
        REMOTE_IMAGE_REGEX.test(target.currentSrc || target.src)
      ) {
        setCspViolation(true);
      }
      target.style.display = "none";
    };
  }, [shouldLoadImages]);

  useEffect(() => {
    const root = shadowRootRef.current;
    if (!root) {
      return;
    }

    const handleImageError = (event: Event) => {
      handleImageErrorRef.current(event);
    };
    root.addEventListener("error", handleImageError, true);

    const handleClick = (event: Event) => {
      const { target } = event;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const link = target.closest("a");
      if (!link) {
        return;
      }

      event.preventDefault();
      const href = link.getAttribute("href");
      if (
        typeof href === "string" &&
        (href.startsWith("http://") || href.startsWith("https://"))
      ) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else if (typeof href === "string" && href.startsWith("mailto:")) {
        window.location.href = href;
      }
    };

    root.addEventListener("click", handleClick);

    return () => {
      root.removeEventListener("error", handleImageError, true);
      root.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <>
      <CalendarLinkActions links={processedMail.calendarLinks} />
      {!shouldLoadImages && (remoteImagesPresent || cspViolation) && (
        <section
          aria-label="Remote images"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/35 px-3 py-2"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg/90 text-muted-fg shadow-xs ring-1 ring-border/55"
            >
              <HugeiconsIcon className="size-4 shrink-0" icon={Image01Icon} />
            </div>
            <p className="min-w-0 text-sm/snug text-muted-fg">
              Remote images are hidden for security reasons.
            </p>
          </div>
          <Button
            className="w-fit shrink-0 sm:ml-auto"
            onClick={() => {
              setTemporaryImagesEnabled(true);
            }}
            size="sm"
            type="button"
            variant="default"
          >
            Show images
          </Button>
        </section>
      )}
      <div
        className="mail-content w-full max-w-full min-w-0 flex-1 overflow-x-hidden bg-transparent text-fg"
        ref={hostRef}
      />
    </>
  );
};

const HtmlMessageBody = (props: {
  html: string;
  loadExternalImages?: boolean;
}) => <HtmlMessageBodyContent key={props.html} {...props} />;

const MessageBodyLoadingSkeleton = () => (
  <output aria-label="Loading message content" className="block space-y-3 p-4">
    <div aria-hidden="true" className="animate-pulse space-y-3">
      <div className="h-3.5 w-full rounded-md bg-muted/75" />
      <div className="h-3.5 w-11/12 rounded-md bg-muted/70" />
      <div className="h-3.5 w-4/5 rounded-md bg-muted/65" />
      <div className="h-3.5 w-2/3 rounded-md bg-muted/60" />
    </div>
  </output>
);

const PlainTextMessageBody = ({ text }: { text: string }) => {
  const { calendarLinks, segments } = useMemo(() => {
    const nextSegments = linkifyText(text);

    return {
      calendarLinks: getCalendarLinks(
        nextSegments.flatMap((segment) =>
          segment.kind === "link" ? [segment.href] : []
        )
      ),
      segments: nextSegments,
    };
  }, [text]);

  return (
    <>
      <CalendarLinkActions links={calendarLinks} />
      <p className="bg-transparent p-4 text-base/7 wrap-break-word whitespace-pre-wrap text-fg">
        {segments.map((segment) =>
          segment.kind === "link" ? (
            <a
              className="rounded-sm text-primary underline decoration-border underline-offset-2 hover:decoration-current focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-primary"
              href={segment.href}
              key={`link:${segment.href}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              {segment.value}
            </a>
          ) : (
            <span key={`text:${segment.value}`}>{segment.value}</span>
          )
        )}
      </p>
    </>
  );
};

export const MessageBody = ({
  html,
  isLoading,
  loadExternalImages,
  text,
}: MessageBodyProps) => {
  const fallbackText = text?.trim();
  const htmlBody = html?.trim();

  if (!hasText(htmlBody) && !hasText(fallbackText) && isLoading === true) {
    return <MessageBodyLoadingSkeleton />;
  }

  if (!hasText(htmlBody)) {
    return (
      <PlainTextMessageBody
        text={hasText(fallbackText) ? fallbackText : "No content."}
      />
    );
  }

  return (
    <HtmlMessageBody html={htmlBody} loadExternalImages={loadExternalImages} />
  );
};
