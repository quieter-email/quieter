"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const pillVariants = cva(
  "squircle inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none whitespace-nowrap",
  {
    variants: {
      size: {
        xs: "h-4 px-1.5 text-[10px]",
        sm: "h-5 px-2 text-[11px]",
      },
      tone: {
        gray: "bg-q-gray/15 text-q-gray",
        blue: "bg-q-blue/15 text-q-blue",
        cyan: "bg-q-cyan/15 text-q-cyan",
        green: "bg-q-green/15 text-q-green",
        yellow: "bg-q-yellow/15 text-q-yellow",
        orange: "bg-q-orange/15 text-q-orange",
        red: "bg-q-red/15 text-q-red",
        pink: "bg-q-pink/15 text-q-pink",
        purple: "bg-q-purple/15 text-q-purple",
        "access-reader": "bg-q-gray/15 text-q-gray",
        "access-responder": "bg-q-blue/15 text-q-blue",
        "access-manager": "bg-q-purple/15 text-q-purple",
        "mailbox-ready": "bg-q-green/15 text-q-green",
        "mailbox-attention": "bg-q-orange/15 text-q-orange",
        "mailbox-reconnect": "bg-q-red/15 text-q-red",
        "mailbox-api": "bg-q-blue/15 text-q-blue",
      },
    },
    defaultVariants: {
      size: "sm",
      tone: "gray",
    },
  },
);

export type PillTone = NonNullable<VariantProps<typeof pillVariants>["tone"]>;

type PillProps = ComponentPropsWithoutRef<"span"> & VariantProps<typeof pillVariants>;

export const Pill = ({ className, size = "sm", tone = "gray", ...props }: PillProps) => (
  <span className={cn(pillVariants({ size, tone }), className)} {...props} />
);
