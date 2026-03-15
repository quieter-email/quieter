"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "../../lib/cn";

export const Separator = ({
  className,
  orientation = "horizontal",
  ...props
}: ComponentPropsWithoutRef<typeof SeparatorPrimitive>) => (
  <SeparatorPrimitive
    className={cn(
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      "shrink-0 bg-border",
      className,
    )}
    orientation={orientation}
    {...props}
  />
);
