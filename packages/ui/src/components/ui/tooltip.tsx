"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "../../lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
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
          "z-50 max-w-xs origin-(--transform-origin) rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
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
    className={cn(
      "pointer-events-none absolute size-2.5 rotate-45 rounded-[2px] border-border bg-popover data-[side=bottom]:top-[-5px] data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=left]:right-[-5px] data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:left-[-5px] data-[side=right]:border-b data-[side=right]:border-l data-[side=top]:bottom-[-5px] data-[side=top]:border-r data-[side=top]:border-b",
      className,
    )}
    {...props}
  />
);
