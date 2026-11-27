"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { menuSurfaceClassName } from "./menu-chrome";
import {
  anchoredPopupMotionClassName,
  anchoredTriggerClassName,
  overlayBackdropClassName,
} from "./overlay-chrome";
import { popupSideOffset } from "./popup-surface";

export const Popover = PopoverPrimitive.Root;
export const PopoverPortal = PopoverPrimitive.Portal;

export const PopoverTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>) => (
  <PopoverPrimitive.Trigger
    className={cn(className, anchoredTriggerClassName)}
    {...props}
  />
);

export const PopoverContent = ({
  align = "center",
  alignOffset = 0,
  anchor,
  children,
  chrome = "default",
  className,
  collisionPadding,
  side = "bottom",
  sideOffset = popupSideOffset,
  size = "default",
  scrollable = false,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Positioner>,
    | "align"
    | "alignOffset"
    | "anchor"
    | "collisionPadding"
    | "side"
    | "sideOffset"
  > & {
    /** `bare` holds a child that owns its popup surface, such as CommandMenu. */
    chrome?: "bare" | "default";
    /** `compact` is a one-row action strip, e.g. Snooze beside Done. */
    size?: "compact" | "default" | "sm";
    scrollable?: boolean;
  }) => (
  <PopoverPortal>
    <PopoverPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      anchor={anchor}
      className="isolate z-50"
      collisionPadding={collisionPadding}
      side={side}
      sideOffset={sideOffset}
    >
      <PopoverPrimitive.Popup
        className={cn(
          anchoredPopupMotionClassName,
          "z-50",
          {
            "flex items-center gap-2 p-1.5": size === "compact",
            "flex max-h-(--available-height) flex-col outline-none":
              chrome === "bare",
            "max-h-(--available-height) overflow-y-auto": scrollable,
            "max-w-sm min-w-52 p-4": chrome === "default" && size !== "compact",
            [menuSurfaceClassName]: chrome === "default",
            "w-80 max-w-(--available-width)": size === "sm",
          },
          className
        )}
        data-popover-popup=""
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
    className={cn("text-body font-medium text-fg", className)}
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
      "pointer-events-none absolute size-2.5 rotate-45 rounded-sm border-fg/10 bg-popover data-[side=bottom]:-top-1.25 data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=left]:-right-1.25 data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:-left-1.25 data-[side=right]:border-b data-[side=right]:border-l data-[side=top]:-bottom-1.25 data-[side=top]:border-r data-[side=top]:border-b",
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
