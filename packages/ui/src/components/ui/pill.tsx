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
        blue: "bg-q-blue/65 text-q-blue-fg dark:bg-q-blue/15",
        cyan: "bg-q-cyan/65 text-q-cyan-fg dark:bg-q-cyan/15",
        destructive: "bg-destructive/10 text-destructive",
        gray: "bg-q-gray/65 text-q-gray-fg dark:bg-q-gray/15",
        green: "bg-q-green/65 text-q-green-fg dark:bg-q-green/15",
        neutral: "bg-muted text-muted-fg",
        orange: "bg-q-orange/65 text-q-orange-fg dark:bg-q-orange/15",
        pink: "bg-q-pink/65 text-q-pink-fg dark:bg-q-pink/15",
        purple: "bg-q-purple/65 text-q-purple-fg dark:bg-q-purple/15",
        red: "bg-q-red/65 text-q-red-fg dark:bg-q-red/15",
        success: "bg-success/15 text-success",
        yellow: "bg-q-yellow/65 text-q-yellow-fg dark:bg-q-yellow/15",
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
