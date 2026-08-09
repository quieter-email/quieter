"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Collapsible = CollapsiblePrimitive.Root;

export const CollapsibleTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>) => (
  <CollapsiblePrimitive.Trigger
    className={cn(
      "squircle",
      className,
      "transition-transform duration-100 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
    )}
    {...props}
  />
);

export const CollapsiblePanel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Panel>) => (
  <CollapsiblePrimitive.Panel
    className={cn(
      "grid overflow-hidden transition-[grid-template-rows,opacity,filter] duration-150 ease-out motion-reduce:transition-none",
      "data-closed:grid-rows-[0fr] data-closed:opacity-0 data-closed:blur-[2px]",
      "data-open:grid-rows-[1fr] data-open:opacity-100 data-open:blur-none",
      className
    )}
    keepMounted
    {...props}
  />
);
