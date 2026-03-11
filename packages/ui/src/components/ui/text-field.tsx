"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const textFieldInputVariants = cva(
  "w-full rounded-md border shadow-sm border-input bg-background text-foreground outline-none transition-colors duration-150 ease-out placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 read-only:cursor-default read-only:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/20",
  {
    variants: {
      size: {
        sm: "h-8 px-3 text-[13px]",
        default: "h-10 px-3.5 text-sm",
        lg: "h-11 px-4 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export const TextField = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldPrimitive.Root>) => (
  <FieldPrimitive.Root className={cn("grid w-full gap-1.5", className)} {...props} />
);

export const TextFieldInput = ({
  className,
  size,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof InputPrimitive>, "size"> &
  VariantProps<typeof textFieldInputVariants>) => (
  <InputPrimitive className={cn(textFieldInputVariants({ size }), className)} {...props} />
);
