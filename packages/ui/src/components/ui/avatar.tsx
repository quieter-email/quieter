"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const avatarRootVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-foreground",
  {
    variants: {
      size: {
        sm: "size-8 text-xs",
        default: "size-10 text-sm",
        lg: "size-12 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export const Avatar = ({
  className,
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> &
  VariantProps<typeof avatarRootVariants>) => (
  <AvatarPrimitive.Root className={cn(avatarRootVariants({ size }), className)} {...props} />
);

export const AvatarImage = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>) => (
  <AvatarPrimitive.Image className={cn("size-full object-cover", className)} {...props} />
);

export const AvatarFallback = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>) => (
  <AvatarPrimitive.Fallback
    className={cn("flex size-full items-center justify-center bg-muted text-foreground", className)}
    {...props}
  />
);
