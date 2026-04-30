"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";
import { cn } from "../../lib/cn";

export const Fieldset = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldsetPrimitive.Root>) => (
  <FieldsetPrimitive.Root
    className={cn("grid gap-3 rounded-lg border bg-card/60 p-4", className)}
    {...props}
  />
);

export const FieldsetLegend = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof FieldsetPrimitive.Legend>) => (
  <FieldsetPrimitive.Legend
    className={cn("px-1 text-sm font-semibold text-foreground", className)}
    {...props}
  />
);
