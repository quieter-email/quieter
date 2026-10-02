"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

const textVariants = cva("", {
  defaultVariants: {
    size: "body",
    tone: "default",
  },
  variants: {
    size: {
      body: "text-body",
      caption: "text-caption",
      lg: "text-body-lg",
      micro: "text-micro",
    },
    tone: {
      default: "text-fg",
      destructive: "text-destructive",
      muted: "text-muted-fg",
    },
    weight: {
      medium: "font-medium",
      semibold: "font-semibold",
    },
  },
});

export const Text = ({
  as: Tag = "p",
  className,
  size,
  tone,
  weight,
  ...props
}: ComponentPropsWithoutRef<"p"> &
  VariantProps<typeof textVariants> & {
    as?: "div" | "p" | "span";
  }) => (
  <Tag
    className={cn(textVariants({ size, tone, weight }), className)}
    {...props}
  />
);
