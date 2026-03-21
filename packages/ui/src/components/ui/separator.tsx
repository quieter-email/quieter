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
      { "h-px w-full": orientation === "horizontal", "h-full w-px": orientation !== "horizontal" },
      "shrink-0 bg-border",
      className,
    )}
    orientation={orientation}
    {...props}
  />
);
