"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";

const spinnerIconVariants = cva("animate-spin", {
  defaultVariants: {
    size: "md",
  },
  variants: {
    size: {
      md: "size-4",
      sm: "size-3.5",
    },
  },
});

export const SpinnerIcon = ({
  className,
  icon = Loading03Icon,
  size,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Icon>, "icon"> &
  VariantProps<typeof spinnerIconVariants> & {
    icon?: ComponentPropsWithoutRef<typeof Icon>["icon"];
  }) => (
  <Icon
    aria-hidden
    className={cn(spinnerIconVariants({ size }), className)}
    icon={icon}
    {...props}
  />
);
