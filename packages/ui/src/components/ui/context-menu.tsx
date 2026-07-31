"use client";

import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "../../lib/cn";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;

export const ContextMenuTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>) => (
  <ContextMenuPrimitive.Trigger
    className={cn(
      "squircle transition-transform duration-100 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
      className,
    )}
    {...props}
  />
);

export const ContextMenuContent = ({
  align = "center",
  alignOffset = 0,
  className,
  side = "bottom",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) => (
  <ContextMenuPortal>
    <ContextMenuPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      className="z-50"
      side={side}
      sideOffset={sideOffset}
    >
      <ContextMenuPrimitive.Popup
        className={cn(
          "z-50 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] min-w-52 origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-sm text-popover-fg shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Positioner>
  </ContextMenuPortal>
);

type ContextMenuItemProps = Omit<
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>,
  "closeOnClick" | "onClick"
> & {
  closeOnSelect?: boolean;
  onSelect?: (event: MouseEvent<HTMLElement>) => void;
};

export const ContextMenuItem = ({
  className,
  closeOnSelect = true,
  onSelect,
  ...props
}: ContextMenuItemProps) => (
  <ContextMenuPrimitive.Item
    className={cn(
      "squircle relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-sm text-fg transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
      className,
    )}
    closeOnClick={closeOnSelect}
    onClick={(event: MouseEvent<HTMLElement>) => onSelect?.(event)}
    {...props}
  />
);

export const ContextMenuSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) => (
  <ContextMenuPrimitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
);
