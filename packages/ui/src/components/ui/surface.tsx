"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const surfaceVariants = cva("", {
  defaultVariants: { padding: "default", variant: "section" },
  variants: {
    padding: { default: "p-4", none: "p-0" },
    variant: {
      detail: "rounded-md bg-detail",
      section: "rounded-section bg-section",
    },
  },
});

export const Surface = ({
  className,
  padding,
  variant,
  ...props
}: ComponentPropsWithoutRef<"div"> & VariantProps<typeof surfaceVariants>) => (
  <div
    className={cn(surfaceVariants({ padding, variant }), className)}
    {...props}
  />
);
