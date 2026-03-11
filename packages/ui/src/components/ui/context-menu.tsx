"use client";

import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "../../lib/cn";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;

export const ContextMenuContent = ({
  align = "center",
  className,
  side = "bottom",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Positioner>,
    "align" | "side" | "sideOffset"
  >) => (
  <ContextMenuPortal>
    <ContextMenuPrimitive.Positioner align={align} side={side} sideOffset={sideOffset}>
      <ContextMenuPrimitive.Popup
        className={cn(
          "z-50 min-w-52 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md",
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
      "relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-sm text-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted/60",
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
