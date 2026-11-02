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
    family: {
      mono: "font-mono",
      sans: "",
    },
    size: {
      body: "text-body",
      caption: "text-caption",
      lg: "text-body-lg",
      metric: "text-metric",
      micro: "text-micro",
      sm: "text-body-sm",
      title: "text-title-sm",
    },
    tone: {
      default: "text-fg",
      destructive: "text-destructive",
      muted: "text-muted-fg",
    },
    truncate: {
      true: "truncate",
    },
    weight: {
      medium: "font-medium",
      normal: "font-normal",
    },
  },
});

export const Text = ({
  as: Tag = "p",
  className,
  family,
  size,
  tone,
  truncate,
  weight,
  ...props
}: ComponentPropsWithoutRef<"p"> &
  VariantProps<typeof textVariants> & {
    as?: "div" | "h1" | "h2" | "h3" | "p" | "span";
  }) => (
  <Tag
    className={cn(
      textVariants({ family, size, tone, truncate, weight }),
      className
    )}
    {...props}
  />
);
