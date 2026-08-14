"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { GhostFieldShell } from "./input";

const fieldControlVariants = cva(
  "squircle w-full text-fg transition-colors duration-150 ease-out placeholder:text-muted-fg focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/45",
  {
    defaultVariants: {
      chrome: "default",
      size: "default",
    },
    variants: {
      chrome: {
        default:
          "rounded-md border border-border bg-input shadow-sm read-only:cursor-default read-only:bg-input",
        ghost: "border-0 bg-transparent shadow-none read-only:bg-transparent",
      },
      size: {
        default: "h-9 px-3 text-sm",
        lg: "h-10 px-4 text-base",
        sm: "h-8 px-3 text-[13px]",
      },
    },
  }
);

export const Field = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Root>) => (
  <FieldPrimitive.Root
    className={cn("grid w-full gap-1.5", className)}
    {...props}
  />
);

export const FieldLabel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Label>) => (
  <FieldPrimitive.Label
    className={cn("text-sm font-medium text-fg", className)}
    {...props}
  />
);

export const FieldDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Description>) => (
  <FieldPrimitive.Description
    className={cn("text-sm text-muted-fg", className)}
    {...props}
  />
);

export const FieldError = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Error>) => (
  <FieldPrimitive.Error
    className={cn("text-sm text-destructive", className)}
    {...props}
  />
);

export const FieldControl = ({
  chrome,
  className,
  size,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof FieldPrimitive.Control>, "size"> &
  VariantProps<typeof fieldControlVariants>) => {
  const control = (
    <FieldPrimitive.Control
      className={cn(
        fieldControlVariants({ chrome, size }),
        chrome === "ghost" && "min-w-0 flex-1",
        className
      )}
      {...props}
    />
  );

  if (chrome !== "ghost") {
    return control;
  }

  return <GhostFieldShell>{control}</GhostFieldShell>;
};
