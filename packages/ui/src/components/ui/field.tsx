"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const fieldControlVariants = cva(
  "squircle w-full text-foreground transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
  {
    variants: {
      chrome: {
        default:
          "keyboard-focus-ring rounded-md border border-input bg-background-light shadow-sm read-only:cursor-default read-only:bg-muted/30",
        ghost:
          "border-0 bg-transparent shadow-none read-only:bg-transparent focus-visible:border-transparent focus-visible:ring-0",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        default: "h-9 px-3 text-sm",
        lg: "h-10 px-4 text-base",
      },
    },
    defaultVariants: {
      chrome: "default",
      size: "default",
    },
  },
);

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
}: Omit<ComponentPropsWithoutRef<typeof FieldPrimitive.Control>, "size"> &
  VariantProps<typeof fieldControlVariants>) => (
  <FieldPrimitive.Control
    className={cn(fieldControlVariants({ chrome, size }), className)}
    {...props}
  />
);
