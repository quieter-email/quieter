"use client";

import {
  FileAttachmentIcon,
  MessageMultiple01Icon,
} from "@hugeicons/core-free-icons";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";
import { Pill } from "./pill";

export const mailListRowFrameVariants = cva(
  "group/row relative flex h-19 items-stretch rounded-xl",
  {
    defaultVariants: {
      layout: "stacked",
    },
    variants: {
      accent: {
        yellow:
          "after:pointer-events-none after:absolute after:inset-y-0 after:right-2 after:z-0 after:w-1/3 after:rounded-r-lg after:bg-linear-to-l after:from-q-yellow/8 after:via-q-yellow/4 after:to-transparent after:content-['']",
      },
      layout: {
        adaptive: "@3xl:h-14",
        stacked: "",
      },
    },
  }
);

const rowOverlayClassName =
  "pointer-events-none absolute inset-x-2 z-0 rounded-lg bg-selection/45 dark:bg-selection";

export const mailListRowParts = {
  listOverlay: `${rowOverlayClassName} inset-y-0`,
  overlay: `${rowOverlayClassName} inset-y-1`,
  selectionButton:
    "relative size-9.5 rounded-lg border border-transparent focus-visible:z-20 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden disabled:pointer-events-none",
  selectionCell:
    "relative z-10 ml-3 flex h-full shrink-0 items-center justify-center @sm:ml-4",
  trigger:
    "absolute inset-0 z-10 rounded-xl border border-transparent text-left focus-visible:z-20 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden",
  unreadIndicator:
    "pointer-events-none absolute top-1/2 left-0 z-20 h-8 w-0.75 -translate-y-1/2 rounded-r-full bg-primary",
  viewport:
    "min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] contain-strict",
} as const;

export const MailListRowSelectionMark = ({
  selected,
}: {
  selected: boolean;
}) => (
  <span
    className={cn(
      "flex size-4.5 items-center justify-center rounded-xs border bg-section text-transparent shadow-xs transition-[background-color,border-color,color] duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out)",
      {
        "border-border": !selected,
        "border-primary bg-primary text-primary-fg": selected,
      }
    )}
  >
    <svg
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 14 14"
    >
      <path d="M3 7.5 5.75 10 11 4.75" />
    </svg>
  </span>
);

export const MailListRowMetadata = ({
  attachmentCount,
  attachmentNames,
  layout = "stacked",
  messageCount,
  title,
}: Pick<VariantProps<typeof mailListRowFrameVariants>, "layout"> & {
  attachmentCount: number;
  attachmentNames: readonly string[];
  messageCount: number;
  title?: string;
}) => {
  if (attachmentCount === 0 && messageCount <= 1) {
    return null;
  }

  const attachmentNamesText = attachmentNames.join(", ");
  const showAttachmentNames =
    layout === "adaptive" && attachmentNames.length > 0;

  return (
    <>
      <Pill
        className={cn({ "@3xl:hidden": showAttachmentNames })}
        size="xs"
        title={title}
        tone="neutral"
      >
        <span className="inline-flex items-center gap-1 tabular-nums">
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon aria-hidden icon={FileAttachmentIcon} size={12} />
              <span>{attachmentCount}</span>
            </span>
          )}
          {messageCount > 1 && (
            <span className="inline-flex items-center gap-1">
              <Icon aria-hidden icon={MessageMultiple01Icon} size={12} />
              <span>{messageCount}</span>
            </span>
          )}
        </span>
      </Pill>
      {showAttachmentNames && (
        <span className="hidden @3xl:contents">
          <Pill
            className="max-w-80 min-w-0 shrink gap-1"
            size="xs"
            title={attachmentNamesText}
            tone="neutral"
          >
            <Icon aria-hidden icon={FileAttachmentIcon} size={12} />
            <span className="truncate">{attachmentNamesText}</span>
          </Pill>
          {messageCount > 1 && (
            <Pill size="xs" title={title} tone="neutral">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Icon aria-hidden icon={MessageMultiple01Icon} size={12} />
                {messageCount}
              </span>
            </Pill>
          )}
        </span>
      )}
    </>
  );
};

