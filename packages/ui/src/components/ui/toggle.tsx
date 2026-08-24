"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const ToggleGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToggleGroupPrimitive>) => (
  <ToggleGroupPrimitive
    className={cn(
      "squircle inline-flex items-center gap-1 rounded-lg border border-border bg-bg p-1 shadow-sm",
      className
    )}
    {...props}
  />
);

export const Toggle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TogglePrimitive>) => (
  <TogglePrimitive
    className={cn(
      "squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-body-sm font-medium whitespace-nowrap text-muted-fg transition-transform duration-100 ease-out select-none hover:bg-muted hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] active:bg-muted/80 active:text-fg disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
      "data-pressed:bg-bg-surface data-pressed:text-fg data-pressed:shadow-sm",
      className
    )}
    {...props}
  />
);
