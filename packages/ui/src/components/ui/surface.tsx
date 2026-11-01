"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const surfaceVariants = cva("", {
  compoundVariants: [
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
      default: null,
      inset: null,
    },
    padding: { compact: "p-0.5", default: "p-4", none: "p-0" },
    variant: {
      detail: "rounded-md bg-detail",
      section: "rounded-section bg-section",
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
