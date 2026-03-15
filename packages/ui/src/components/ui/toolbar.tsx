"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";
import { inputVariants } from "./input-styles";

export const Toolbar = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Root>) => (
  <ToolbarPrimitive.Root
    className={cn(
      "inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-background-light p-1 shadow-sm",
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
    className={cn(buttonVariants({ size: "sm", variant: "ghost" }), className)}
    {...props}
  />
);

export const ToolbarLink = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Link>) => (
  <ToolbarPrimitive.Link
    className={cn(buttonVariants({ size: "sm", variant: "ghost" }), className)}
    {...props}
  />
);

export const ToolbarInput = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Input>) => (
  <ToolbarPrimitive.Input
    className={cn(inputVariants({ chrome: "default", size: "sm" }), "min-w-32", className)}
    {...props}
  />
);

export const ToolbarSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Separator>) => (
  <ToolbarPrimitive.Separator className={cn("mx-1 h-6 w-px bg-border", className)} {...props} />
);
