"use client";

import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const InputGroup = ({
  className,
  surface = "input",
  ...props
}: ComponentPropsWithoutRef<"div"> & { surface?: "input" | "page" }) => (
  <div
    className={cn(
      "flex h-8 min-w-0 items-center rounded-md border border-border bg-input shadow-none transition-colors squircle focus-within:border-ring focus-within:ring-2 focus-within:ring-ring focus-within:outline-hidden has-aria-invalid:border-destructive has-aria-invalid:focus-within:border-destructive has-aria-invalid:focus-within:ring-destructive",
      { "bg-bg": surface === "page" },
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
