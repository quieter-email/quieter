"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "../../lib/cn";
import { DotIcon } from "./icons";

export const RadioGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadioGroupPrimitive>) => (
  <RadioGroupPrimitive className={cn("grid gap-2.5", className)} {...props} />
);

export const Radio = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadioPrimitive.Root>) => (
  <RadioPrimitive.Root
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background text-primary shadow-xs transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-background",
      className,
    )}
    {...props}
  />
);

export const RadioIndicator = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadioPrimitive.Indicator>) => (
  <RadioPrimitive.Indicator
    className={cn("flex items-center justify-center", className)}
    {...props}
  >
    {children ?? <DotIcon className="size-3 text-primary" />}
  </RadioPrimitive.Indicator>
);