type MailListRowDetailsProps = VariantProps<typeof mailListRowFrameVariants> & {
  actions?: ReactNode;
  active?: boolean;
  badge?: ReactNode;
  metadata?: ReactNode;
  sender: string;
  senderEmail?: string;
  senderPrefix?: ReactNode;
  subject: ReactNode;
  subjectTrailing?: ReactNode;
  timestamp: ReactNode;
  unread?: boolean;
};

export const MailListRowDetails = ({
  actions,
  active = false,
  badge,
  layout = "stacked",
  metadata,
  sender,
  senderEmail,
  senderPrefix,
  subject,
  subjectTrailing,
  timestamp,
  unread = false,
}: MailListRowDetailsProps) => (
  <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-2 pr-5 pl-3 @sm:gap-3 @sm:pr-6 @sm:pl-4">
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-x-clip",
        {
          "@3xl:grid @3xl:grid-cols-[clamp(calc(var(--spacing)*40),25%,calc(var(--spacing)*72))_minmax(calc(var(--spacing)*24),1fr)_minmax(0,max-content)_minmax(0,max-content)_calc(var(--spacing)*16)] @3xl:items-center @3xl:gap-3":
            layout === "adaptive",
        }
      )}
    >
      <div
        className={cn(
          "flex w-full min-w-0 items-center justify-between gap-2",
          { "@3xl:contents": layout === "adaptive" }
        )}
      >
        <div
          className={cn("flex min-w-0 flex-1 items-center gap-1.5", {
            "@3xl:contents": layout === "adaptive",
          })}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {badge !== undefined && badge !== null && (
              <span className="inline-flex shrink-0 items-center justify-center">
                {badge}
              </span>
            )}
            <p className="min-w-0 truncate text-left text-body-sm/4.5 text-fg">
              {senderPrefix !== undefined && senderPrefix !== null && (
                <span className="font-medium text-muted-fg">
                  {senderPrefix}
                </span>
              )}
              <span
                className={cn({
                  "font-medium": !unread,
                  "font-semibold": unread,
                })}
              >
                {sender}
              </span>
              {senderEmail && (
                <span className="ml-2 hidden text-micro text-muted-fg @sm:inline">
                  {senderEmail}
                </span>
              )}
            </p>
          </div>
        </div>

        <div
          className={cn("flex shrink-0 items-center gap-2", {
            "@3xl:contents": layout === "adaptive",
          })}
        >
          <div
            className={cn("contents min-w-0 items-center gap-2", {
              "@3xl:col-start-3 @3xl:row-start-1 @3xl:flex":
                layout === "adaptive",
            })}
          >
            {metadata}
          </div>
          <div
            className={cn(
              "grid shrink-0 grid-cols-1 items-center justify-items-end",
              {
                "@3xl:col-start-5 @3xl:row-start-1": layout === "adaptive",
              }
            )}
          >
            <span
              className={cn(
                "col-start-1 row-start-1 text-caption tabular-nums transition-opacity duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out)",
                {
                  "font-semibold text-fg/90": unread,
                  "group-hover/row:opacity-0 group-has-focus-visible/row:opacity-0":
                    actions !== undefined && actions !== null,
                  "text-fg/75": active && !unread,
                  "text-muted-fg": !unread,
                }
              )}
              suppressHydrationWarning
            >
              {timestamp}
            </span>
            {actions !== undefined && actions !== null && (
              <div className="pointer-events-none col-start-1 row-start-1 flex items-center gap-1 justify-self-stretch opacity-0 transition-opacity duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out) *:flex-1 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-has-focus-visible/row:pointer-events-auto group-has-focus-visible/row:opacity-100">
                {actions}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={cn("flex w-full min-w-0 items-center gap-1.5", {
          "@3xl:contents": layout === "adaptive",
        })}
      >
        <p
          className={cn("min-w-0 flex-1 truncate text-left text-body-sm/4.5", {
            "@3xl:col-start-2 @3xl:row-start-1": layout === "adaptive",
            "font-medium text-fg": unread,
            "text-muted-fg": !unread,
          })}
        >
          {subject}
        </p>
        <div
          className={cn("contents min-w-0 items-center gap-1.5", {
            "@3xl:col-start-4 @3xl:row-start-1 @3xl:flex @3xl:flex-wrap @3xl:gap-y-1":
              layout === "adaptive",
          })}
        >
          {subjectTrailing}
        </div>
      </div>
    </div>
  </div>
);
