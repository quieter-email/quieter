"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "../../lib/cn";
import { overlayBackdropClassName, floatingPanelClassName } from "./shared";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverPortal = PopoverPrimitive.Portal;

export const PopoverContent = ({
  align = "center",
  children,
  className,
  side = "bottom",
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Positioner>,
    "align" | "side" | "sideOffset"
  >) => (
  <PopoverPortal>
    <PopoverPrimitive.Positioner align={align} side={side} sideOffset={sideOffset}>
      <PopoverPrimitive.Popup
        className={cn(floatingPanelClassName, "max-w-sm p-4", className)}
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
    className={cn("text-sm font-semibold text-foreground", className)}
    {...props}
  />
);

export const PopoverDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Description>) => (
  <PopoverPrimitive.Description
    className={cn("mt-1 text-sm text-muted-foreground", className)}
    {...props}
  />
);

export const PopoverArrow = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Arrow>) => (
  <PopoverPrimitive.Arrow
    className={cn("size-3 rotate-45 rounded-[2px] border border-border bg-popover", className)}
    {...props}
  />
);

export const PopoverBackdrop = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Backdrop>) => (
  <PopoverPrimitive.Backdrop className={cn(overlayBackdropClassName, className)} {...props} />
);

export const PopoverClose = PopoverPrimitive.Close;
