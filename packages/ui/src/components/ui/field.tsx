"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import type { InputChrome, InputSize } from "./input";
import { cn } from "../../lib/cn";

export const Field = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Root>) => (
  <FieldPrimitive.Root className={cn("grid w-full gap-1.5", className)} {...props} />
);

export const FieldLabel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Label>) => (
  <FieldPrimitive.Label
    className={cn("text-sm font-medium text-foreground", className)}
    {...props}
  />
);

export const FieldDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Description>) => (
  <FieldPrimitive.Description
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
);

export const FieldError = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Error>) => (
  <FieldPrimitive.Error className={cn("text-sm text-destructive", className)} {...props} />
);

export const FieldControl = ({
  chrome,
  className,
  size,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof FieldPrimitive.Control>, "size"> & {
  chrome?: InputChrome;
  size?: InputSize;
}) => (
  <FieldPrimitive.Control
    className={cn(
      "w-full text-foreground transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/20",
      chrome !== "ghost" &&
        "rounded-md border border-input bg-background shadow-sm read-only:cursor-default read-only:bg-muted/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
      chrome === "ghost" &&
        "border-0 bg-transparent shadow-none read-only:bg-transparent focus-visible:border-transparent focus-visible:ring-0",
      size === "sm" && "h-8 px-3 text-[13px]",
      (size === undefined || size === "default") && "h-9 px-3 text-sm",
      size === "lg" && "h-10 px-4 text-base",
      className,
    )}
    {...props}
  />
);
