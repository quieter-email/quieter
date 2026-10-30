"use client";

import {
  ArrowUpRight01Icon,
  Calendar03Icon,
  Image01Icon,
} from "@hugeicons/core-free-icons";
import { ORPCError } from "@orpc/client";
import {
  applyEmailPreferences,
  getCalendarLinks,
  linkifyText,
  normalizeMailContentId,
  preprocessEmailHtml,
} from "@quieter/app/features/message-thread/domain/mail-html";
import type { CalendarLink } from "@quieter/app/features/message-thread/domain/mail-html";
import { useExternalImagesEnabled } from "@quieter/app/features/settings/domain/external-images-setting";
import { isExpectedClientError } from "@quieter/app/lib/client-error-reporting";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { loadMessageAttachment } from "@quieter/app/lib/mail/attachments";
import { Button, buttonVariants } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import * as Sentry from "@sentry/react";
import { useQueries } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

type MessageBodyProps = {
  mailboxId: string;
  message: Pick<
    MessageListItem,
    "id" | "bodyHtml" | "bodyText" | "inlineImages"
  >;
  isLoading?: boolean;
  loadExternalImages?: boolean;
};

const REMOTE_IMAGE_REGEX = /^https?:\/\//iu;

const focusMailElement = (element: HTMLElement) => {
  if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener(
      "blur",
      () => {
        element.removeAttribute("tabindex");
      },
      {
        once: true,
      }
    );
  }
  element.focus({ preventScroll: true });
};

const combineInlineImageQueries = (queries: UseQueryResult<File>[]) => ({
  errors: queries.map((query) => query.error),
  files: queries.map((query) => query.data),
});

