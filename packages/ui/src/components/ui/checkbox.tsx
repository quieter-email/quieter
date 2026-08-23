"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckboxGroup as CheckboxGroupPrimitive } from "@base-ui/react/checkbox-group";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { CheckIcon, MinusIcon } from "./icons";

export const CheckboxGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxGroupPrimitive>) => (
  <CheckboxGroupPrimitive
    className={cn("grid gap-2.5", className)}
    {...props}
  />
);

export const Checkbox = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-primary-fg shadow-xs transition-colors duration-150 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 [&[data-checked]:not([data-indeterminate])]:border-primary [&[data-checked]:not([data-indeterminate])]:bg-primary",
      className
    )}
    {...props}
  />
);

export const CheckboxIndicator = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Indicator>) => (
  <CheckboxPrimitive.Indicator
    className={cn(
      "group flex items-center justify-center text-primary-fg data-indeterminate:text-fg",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <CheckIcon className="size-3.5 group-data-indeterminate:hidden" />
        <MinusIcon className="hidden size-3.5 group-data-indeterminate:block" />
      </>
    )}
  </CheckboxPrimitive.Indicator>
);
