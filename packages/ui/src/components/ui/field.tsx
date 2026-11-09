"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import {
  ghostInputClassName,
  inputControlClassName,
  inputControlSizeVariants,
} from "./input-chrome";
import { entranceMotionVariants } from "./motion";

const fieldControlVariants = cva(`squircle ${inputControlClassName}`, {
  compoundVariants: [
    { chrome: "ghost", className: "px-2.5" },
    { chrome: "composer", className: "h-10 px-3 text-body-sm" },
  ],
  defaultVariants: {
    chrome: "default",
    size: "default",
  },
  variants: {
    chrome: {
      composer:
        "min-w-0 flex-1 rounded-xl border border-transparent bg-detail shadow-none read-only:bg-detail focus-visible:bg-control-hover focus-visible:ring-0 focus-visible:outline-none",
      default:
        "rounded-md border border-border bg-input shadow-sm read-only:cursor-default read-only:bg-input dark:border-transparent",
      ghost: ghostInputClassName,
    },
    size: inputControlSizeVariants,
  },
});

export const Field = ({
  className,
  reveal = false,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Root> & {
  reveal?: boolean;
}) => (
  <FieldPrimitive.Root
    className={cn(
      "grid w-full gap-1.5",
      { [entranceMotionVariants()]: reveal },
      className
    )}
    {...props}
  />
);

export const FieldLabel = ({
  className,
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Label> & {
  size?: "default" | "caption";
}) => (
  <FieldPrimitive.Label
    className={cn(
      {
        "text-body font-medium text-fg": size === "default",
        "text-caption font-normal text-muted-fg": size === "caption",
      },
      className
    )}
    {...props}
  />
);

export const FieldDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Description>) => (
  <FieldPrimitive.Description
    className={cn("text-body text-muted-fg", className)}
    {...props}
  />
);

export const FieldError = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Error>) => (
  <FieldPrimitive.Error
    className={cn("text-body text-destructive", className)}
    {...props}
  />
);

export const FieldControl = ({
  chrome,
  className,
  size,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof FieldPrimitive.Control>, "size"> &
  VariantProps<typeof fieldControlVariants>) => (
  <FieldPrimitive.Control
    className={cn(fieldControlVariants({ chrome, size }), className)}
    {...props}
  />
);
