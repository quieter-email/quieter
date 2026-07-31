"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { cn } from "../../lib/cn";

export const Toolbar = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Root>) => (
  <ToolbarPrimitive.Root
    className={cn(
      "squircle inline-flex min-h-10 items-center gap-1 rounded-lg border bg-bg-surface p-1 shadow-sm",
      className,
    )}
    {...props}
  />
);

export const ToolbarGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Group>) => (
  <ToolbarPrimitive.Group className={cn("inline-flex items-center gap-1", className)} {...props} />
);

export const ToolbarButton = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Button>) => (
  <ToolbarPrimitive.Button
    className={cn(
      "squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-[13px] font-medium whitespace-nowrap text-muted-fg transition-transform duration-100 ease-out select-none hover:bg-muted hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] active:bg-muted/80 active:text-fg disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
);

export const ToolbarLink = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Link>) => (
  <ToolbarPrimitive.Link
    className={cn(
      "squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-[13px] font-medium whitespace-nowrap text-muted-fg transition-transform duration-100 ease-out select-none hover:bg-muted hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] active:bg-muted/80 active:text-fg disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
);

export const ToolbarInput = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Input>) => (
  <ToolbarPrimitive.Input
    className={cn(
      "squircle h-8 w-full min-w-32 rounded-md border border-border bg-bg-elevated/60 px-3 text-[13px] text-fg shadow-sm transition-colors duration-150 ease-out placeholder:text-muted-fg read-only:cursor-default read-only:bg-muted/30 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/45",
      className,
    )}
    {...props}
  />
);

export const ToolbarSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Separator>) => (
  <ToolbarPrimitive.Separator className={cn("mx-1 h-6 w-px bg-border", className)} {...props} />
);
