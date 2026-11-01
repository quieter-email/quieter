"use client";

import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const InputGroup = ({
  chrome = "default",
  className,
  surface = "input",
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  chrome?: "default" | "toolbar";
  surface?: "input" | "page";
}) => (
  <div
    className={cn(
      "flex h-8 min-w-0 items-center rounded-md border border-transparent bg-input shadow-none transition-colors squircle has-aria-invalid:border-destructive has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring has-[:focus-visible]:outline-hidden has-aria-invalid:has-[:focus-visible]:ring-destructive",
      { "bg-bg": surface === "page", "rounded-xl": chrome === "toolbar" },
      className
    )}
    {...props}
  />
);

export const InputAddon = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) => (
  <span
    className={cn("text-body text-muted-fg select-none", className)}
    {...props}
  />
);
