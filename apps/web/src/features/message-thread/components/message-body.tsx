"use client";

import { Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, useColorMode } from "@quieter/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useExternalImagesEnabled } from "~/features/settings/domain/external-images-setting";
import {
  applyEmailPreferences,
  fixNonReadableColors,
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

const HtmlMessageBody = ({
  html,
  loadExternalImages,
}: {
  html: string;
  loadExternalImages?: boolean;
}) => {
  const { colorMode } = useColorMode();
  const externalImagesEnabled = useExternalImagesEnabled();
  const [cspViolation, setCspViolation] = useState(false);
  const [processedMail, setProcessedMail] = useState<ProcessedMailHtml | null>(null);
  const [preprocessedHtml, setPreprocessedHtml] = useState<string | null>(null);
  const [remoteImagesPresent, setRemoteImagesPresent] = useState(false);
  const [temporaryImagesEnabled, setTemporaryImagesEnabled] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const shouldLoadImages = (loadExternalImages ?? externalImagesEnabled) || temporaryImagesEnabled;

  useEffect(() => {
    setCspViolation(false);
    setProcessedMail(null);
    setRemoteImagesPresent(false);
    setTemporaryImagesEnabled(false);
    setPreprocessedHtml(preprocessEmailHtml(html));
  }, [html]);

  useEffect(() => {
    if (!preprocessedHtml) return;

    const processed = applyEmailPreferences(preprocessedHtml, shouldLoadImages, colorMode);
    setProcessedMail(processed);

    if (!shouldLoadImages) {
      setRemoteImagesPresent(processed.hasBlockedImages);
    }
  }, [colorMode, preprocessedHtml, shouldLoadImages]);

  useEffect(() => {
    if (!hostRef.current) return;

    shadowRootRef.current ??= hostRef.current.attachShadow({ mode: "open" });

    if (!processedMail) {
      shadowRootRef.current.innerHTML = "";
      return;
    }

    shadowRootRef.current.innerHTML = processedMail.processedHtml;
    fixNonReadableColors(shadowRootRef.current, {
      defaultBackground: colorMode === "dark" ? "#1A1A1A" : "#ffffff",
    });
  }, [colorMode, processedMail]);

  const handleImageError = useCallback(
    (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;

      if (!shouldLoadImages && REMOTE_IMAGE_REGEX.test(target.currentSrc || target.src)) {
        setCspViolation(true);
      }
      target.style.display = "none";
    },
    [shouldLoadImages],
  );

  useEffect(() => {
    const root = shadowRootRef.current;
    if (!root) return;

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
  }, [handleImageError, html, shouldLoadImages]);

  useEffect(() => {
    if (shouldLoadImages) {
      setCspViolation(false);
    }
  }, [shouldLoadImages]);

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
        className="mail-content no-scrollbar w-full flex-1 overflow-scroll bg-background-light text-foreground"
        ref={hostRef}
      />
    </>
  );
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

export const MessageBody = ({ html, isLoading, loadExternalImages, text }: MessageBodyProps) => {
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

  return <HtmlMessageBody html={htmlBody} loadExternalImages={loadExternalImages} />;
};
