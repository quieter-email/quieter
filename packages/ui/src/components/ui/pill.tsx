"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { cn } from "../../lib/cn";

export const pillVariants = cva(
  "squircle inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap",
  {
    defaultVariants: {
      size: "sm",
      tone: "gray",
    },
    variants: {
      // Padding, not a fixed height: the label should sit in the pill rather
      // than fill it, and the box grows from the type instead of cropping it.
      // The leading rides on the size token because tailwind-merge drops a
      // standalone `leading-*` that a font size later in the merge overrides.
      size: {
        sm: "px-2.5 py-1.5 text-micro/none",
        xs: "px-2 py-1 text-micro/none",
      },
      tone: {
        blue: "bg-q-blue/15 text-q-blue",
        cyan: "bg-q-cyan/15 text-q-cyan",
        destructive: "bg-destructive/10 text-destructive",
        gray: "bg-q-gray/15 text-q-gray",
        green: "bg-q-green/15 text-q-green",
        neutral: "bg-muted text-muted-fg",
        orange: "bg-q-orange/15 text-q-orange",
        pink: "bg-q-pink/15 text-q-pink",
        purple: "bg-q-purple/15 text-q-purple",
        red: "bg-q-red/15 text-q-red",
        success: "bg-success/15 text-success",
        yellow: "bg-q-yellow/15 text-q-yellow",
      },
    },
  }
);

export type PillTone = NonNullable<VariantProps<typeof pillVariants>["tone"]>;

type PillProps = ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof pillVariants> & { customColor?: string };

export const Pill = ({
  className,
  customColor,
  size = "sm",
  tone = "gray",
  style,
  ...props
}: PillProps) => {
  const pillStyle: CSSProperties & { "--selected-color": string | undefined } =
    { "--selected-color": customColor, ...style };
  return (
    <span
      className={cn(
        pillVariants({ size, tone }),
        { "q-custom-color-surface text-fg": !!customColor },
        className
      )}
      style={pillStyle}
      {...props}
    />
  );
};
