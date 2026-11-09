"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const surfaceVariants = cva("", {
  compoundVariants: [
    { chrome: "compact", className: "rounded-lg" },
    {
      chrome: "bubble",
      className: "rounded-section",
    },
    {
      chrome: "inset",
      className: "rounded-[calc(var(--radius-section)_-_var(--spacing)*0.5)]",
    },
  ],
  defaultVariants: {
    chrome: "default",
    padding: "default",
    variant: "section",
  },
  variants: {
    chrome: {
      bubble: null,
      compact: null,
      default: null,
      inset: null,
    },
    padding: {
      comfortable: "p-6",
      compact: "p-0.5",
      default: "p-4",
      dense: "p-2",
      none: "p-0",
      snug: "p-3",
    },
    variant: {
      detail: "rounded-md bg-detail",
      panel: "rounded-panel bg-panel",
      section: "rounded-section bg-section",
      selection: "rounded-md bg-selection",
    },
  },
});

export const Surface = ({
  className,
  chrome,
  padding,
  variant,
  ...props
}: ComponentPropsWithoutRef<"div"> & VariantProps<typeof surfaceVariants>) => (
  <div
    className={cn(surfaceVariants({ chrome, padding, variant }), className)}
    {...props}
  />
);
