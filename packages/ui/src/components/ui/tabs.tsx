"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "../../lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn("inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1", className)}
    {...props}
  />
);

export const TabsTab = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>) => (
  <TabsPrimitive.Tab
    className={cn(
      "inline-flex min-h-8 min-w-0 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:pointer-events-none data-disabled:opacity-50 data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm",
      className,
    )}
    {...props}
  />
);

export const TabsPanel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Panel>) => (
  <TabsPrimitive.Panel className={cn("mt-4 outline-none", className)} {...props} />
);

export const TabsIndicator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Indicator>) => (
  <TabsPrimitive.Indicator className={cn("hidden", className)} {...props} />
);
