"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { domMax, LayoutGroup, LazyMotion } from "motion/react";
import { createContext, use, useId } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { SelectionIndicator } from "./selection-indicator";

export const Tabs = TabsPrimitive.Root;

const TabsListVariantContext = createContext<"default" | "plain">("default");

export const TabsList = ({
  className,
  variant = "default",
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  variant?: "default" | "plain";
}) => {
  const id = useId();
  return (
    <TabsListVariantContext value={variant}>
      <LazyMotion features={domMax}>
        <LayoutGroup id={id}>
          <TabsPrimitive.List
            className={cn(
              "inline-flex items-center gap-1 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
              {
                "min-h-9 rounded-lg border border-border bg-bg p-1 shadow-sm squircle":
                  variant === "default",
              },
              className
            )}
            {...props}
          />
        </LayoutGroup>
      </LazyMotion>
    </TabsListVariantContext>
  );
};

export const TabsTab = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>) => {
  const variant = use(TabsListVariantContext);
  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative isolate inline-flex min-w-0 items-center justify-center rounded-md text-body-sm text-muted-fg squircle focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden data-active:text-fg data-disabled:pointer-events-none data-disabled:opacity-50 data-[orientation=vertical]:justify-start",
        {
          "min-h-7 px-2.5 font-medium": variant === "default",
          "min-h-8 gap-2 px-3 font-normal data-active:font-medium":
            variant === "plain",
        },
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
};

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
