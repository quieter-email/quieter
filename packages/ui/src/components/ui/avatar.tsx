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
      "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-foreground",
      size === "sm" && "size-8 text-xs",
      size === "default" && "size-10 text-sm",
      size === "lg" && "size-12 text-base",
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
