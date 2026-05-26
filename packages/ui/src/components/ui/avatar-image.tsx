"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "../../lib/cn";

export const AvatarImage = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>) => (
  <AvatarPrimitive.Image className={cn("size-full object-cover", className)} {...props} />
);
