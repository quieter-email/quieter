"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";

export const ToggleGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToggleGroupPrimitive>) => (
  <ToggleGroupPrimitive
    className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
    {...props}
  />
);

export const Toggle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TogglePrimitive>) => (
  <TogglePrimitive
    className={cn(
      buttonVariants({ size: "sm", variant: "ghost" }),
      "data-[pressed]:bg-background data-[pressed]:text-foreground data-[pressed]:shadow-sm",
      className,
    )}
    {...props}
  />
);
