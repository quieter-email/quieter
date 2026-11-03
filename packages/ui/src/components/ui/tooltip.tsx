"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { anchoredPopupMotionClassName } from "./overlay-chrome";
import { popupSurfaceClassName } from "./popup-surface";

export const TooltipGroup = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

export const TooltipContent = ({
  align = "center",
  alignOffset = 0,
  children,
  className,
  side = "top",
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) => (
  <TooltipPortal>
    <TooltipPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      className="isolate z-50"
      side={side}
      sideOffset={sideOffset}
    >
      <TooltipPrimitive.Popup
        className={cn(
          anchoredPopupMotionClassName,
          popupSurfaceClassName,
          "z-50 max-w-xs rounded-md px-3 py-1.5 text-caption",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Popup>
    </TooltipPrimitive.Positioner>
  </TooltipPortal>
);