const CalendarLinkActions = ({ links }: { links: CalendarLink[] }) => {
  if (links.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Calendar actions"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted px-3 py-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-raised text-muted-fg shadow-xs"
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
  inlineImages,
  loadExternalImages,
  mailboxId,
  messageId,
}: {
  html: string;
  inlineImages: MessageListItem["inlineImages"];
  loadExternalImages?: boolean;
  mailboxId: string;
  messageId: string;
}) => {
  const externalImagesEnabled = useExternalImagesEnabled();
  const [cspViolation, setCspViolation] = useState(false);
  const [temporaryImagesEnabled, setTemporaryImagesEnabled] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const reportedInlineImageErrorsRef = useRef(new WeakSet<Error>());
  // react-doctor-disable-next-line react-doctor/no-event-handler
  const shouldLoadImages =
    (loadExternalImages ?? externalImagesEnabled) || temporaryImagesEnabled;
  const preprocessedHtml = useMemo(() => preprocessEmailHtml(html), [html]);
  const processedMail = useMemo(
    () => applyEmailPreferences(preprocessedHtml, shouldLoadImages, "light"),
    [preprocessedHtml, shouldLoadImages]
  );
  const inlineAttachments = useMemo(() => {
    const referencedContentIds = new Set(processedMail.referencedContentIds);
    const attachments = new Map<
      string,
      NonNullable<MessageListItem["inlineImages"]>[number] | null
    >();

    for (const attachment of inlineImages ?? []) {
      const contentId = normalizeMailContentId(attachment.contentId);
      if (!contentId || !referencedContentIds.has(contentId)) {
        continue;
      }
      attachments.set(
        contentId,
        attachments.has(contentId) ? null : attachment
      );
    }

    return [...attachments].flatMap(([contentId, attachment]) =>
      attachment ? [{ attachment, contentId }] : []
    );
  }, [inlineImages, processedMail.referencedContentIds]);
  const inlineImageQueries = useQueries({
    combine: combineInlineImageQueries,
    queries: inlineAttachments.map(({ attachment }) => ({
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        await loadMessageAttachment({
          attachment,
          mailboxId,
          messageId,
          signal,
        }),
      queryKey: [
        "message-attachment",
        mailboxId,
        messageId,
        attachment.attachmentId,
      ],
      staleTime: Infinity,
    })),
  });
  const remoteImagesPresent =
    !shouldLoadImages && processedMail.hasBlockedImages;

  useEffect(() => {
    for (const error of inlineImageQueries.errors) {
      if (
        error &&
        !isExpectedClientError(error) &&
        !(error instanceof ORPCError && error.status < 500) &&
        error.name !== "AbortError" &&
        !reportedInlineImageErrorsRef.current.has(error)
      ) {
        reportedInlineImageErrorsRef.current.add(error);
        Sentry.captureException(
          new Error("An inline message image could not be loaded."),
          { tags: { boundary: "message-inline-image" } }
        );
      }
    }
  }, [inlineImageQueries.errors]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    // `all` leaves custom properties inherited from the app intact.
    const inheritedCustomProperties = [...getComputedStyle(host)].filter(
      (property) => property.startsWith("--")
    );
    for (const property of inheritedCustomProperties) {
      host.style.setProperty(property, "initial");
    }

    let shadowRoot = shadowRootRef.current;
    if (!shadowRoot) {
      shadowRoot = host.attachShadow({ mode: "open" });
      shadowRootRef.current = shadowRoot;
    }

    const previousElements = [...shadowRoot.querySelectorAll("*")];
    const detailsStates = previousElements.flatMap((element, index) =>
      element instanceof HTMLDetailsElement
        ? [{ index, open: element.open }]
        : []
    );
    const focusedElementIndex = shadowRoot.activeElement
      ? previousElements.indexOf(shadowRoot.activeElement)
      : -1;
    const inlineImageUrls = new Map<string, string>();
    for (const [index, { contentId }] of inlineAttachments.entries()) {
      const file = inlineImageQueries.files[index];
      if (file) {
        inlineImageUrls.set(contentId, URL.createObjectURL(file));
      }
    }

    const resolvedMail = applyEmailPreferences(
      preprocessedHtml,
      shouldLoadImages,
      "light",
      inlineImageUrls
    );
    const parsedDocument = new DOMParser().parseFromString(
      resolvedMail.processedHtml,
      "text/html"
    );
    const nextDocument = document.importNode(
      parsedDocument.documentElement,
      true
    );
    const nextElements = [nextDocument, ...nextDocument.querySelectorAll("*")];
    for (const { index, open } of detailsStates) {
      const element = nextElements[index];
      if (element instanceof HTMLDetailsElement) {
        element.open = open;
      }
    }
    shadowRoot.replaceChildren(nextDocument);

    const nextFocusedElement = nextElements[focusedElementIndex];
    if (nextFocusedElement instanceof HTMLElement) {
      focusMailElement(nextFocusedElement);
    }

    return () => {
      for (const objectUrl of inlineImageUrls.values()) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    inlineAttachments,
    inlineImageQueries.files,
    preprocessedHtml,
    shouldLoadImages,
  ]);

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
  });

  useEffect(() => {
    const root = shadowRootRef.current;
    if (!root) {
      return;
    }

    root.addEventListener("error", handleImageError, true);

    const handleClick = (event: Event) => {
      const { target } = event;
      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest("a");
      if (!link) {
        return;
      }
      if (
        event instanceof MouseEvent &&
        event.type === "auxclick" &&
        event.button !== 1
      ) {
        return;
      }

      event.preventDefault();
      const href = link.getAttribute("href");
      if (!href) {
        return;
      }
      if (href.startsWith("#")) {
        let fragment = href.slice(1);
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          // Malformed escapes can still be literal element IDs.
        }
        const destination = fragment
          ? (root.querySelector(`#${CSS.escape(fragment)}`) ??
            [...root.querySelectorAll("a[name]")].find(
              (anchor) => anchor.getAttribute("name") === fragment
            ))
          : root.querySelector("body");
        if (destination instanceof HTMLElement) {
          let ancestor: HTMLElement | null = destination;
          while (ancestor) {
            if (ancestor instanceof HTMLDetailsElement) {
              ancestor.open = true;
            }
            ancestor = ancestor.parentElement;
          }
          destination.scrollIntoView({ block: "start" });
          focusMailElement(destination);
        }
      } else if (REMOTE_IMAGE_REGEX.test(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else if (/^mailto:/iu.test(href)) {
        window.location.href = href;
      }
    };

    root.addEventListener("click", handleClick);
    root.addEventListener("auxclick", handleClick);

    return () => {
      root.removeEventListener("error", handleImageError, true);
      root.removeEventListener("click", handleClick);
      root.removeEventListener("auxclick", handleClick);
    };
  }, []);

  return (
    <>
      <CalendarLinkActions links={processedMail.calendarLinks} />
      {!shouldLoadImages && (remoteImagesPresent || cspViolation) && (
        <section
          aria-label="Remote images"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted px-3 py-2"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-raised text-muted-fg shadow-xs"
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
      <div className="relative isolate w-full max-w-full min-w-0 overflow-x-auto contain-content">
        <div
          ref={hostRef}
          style={{
            // oxlint-disable shadcn/no-inline-styles -- Sender documents must not inherit app presentation.
            all: "initial",
            direction: "ltr",
            display: "block",
            unicodeBidi: "normal",
            // oxlint-enable shadcn/no-inline-styles
          }}
        />
      </div>
    </>
  );
};

const MessageBodyLoadingSkeleton = () => (
  <output aria-label="Loading message content" className="block space-y-3 p-4">
    <div aria-hidden="true" className="animate-pulse space-y-3">
      <div className="h-3.5 w-full rounded-md bg-muted" />
      <div className="h-3.5 w-11/12 rounded-md bg-muted" />
      <div className="h-3.5 w-4/5 rounded-md bg-muted" />
      <div className="h-3.5 w-2/3 rounded-md bg-muted" />
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
              className="rounded-sm text-primary underline decoration-border underline-offset-2 hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
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
  isLoading,
  loadExternalImages,
  mailboxId,
  message,
}: MessageBodyProps) => {
  const fallbackText = message.bodyText?.trim();
  const htmlBody = message.bodyHtml?.trim();

  if (!htmlBody && !fallbackText && isLoading === true) {
    return <MessageBodyLoadingSkeleton />;
  }

  if (!htmlBody) {
    return <PlainTextMessageBody text={fallbackText || "No content."} />;
  }

  return (
    <HtmlMessageBodyContent
      html={htmlBody}
      inlineImages={message.inlineImages}
      key={JSON.stringify([mailboxId, message.id, htmlBody])}
      loadExternalImages={loadExternalImages}
      mailboxId={mailboxId}
      messageId={message.id}
    />
  );
};
