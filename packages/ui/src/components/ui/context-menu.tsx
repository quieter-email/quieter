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
      "transition-transform duration-100 ease-out outline-none squircle active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
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
          "z-50 min-w-52 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
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
      "relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-sm text-foreground transition-transform duration-100 ease-out outline-none select-none squircle active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
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
