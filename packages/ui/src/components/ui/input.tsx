"use client";

import type { VariantProps } from "class-variance-authority";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";
import { inputVariants } from "./input-styles";

export const Input = forwardRef<
  HTMLElement,
  Omit<ComponentPropsWithoutRef<typeof InputPrimitive>, "size"> & VariantProps<typeof inputVariants>
>(({ chrome, className, size, ...props }, ref) => (
  <InputPrimitive ref={ref} className={cn(inputVariants({ chrome, size }), className)} {...props} />
));

Input.displayName = "Input";
