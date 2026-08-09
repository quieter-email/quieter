"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Separator = ({
  className,
  orientation = "horizontal",
  ...props
}: ComponentPropsWithoutRef<typeof SeparatorPrimitive>) => (
  <SeparatorPrimitive
    className={cn(
      {
        "h-full w-px": orientation !== "horizontal",
        "h-px w-full": orientation === "horizontal",
      },
      "shrink-0 bg-border",
      className
    )}
    orientation={orientation}
    {...props}
  />
);
