"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "squircle inline-flex h-10 items-center gap-1 rounded-lg border border-border bg-bg-elevated p-1 shadow-sm",
      className
    )}
    {...props}
  />
);

export const TabsTab = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>) => (
  <TabsPrimitive.Tab
    className={cn(
      "squircle inline-flex min-h-8 min-w-0 items-center justify-center rounded-md px-3 text-body font-medium text-muted-fg transition-transform duration-100 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] data-active:bg-bg-surface data-active:text-fg data-active:shadow-sm data-disabled:pointer-events-none data-disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100",
      className
    )}
    {...props}
  />
);

export const TabsPanel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Panel>) => (
  <TabsPrimitive.Panel className={cn("mt-4", className)} {...props} />
);

export const TabsIndicator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Indicator>) => (
  <TabsPrimitive.Indicator className={cn("hidden", className)} {...props} />
);
