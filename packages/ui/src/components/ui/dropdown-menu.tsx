"use client";

import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "../../lib/cn";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuPortal = MenuPrimitive.Portal;

export const DropdownMenuContent = ({
  align = "center",
  alignOffset = 0,
  className,
  side = "bottom",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof MenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) => (
  <DropdownMenuPortal>
    <MenuPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      className="z-50"
      side={side}
      sideOffset={sideOffset}
    >
      <MenuPrimitive.Popup
        className={cn(
          "z-50 min-w-52 origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[instant]:transition-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Positioner>
  </DropdownMenuPortal>
);

type DropdownMenuItemProps = Omit<
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item>,
  "closeOnClick" | "onClick"
> & {
  closeOnSelect?: boolean;
  onSelect?: (event: MouseEvent<HTMLElement>) => void;
};

export const DropdownMenuItem = ({
  className,
  closeOnSelect = true,
  onSelect,
  ...props
}: DropdownMenuItemProps) => (
  <MenuPrimitive.Item
    className={cn(
      "relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-sm text-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted/60",
      className,
    )}
    closeOnClick={closeOnSelect}
    onClick={(event: MouseEvent<HTMLElement>) => onSelect?.(event)}
    {...props}
  />
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
);
