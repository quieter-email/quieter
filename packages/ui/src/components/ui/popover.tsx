"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import {
  overlayBackdropClassName,
  overlayTriggerClassName,
} from "./overlay-chrome";

export const Popover = PopoverPrimitive.Root;
export const PopoverPortal = PopoverPrimitive.Portal;

export const PopoverTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>) => (
  <PopoverPrimitive.Trigger
    className={cn("squircle", className, overlayTriggerClassName)}
    {...props}
  />
);

export const PopoverContent = ({
  align = "center",
  alignOffset = 0,
  children,
  className,
  collisionPadding,
  side = "bottom",
  sideOffset = 8,
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Positioner>,
    "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
  > & {
    size?: "default" | "sm";
  }) => (
  <PopoverPortal>
    <PopoverPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      className="isolate z-50"
      collisionPadding={collisionPadding}
      side={side}
      sideOffset={sideOffset}
    >
      <PopoverPrimitive.Popup
        className={cn(
          "z-50 max-w-sm min-w-52 origin-(--transform-origin) rounded-lg border bg-popover p-4 text-popover-fg shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
          { "w-80 max-w-(--available-width)": size === "sm" },
          className
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Popup>
    </PopoverPrimitive.Positioner>
  </PopoverPortal>
);

export const PopoverTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Title>) => (
  <PopoverPrimitive.Title
    className={cn("text-body font-semibold text-fg", className)}
    {...props}
  />
);

export const PopoverDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Description>) => (
  <PopoverPrimitive.Description
    className={cn("mt-1 text-body text-muted-fg", className)}
    {...props}
  />
);

export const PopoverArrow = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Arrow>) => (
  <PopoverPrimitive.Arrow
    className={cn(
      "pointer-events-none absolute size-2.5 rotate-45 rounded-sm bg-popover data-[side=bottom]:-top-1.25 data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=left]:-right-1.25 data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:-left-1.25 data-[side=right]:border-b data-[side=right]:border-l data-[side=top]:-bottom-1.25 data-[side=top]:border-r data-[side=top]:border-b",
      className
    )}
    {...props}
  />
);

export const PopoverBackdrop = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Backdrop>) => (
  <PopoverPrimitive.Backdrop
    className={cn(overlayBackdropClassName, className)}
    {...props}
  />
);

export const PopoverClose = PopoverPrimitive.Close;
