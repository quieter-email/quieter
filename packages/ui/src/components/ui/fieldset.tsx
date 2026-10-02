"use client";

import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Fieldset = ({
  bare = false,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldsetPrimitive.Root> & {
  bare?: boolean;
}) => (
  <FieldsetPrimitive.Root
    className={cn(
      "grid gap-3 rounded-lg border bg-card/60 p-4",
      { "gap-0 rounded-none border-0 bg-transparent p-0": bare },
      className
    )}
    {...props}
  />
);

export const FieldsetLegend = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldsetPrimitive.Legend>) => (
  <FieldsetPrimitive.Legend
    className={cn("px-1 text-body font-semibold text-fg", className)}
    {...props}
  />
);
