"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";
import { Icon } from "./icon";
import { overlayTriggerClassName } from "./overlay-chrome";

export const Collapsible = CollapsiblePrimitive.Root;

export const CollapsibleTrigger = ({
  children,
  className,
  variant = "default",
  ...props
}: ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger> & {
  variant?: "default" | "text";
}) => (
  <CollapsiblePrimitive.Trigger
    className={cn(
      variant === "text"
        ? [
            buttonVariants({ size: "text", variant: "link" }),
            "group/text-disclosure justify-start text-muted-fg no-underline hover:text-fg data-panel-open:text-fg",
          ]
        : ["squircle", overlayTriggerClassName],
      className
    )}
    {...props}
  >
    {variant === "text" ? (
      <>
        {children}
        <Icon
          className="group-data-panel-open/text-disclosure:rotate-180"
          icon={ArrowDown01Icon}
          size={12}
        />
      </>
    ) : (
      children
    )}
  </CollapsiblePrimitive.Trigger>
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
