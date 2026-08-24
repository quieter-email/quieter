"use client";

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { MinusIcon, PlusIcon } from "./icons";

export const NumberField = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Root>) => (
  <NumberFieldPrimitive.Root
    className={cn("grid w-full gap-1.5", className)}
    {...props}
  />
);

export const NumberFieldGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Group>) => (
  <NumberFieldPrimitive.Group
    className={cn(
      "flex items-center rounded-md border border-border bg-input shadow-sm",
      className
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
      "h-9 w-full border-0 bg-transparent px-3 text-center text-body text-fg shadow-none transition-colors duration-150 ease-out placeholder:text-muted-fg read-only:bg-transparent focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/45",
      className
    )}
    {...props}
  />
);

const numberFieldButtonVariants = cva(
  "flex size-10 shrink-0 items-center justify-center bg-bg-raised text-muted-fg transition-transform duration-100 ease-out hover:bg-muted hover:text-fg focus-visible:bg-muted focus-visible:text-fg focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      side: {
        decrement: "rounded-l-md border-r",
        increment: "rounded-r-md border-l",
      },
    },
  }
);

export const NumberFieldIncrement = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof NumberFieldPrimitive.Increment>) => (
  <NumberFieldPrimitive.Increment
    className={cn(numberFieldButtonVariants({ side: "increment" }), className)}
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
    className={cn(numberFieldButtonVariants({ side: "decrement" }), className)}
    {...props}
  >
    {children ?? <MinusIcon className="size-4" />}
  </NumberFieldPrimitive.Decrement>
);
