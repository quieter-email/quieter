"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

const pillVariants = cva(
  "squircle inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none whitespace-nowrap",
  {
    defaultVariants: {
      size: "sm",
      tone: "gray",
    },
    variants: {
      size: {
        sm: "h-5 px-2 text-micro",
        xs: "h-4 px-1.5 text-[10px]",
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
    },
  }
);

export type PillTone = NonNullable<VariantProps<typeof pillVariants>["tone"]>;

type PillProps = ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof pillVariants>;

export const Pill = ({
  className,
  size = "sm",
  tone = "gray",
  ...props
}: PillProps) => (
  <span className={cn(pillVariants({ size, tone }), className)} {...props} />
);
