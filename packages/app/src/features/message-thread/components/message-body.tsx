"use client";

import {
  ArrowUpRight01Icon,
  Calendar03Icon,
  Image01Icon,
} from "@hugeicons/core-free-icons";
import {
  applyEmailPreferences,
  fixNonReadableColors,
  getCalendarLinks,
  linkifyText,
  preprocessEmailHtml,
} from "@quieter/app/features/message-thread/domain/mail-html";
import type {
  CalendarLink,
  ProcessedMailHtml,
} from "@quieter/app/features/message-thread/domain/mail-html";
import { useExternalImagesEnabled } from "@quieter/app/features/settings/domain/external-images-setting";
import { Button, buttonVariants } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { useColorMode } from "@quieter/ui/color-mode";
import { Icon } from "@quieter/ui/icon";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

type MessageBodyProps = {
  html?: string;
  text?: string;
  isLoading?: boolean;
  loadExternalImages?: boolean;
};

const REMOTE_IMAGE_REGEX = /^https?:\/\//iu;

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
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-raised/90 text-muted-fg shadow-xs ring-1 ring-border/55"
        >
          <Icon icon={Calendar03Icon} />
        </div>
        <p className="min-w-0 text-body/snug text-muted-fg">
          {links.length === 1
            ? "This message includes a calendar event."
            : "This message includes calendar events."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {links.map((link) => (
          <a
            aria-label={link.label}
            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
            href={link.href}
            key={link.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {link.label}
            <Icon aria-hidden size={14} icon={ArrowUpRight01Icon} />
          </a>
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

  const handleImageError = useEffectEvent((event: Event) => {
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
  });

  useEffect(() => {
    const root = shadowRootRef.current;
    if (!root) {
      return;
    }

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
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-raised/90 text-muted-fg shadow-xs ring-1 ring-border/55"
            >
              <Icon icon={Image01Icon} />
            </div>
            <p className="min-w-0 text-body/snug text-muted-fg">
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
        className="w-full max-w-full min-w-0 flex-1 overflow-x-hidden bg-transparent text-fg"
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
      <p className="bg-transparent p-4 text-body-lg/7 wrap-break-word whitespace-pre-wrap text-fg">
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

  if (!htmlBody && !fallbackText && isLoading === true) {
    return <MessageBodyLoadingSkeleton />;
  }

  if (!htmlBody) {
    return <PlainTextMessageBody text={fallbackText || "No content."} />;
  }

  return (
    <HtmlMessageBody html={htmlBody} loadExternalImages={loadExternalImages} />
  );
};
