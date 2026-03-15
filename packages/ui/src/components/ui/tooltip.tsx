"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "../../lib/cn";
import { floatingPanelClassName } from "./shared";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

export const TooltipContent = ({
  align = "center",
  children,
  className,
  side = "top",
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>,
    "align" | "side" | "sideOffset"
  >) => (
  <TooltipPortal>
    <TooltipPrimitive.Positioner align={align} side={side} sideOffset={sideOffset}>
      <TooltipPrimitive.Popup
        className={cn(floatingPanelClassName, "px-2.5 py-1.5 text-xs", className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Popup>
    </TooltipPrimitive.Positioner>
  </TooltipPortal>
);

export const TooltipArrow = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Arrow>) => (
  <TooltipPrimitive.Arrow
    className={cn("size-2.5 rotate-45 rounded-[2px] border border-border bg-popover", className)}
    {...props}
  />
);
