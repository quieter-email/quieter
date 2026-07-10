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
        gray: "bg-label-gray text-label-gray-foreground",
        blue: "bg-label-blue text-label-blue-foreground",
        cyan: "bg-label-cyan text-label-cyan-foreground",
        green: "bg-label-green text-label-green-foreground",
        yellow: "bg-label-yellow text-label-yellow-foreground",
        orange: "bg-label-orange text-label-orange-foreground",
        red: "bg-label-red text-label-red-foreground",
        pink: "bg-label-pink text-label-pink-foreground",
        purple: "bg-label-purple text-label-purple-foreground",
        "access-reader": "bg-access-reader text-access-reader-foreground",
        "access-responder": "bg-access-responder text-access-responder-foreground",
        "access-manager": "bg-access-manager text-access-manager-foreground",
        "mailbox-ready": "bg-mailbox-status-ready text-mailbox-status-ready-foreground",
        "mailbox-attention": "bg-mailbox-status-attention text-mailbox-status-attention-foreground",
        "mailbox-reconnect": "bg-mailbox-status-reconnect text-mailbox-status-reconnect-foreground",
        "mailbox-api": "bg-mailbox-status-api text-mailbox-status-api-foreground",
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
