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
      "grid overflow-hidden transition-[grid-template-rows,opacity] duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out) motion-reduce:transition-none",
      "data-closed:grid-rows-[0fr] data-closed:opacity-0",
      "data-open:grid-rows-[1fr] data-open:opacity-100",
      className
    )}
    keepMounted
    {...props}
  />
);
