"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "../../lib/cn";

export const AvatarFallback = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>) => (
  <AvatarPrimitive.Fallback
    className={cn("flex size-full items-center justify-center bg-muted text-foreground", className)}
    {...props}
  />
);
