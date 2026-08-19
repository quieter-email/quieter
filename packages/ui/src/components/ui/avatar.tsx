"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

const avatarRootVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-fg",
  {
    defaultVariants: {
      size: "default",
    },
    variants: {
      size: {
        default: "size-10 text-body",
        lg: "size-12 text-body-lg",
        sm: "size-8 text-caption",
      },
    },
  }
);

export const Avatar = ({
  className,
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> &
  VariantProps<typeof avatarRootVariants>) => (
  <AvatarPrimitive.Root
    className={cn(avatarRootVariants({ size }), className)}
    {...props}
  />
);
