"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export const mailListRowFrameVariants = cva(
  "group/row relative flex h-17 items-stretch rounded-lg",
  {
    defaultVariants: {
      layout: "stacked",
    },
    variants: {
      accent: {
        yellow:
          "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-0 after:w-1/3 after:rounded-lg after:bg-linear-to-l after:from-q-yellow/8 after:via-q-yellow/4 after:to-transparent after:content-['']",
      },
      layout: {
        adaptive: "@3xl:h-12",
        stacked: "",
      },
    },
  }
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
          "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] @3xl:items-center @3xl:gap-3":
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
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {badge !== undefined && badge !== null && (
            <span className="inline-flex shrink-0 items-center justify-center">
              {badge}
            </span>
          )}
          <p className="min-w-0 truncate text-left text-body-sm/4.5 text-fg">
            {senderPrefix !== undefined && senderPrefix !== null && (
              <span className="font-medium text-muted-fg">{senderPrefix}</span>
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

        <div
          className={cn("flex shrink-0 items-center gap-2", {
            "@3xl:col-start-3 @3xl:row-start-1": layout === "adaptive",
          })}
        >
          {metadata}
          <span
            className={cn("shrink-0 text-caption tabular-nums", {
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
          "@3xl:col-start-2 @3xl:row-start-1": layout === "adaptive",
        })}
      >
        <p
          className={cn("min-w-0 flex-1 truncate text-left text-body-sm/4.5", {
            "font-medium text-fg": unread,
            "text-muted-fg": !unread,
          })}
        >
          {subject}
        </p>
        {subjectTrailing}
      </div>
    </div>
  </div>
);
