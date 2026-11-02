"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { mergeProps } from "@base-ui/react/merge-props";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";

import { cn } from "../../lib/cn";
import {
  menuItemClassName,
  menuPopupClassName,
  menuSeparatorClassName,
} from "./menu-chrome";
import { menuFocusProps } from "./menu-focus";
import { overlayTriggerClassName } from "./overlay-chrome";

export const ContextMenu = ({
  onItemHighlighted,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Root>) => (
  <ContextMenuPrimitive.Root
    onItemHighlighted={(item, details) => {
      item?.toggleAttribute(
        "data-pointer-highlighted",
        details.reason === "pointer"
      );
      onItemHighlighted?.(item, details);
    }}
    {...props}
  />
);

export const ContextMenuPortal = ContextMenuPrimitive.Portal;

export const ContextMenuTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>) => (
  <ContextMenuPrimitive.Trigger
    className={cn(overlayTriggerClassName, "squircle", className)}
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
        className={cn(menuPopupClassName, className)}
        {...mergeProps<typeof ContextMenuPrimitive.Popup>(
          menuFocusProps,
          props
        )}
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
  tone?: "default" | "destructive";
};

export const ContextMenuItem = ({
  className,
  closeOnSelect = true,
  onSelect,
  tone = "default",
  ...props
}: ContextMenuItemProps) => (
  <ContextMenuPrimitive.Item
    className={cn(
      menuItemClassName,
      { "text-destructive": tone === "destructive" },
      className
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
  <ContextMenuPrimitive.Separator
    className={cn(menuSeparatorClassName, className)}
    {...props}
  />
);
