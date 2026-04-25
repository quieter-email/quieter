"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
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
      "transition-transform duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
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
      "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out data-closed:grid-rows-[0fr] data-closed:opacity-0 data-open:grid-rows-[1fr] data-open:opacity-100",
      className,
    )}
    keepMounted
    {...props}
  />
);
