"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "../../lib/cn";

type AvatarSize = "sm" | "default" | "lg";

export const Avatar = ({
  className,
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
  size?: AvatarSize;
}) => (
  <AvatarPrimitive.Root
    className={cn(
      "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-foreground",
      {
        "size-8 text-xs": size === "sm",
        "size-10 text-sm": size === "default",
        "size-12 text-base": size === "lg",
      },
      className,
    )}
    {...props}
  />
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
