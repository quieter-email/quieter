"use client";

import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "../../lib/cn";
import { ChevronRightIcon } from "./icons";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuSubmenu = MenuPrimitive.SubmenuRoot;
export const DropdownMenuPortal = MenuPrimitive.Portal;

export const DropdownMenuTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Trigger>) => (
  <MenuPrimitive.Trigger
    className={cn(
      "transition-transform duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
      className,
    )}
    {...props}
  />
);

export const DropdownMenuContent = ({
  align = "center",
  alignOffset = 0,
  anchor,
  className,
  side = "bottom",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof MenuPrimitive.Positioner>,
    "align" | "alignOffset" | "anchor" | "side" | "sideOffset"
  >) => (
  <DropdownMenuPortal>
    <MenuPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      anchor={anchor}
      className="z-50"
      side={side}
      sideOffset={sideOffset}
    >
      <MenuPrimitive.Popup
        className={cn(
          "z-50 min-w-52 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[translate,opacity,height,width] outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Positioner>
  </DropdownMenuPortal>
);

export const DropdownMenuSubmenuContent = ({
  align = "start",
  alignOffset = -4,
  className,
  side = "right",
  sideOffset = 4,
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
          "z-50 min-w-52 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
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
      "squircle relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-sm text-foreground transition-transform duration-100 ease-out outline-none select-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted/60 motion-reduce:transition-none motion-reduce:active:scale-100",
      className,
    )}
    closeOnClick={closeOnSelect}
    onClick={(event: MouseEvent<HTMLElement>) => onSelect?.(event)}
    {...props}
  />
);

export const DropdownMenuSubmenuTrigger = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.SubmenuTrigger>) => (
  <MenuPrimitive.SubmenuTrigger
    className={cn(
      "squircle relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-sm text-foreground transition-transform duration-100 ease-out outline-none select-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted/60 motion-reduce:transition-none motion-reduce:active:scale-100",
      className,
    )}
    {...props}
  >
    <span className="min-w-0 flex-1">{children}</span>
    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
  </MenuPrimitive.SubmenuTrigger>
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
);
