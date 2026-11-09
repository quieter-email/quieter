"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { overlayTriggerClassName } from "./overlay-chrome";

export const Collapsible = CollapsiblePrimitive.Root;

export const CollapsibleTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>) => (
  <CollapsiblePrimitive.Trigger
    className={cn("squircle", className, overlayTriggerClassName)}
    {...props}
  />
);

export const CollapsiblePanel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Panel>) => (
  <CollapsiblePrimitive.Panel
    className={cn(
      "h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-(--app-motion-duration-layout) ease-(--app-motion-ease-out) motion-reduce:transition-none",
      "data-starting-style:h-0 data-starting-style:opacity-0",
      "data-ending-style:h-0 data-ending-style:opacity-0",
      className
    )}
    keepMounted
    {...props}
  />
);
