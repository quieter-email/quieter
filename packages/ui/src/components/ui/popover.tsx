"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "../../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverPortal = PopoverPrimitive.Portal;

export const PopoverContent = ({
  align = "center",
  alignOffset = 0,
  children,
  className,
  side = "bottom",
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) => (
  <PopoverPortal>
    <PopoverPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      className="isolate z-50"
      side={side}
      sideOffset={sideOffset}
    >
      <PopoverPrimitive.Popup
        className={cn(
          "z-50 max-w-sm min-w-52 origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[instant]:transition-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          className,
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
    className={cn(
      "pointer-events-none absolute size-2.5 rotate-45 rounded-[2px] border-border bg-popover data-[side=bottom]:top-[-5px] data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=left]:right-[-5px] data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:left-[-5px] data-[side=right]:border-b data-[side=right]:border-l data-[side=top]:bottom-[-5px] data-[side=top]:border-r data-[side=top]:border-b",
      className,
    )}
    {...props}
  />
);

export const PopoverBackdrop = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Backdrop>) => (
  <PopoverPrimitive.Backdrop
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
      className,
    )}
    {...props}
  />
);

export const PopoverClose = PopoverPrimitive.Close;
