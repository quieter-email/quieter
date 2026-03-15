"use client";

import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cn } from "../../lib/cn";
import { inputVariants } from "./input-styles";

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
  VariantProps<typeof inputVariants>) => (
  <FieldPrimitive.Control className={cn(inputVariants({ chrome, size }), className)} {...props} />
);
