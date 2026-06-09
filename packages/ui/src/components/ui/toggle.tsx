"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "../../lib/cn";

export const ToggleGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToggleGroupPrimitive>) => (
  <ToggleGroupPrimitive
    className={cn("squircle inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
    {...props}
  />
);

export const Toggle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TogglePrimitive>) => (
  <TogglePrimitive
    className={cn(
      "squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-transform duration-100 ease-out outline-none select-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] active:bg-muted/80 active:text-foreground disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
      "data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm",
      className,
    )}
    {...props}
  />
);
