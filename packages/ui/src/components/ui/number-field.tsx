"use client";

import type { ComponentPropsWithoutRef } from "react";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { cn } from "../../lib/cn";
import { MinusIcon, PlusIcon } from "./icons";

export const NumberField = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Root>) => (
  <NumberFieldPrimitive.Root className={cn("grid w-full gap-1.5", className)} {...props} />
);

export const NumberFieldGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Group>) => (
  <NumberFieldPrimitive.Group
    className={cn(
      "keyboard-focus-within flex items-center overflow-hidden rounded-md border border-input bg-background-light shadow-sm",
      className,
    )}
    {...props}
  />
);

export const NumberFieldInput = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Input>) => (
  <NumberFieldPrimitive.Input
    className={cn(
      "h-9 w-full border-0 bg-transparent px-3 text-center text-sm text-foreground shadow-none transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground read-only:bg-transparent disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
      className,
    )}
    {...props}
  />
);

const numberFieldButtonClassName =
  "flex size-10 shrink-0 items-center justify-center bg-background text-muted-foreground transition-transform duration-100 ease-out outline-none active:scale-[0.97] hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:bg-muted/60 focus-visible:text-foreground motion-reduce:transition-none motion-reduce:active:scale-100";

export const NumberFieldIncrement = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Increment>) => (
  <NumberFieldPrimitive.Increment
    className={cn(numberFieldButtonClassName, "border-l", className)}
    {...props}
  >
    {children ?? <PlusIcon className="size-4" />}
  </NumberFieldPrimitive.Increment>
);

export const NumberFieldDecrement = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Decrement>) => (
  <NumberFieldPrimitive.Decrement
    className={cn(numberFieldButtonClassName, "border-r", className)}
    {...props}
  >
    {children ?? <MinusIcon className="size-4" />}
  </NumberFieldPrimitive.Decrement>
);
