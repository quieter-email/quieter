"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const pillVariants = cva(
  "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap",
  {
    defaultVariants: {
      shape: "box",
      size: "sm",
      tone: "gray",
      variant: "soft",
    },
    variants: {
      shape: {
        box: "squircle rounded-sm",
        circle: "not-squircle rounded-full",
      },
      // Padding, not a fixed height: the label should sit in the pill rather
      // than fill it, and the box grows from the type instead of cropping it.
      // The leading rides on the size token because tailwind-merge drops a
      // standalone `leading-*` that a font size later in the merge overrides.
      size: {
        icon: "size-4.5 p-0 text-micro/none",
        sm: "px-2.5 py-1.5 text-micro/none",
        xs: "px-2 py-1 text-micro/none",
      },
      tone: {
        "access-manager": "bg-q-purple/15 text-q-purple",
        "access-reader": "bg-q-gray/15 text-q-gray",
        "access-responder": "bg-q-blue/15 text-q-blue",
        blue: "bg-q-blue/15 text-q-blue",
        cyan: "bg-q-cyan/15 text-q-cyan",
        gray: "bg-q-gray/15 text-q-gray",
        green: "bg-q-green/15 text-q-green",
        "mailbox-api": "bg-q-blue/15 text-q-blue",
        "mailbox-attention": "bg-q-orange/15 text-q-orange",
        "mailbox-ready": "bg-q-green/15 text-q-green",
        "mailbox-reconnect": "bg-q-red/15 text-q-red",
        orange: "bg-q-orange/15 text-q-orange",
        pink: "bg-q-pink/15 text-q-pink",
        purple: "bg-q-purple/15 text-q-purple",
        red: "bg-q-red/15 text-q-red",
        yellow: "bg-q-yellow/15 text-q-yellow",
      },
      variant: {
        outline: "border border-current bg-transparent",
        soft: "",
      },
    },
  }
);

export type PillTone = NonNullable<VariantProps<typeof pillVariants>["tone"]>;

type PillProps = ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof pillVariants>;

export const Pill = ({
  className,
  size = "sm",
  shape = "box",
  tone = "gray",
  variant = "soft",
  ...props
}: PillProps) => (
  <span
    className={cn(pillVariants({ shape, size, tone, variant }), className)}
    {...props}
  />
);
