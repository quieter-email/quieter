"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export const mailListRowFrameVariants = cva(
  "group/row relative flex h-17 items-stretch border-b border-border",
  {
    defaultVariants: {
      layout: "stacked",
    },
    variants: {
      accent: {
        yellow:
          "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-0 after:w-1/3 after:bg-linear-to-l after:from-q-yellow/8 after:via-q-yellow/4 after:to-transparent after:content-['']",
      },
      layout: {
        adaptive: "@3xl:h-12",
        stacked: "",
      },
    },
  }
);

export const mailListRowParts = {
  overlay: "pointer-events-none absolute inset-0 z-0 bg-muted",
  selectionButton:
    "relative size-9.5 rounded-lg border border-transparent focus-visible:z-20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none disabled:pointer-events-none",
  selectionCell:
    "relative z-10 ml-2 flex h-full shrink-0 items-center justify-center @sm:ml-3",
  trigger:
    "absolute inset-0 z-10 border border-transparent text-left focus-visible:z-20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
  unreadIndicator:
    "pointer-events-none absolute top-1/2 left-0 z-20 h-8 w-0.75 -translate-y-1/2 rounded-r-full bg-primary",
  viewport:
    "min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] contain-strict",
} as const;

export const MailListRowSelectionMark = ({
  selected,
}: {
  selected: boolean;
}) => (
  <span
    className={cn(
      "flex size-4.5 items-center justify-center rounded-[5px] border bg-bg-raised text-transparent shadow-xs transition-[background-color,border-color,color] duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out)",
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

type MailListRowDetailsProps = VariantProps<typeof mailListRowFrameVariants> & {
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
  <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-2 px-2 @sm:gap-3 @sm:px-3">
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden",
        {
          "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,2fr)_minmax(0,1fr)_calc(var(--spacing)*36)_calc(var(--spacing)*16)] @3xl:items-center @3xl:gap-3":
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
                <span
                  className={cn(
                    "ml-2 hidden text-micro text-muted-fg @sm:inline",
                    {
                      "@3xl:hidden": layout === "adaptive",
                    }
                  )}
                >
                  {senderEmail}
                </span>
              )}
            </p>
          </div>
          <span
            className={cn("hidden min-w-0 truncate text-micro text-muted-fg", {
              "@3xl:col-start-2 @3xl:row-start-1 @3xl:block":
                layout === "adaptive",
            })}
          >
            {senderEmail}
          </span>
        </div>

        <div
          className={cn("flex shrink-0 items-center gap-2", {
            "@3xl:contents": layout === "adaptive",
          })}
        >
          <div
            className={cn("contents min-w-0 items-center gap-2", {
              "@3xl:col-start-5 @3xl:row-start-1 @3xl:flex @3xl:flex-wrap @3xl:gap-y-1":
                layout === "adaptive",
            })}
          >
            {metadata}
          </div>
          <span
            className={cn("shrink-0 text-caption tabular-nums", {
              "@3xl:col-start-6 @3xl:row-start-1": layout === "adaptive",
              "font-semibold text-fg/90": unread,
              "text-fg/75": active && !unread,
              "text-muted-fg": !unread,
            })}
            suppressHydrationWarning
          >
            {timestamp}
          </span>
        </div>
      </div>

      <div
        className={cn("flex w-full min-w-0 items-center gap-1.5", {
          "@3xl:contents": layout === "adaptive",
        })}
      >
        <p
          className={cn("min-w-0 flex-1 truncate text-left text-body-sm/4.5", {
            "@3xl:col-start-3 @3xl:row-start-1": layout === "adaptive",
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
