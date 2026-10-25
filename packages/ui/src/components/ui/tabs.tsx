"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { domMax, LayoutGroup, LazyMotion } from "motion/react";
import { useId } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { SelectionIndicator } from "./selection-indicator";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => {
  const id = useId();
  return (
    <LazyMotion features={domMax}>
      <LayoutGroup id={id}>
        <TabsPrimitive.List
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-bg p-1 shadow-sm squircle",
            className
          )}
          {...props}
        />
      </LayoutGroup>
    </LazyMotion>
  );
};

export const TabsTab = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>) => (
  <TabsPrimitive.Tab
    className={cn(
      "relative isolate inline-flex min-h-7 min-w-0 items-center justify-center rounded-md px-2.5 text-body-sm font-medium text-muted-fg squircle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none data-active:text-fg data-disabled:pointer-events-none data-disabled:opacity-50",
      className
    )}
    {...props}
    render={(tabProps, state) => (
      <button {...tabProps} type="button">
        {state.active && <SelectionIndicator />}
        {tabProps.children}
      </button>
    )}
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
