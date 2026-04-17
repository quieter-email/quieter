"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckboxGroup as CheckboxGroupPrimitive } from "@base-ui/react/checkbox-group";
import { cn } from "../../lib/cn";
import { CheckIcon, MinusIcon } from "./icons";

export const CheckboxGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxGroupPrimitive>) => (
  <CheckboxGroupPrimitive className={cn("grid gap-2.5", className)} {...props} />
);

export const Checkbox = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-background text-primary-foreground shadow-xs transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-50 [&[data-checked]:not([data-indeterminate])]:border-primary [&[data-checked]:not([data-indeterminate])]:bg-primary",
      className,
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
      "group flex items-center justify-center text-primary-foreground data-indeterminate:text-foreground",
      className,
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
