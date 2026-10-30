"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

const iconVariants = cva(
  "shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none",
  {
    variants: {
      animation: {
        pulse: "animate-pulse motion-reduce:animate-none",
        spin: "animate-spin motion-reduce:animate-none",
      },
      tone: {
        default: "text-fg",
        destructive: "text-destructive",
        muted: "text-muted-fg",
        success: "text-success",
      },
    },
  }
);

export type IconProps = Omit<
  ComponentProps<typeof HugeiconsIcon>,
  "absoluteStrokeWidth" | "strokeWidth"
> &
  VariantProps<typeof iconVariants>;

export const Icon = ({
  animation,
  className,
  size = 16,
  tone,
  ...props
}: IconProps) => (
  <HugeiconsIcon
    aria-hidden
    className={cn(iconVariants({ animation, tone }), className)}
    size={size}
    strokeWidth={1.75}
    {...props}
  />
);
