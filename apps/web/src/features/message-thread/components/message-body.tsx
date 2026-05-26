"use client";

import { Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, useColorMode } from "@quieter/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useExternalImagesEnabled } from "~/features/settings/domain/external-images-setting";
import {
  applyEmailPreferences,
  fixNonReadableColors,
  linkifyText,
  preprocessEmailHtml,
  type ProcessedMailHtml,
} from "../domain/mail-html";

type MessageBodyProps = {
  html?: string;
  text?: string;
  isLoading?: boolean;
  loadExternalImages?: boolean;
};

const REMOTE_IMAGE_REGEX = /^https?:\/\//i;

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
  const shouldLoadImages = (loadExternalImages ?? externalImagesEnabled) || temporaryImagesEnabled;
  const preprocessedHtml = useMemo(() => preprocessEmailHtml(html), [html]);
  const processedMail = useMemo<ProcessedMailHtml>(
    () => applyEmailPreferences(preprocessedHtml, shouldLoadImages, colorMode),
    [colorMode, preprocessedHtml, shouldLoadImages],
  );
  const remoteImagesPresent = !shouldLoadImages && processedMail.hasBlockedImages;
  const handleImageErrorRef = useRef<(event: Event) => void>(() => {});

  useEffect(() => {
    if (!hostRef.current) return;

    shadowRootRef.current ??= hostRef.current.attachShadow({ mode: "open" });

    shadowRootRef.current.innerHTML = processedMail.processedHtml;
    fixNonReadableColors(shadowRootRef.current, {
      defaultBackground: colorMode === "dark" ? "#1A1A1A" : "#ffffff",
    });
  }, [colorMode, processedMail]);

  handleImageErrorRef.current = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;

    if (!shouldLoadImages && REMOTE_IMAGE_REGEX.test(target.currentSrc || target.src)) {
      setCspViolation(true);
    }
    target.style.display = "none";
  };

  useEffect(() => {
    const root = shadowRootRef.current;
    if (!root) return;

    const handleImageError = (event: Event) => handleImageErrorRef.current(event);
    root.addEventListener("error", handleImageError, true);

    const handleClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const link = target.closest("a");
      if (!link) return;

      event.preventDefault();
      const href = link.getAttribute("href");
      if (href?.startsWith("http://") || href?.startsWith("https://")) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else if (href?.startsWith("mailto:")) {
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
      {!shouldLoadImages && (remoteImagesPresent || cspViolation) && (
        <div
          aria-label="Remote images"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/80 bg-muted/35 px-3 py-2",
          )}
          role="region"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-xs ring-1 ring-border/55"
            >
              <HugeiconsIcon className="size-4 shrink-0" icon={Image01Icon} />
            </div>
            <p className="min-w-0 text-sm leading-snug text-muted-foreground">
              Remote images are hidden for security reasons.
            </p>
          </div>
          <Button
            className="w-fit shrink-0 sm:ml-auto"
            onClick={() => setTemporaryImagesEnabled(true)}
            size="sm"
            type="button"
            variant="default"
          >
            Show images
          </Button>
        </div>
      )}
      <div
        className="mail-content no-scrollbar w-full flex-1 overflow-scroll bg-transparent text-foreground"
        ref={hostRef}
      />
    </>
  );
};

const HtmlMessageBody = (props: { html: string; loadExternalImages?: boolean }) => (
  <HtmlMessageBodyContent key={props.html} {...props} />
);

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

const PlainTextMessageBody = ({ text }: { text: string }) => (
  <p className="bg-transparent p-4 text-base leading-7 wrap-break-word whitespace-pre-wrap text-foreground">
    {linkifyText(text).map((segment, index) =>
      segment.kind === "link" ? (
        <a
          className="text-primary underline decoration-border underline-offset-2 hover:decoration-current"
          href={segment.href}
          key={`${segment.href}-${index}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {segment.value}
        </a>
      ) : (
        <span key={`${segment.value}-${index}`}>{segment.value}</span>
      ),
    )}
  </p>
);

export const MessageBody = ({ html, isLoading, loadExternalImages, text }: MessageBodyProps) => {
  const fallbackText = text?.trim();
  const htmlBody = html?.trim();

  if (!htmlBody && !fallbackText && isLoading) {
    return <MessageBodyLoadingSkeleton />;
  }

  if (!htmlBody) {
    return <PlainTextMessageBody text={fallbackText || "No content."} />;
  }

  return <HtmlMessageBody html={htmlBody} loadExternalImages={loadExternalImages} />;
};
