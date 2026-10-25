"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";

import { cn } from "../../lib/cn";
import { CheckIcon, ChevronRightIcon, MinusIcon } from "./icons";
import {
  menuCompactItemClassName,
  menuCompactPopupClassName,
  menuItemClassName,
  menuPopupClassName,
  menuSeparatorClassName,
} from "./menu-chrome";
import { overlayTriggerClassName } from "./overlay-chrome";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuSubmenu = MenuPrimitive.SubmenuRoot;
export const DropdownMenuPortal = MenuPrimitive.Portal;

type DropdownMenuDensity = "default" | "compact";

const DropdownMenuDensityContext =
  createContext<DropdownMenuDensity>("default");

const dropdownMenuTriggerVariants = cva(overlayTriggerClassName, {
  variants: {
    appearance: {
      // Muted square icon button, e.g. row overflow menus.
      icon: "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-fg transition-colors hover:bg-control-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50",
      // Transparent square icon button that stays invisible while its menu
      // is open, e.g. the sidebar help menu.
      "icon-transparent":
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-fg hover:bg-transparent hover:text-fg focus-visible:bg-transparent focus-visible:text-fg data-popup-open:bg-transparent data-popup-open:text-fg",
      // Caption-muted row, e.g. the chat composer policy picker.
      row: "flex min-w-0 items-center gap-2 rounded-md py-1 text-caption text-muted-fg transition-colors hover:text-fg",
      // Strong row, e.g. the conversation history picker.
      "row-strong":
        "flex min-w-0 items-center gap-2 rounded-md text-left text-body-sm font-medium text-fg",
    },
  },
});

type DropdownMenuTriggerProps = ComponentPropsWithoutRef<
  typeof MenuPrimitive.Trigger
> &
  VariantProps<typeof dropdownMenuTriggerVariants>;

export const DropdownMenuTrigger = ({
  appearance,
  className,
  ...props
}: DropdownMenuTriggerProps) => (
  <MenuPrimitive.Trigger
    className={cn(dropdownMenuTriggerVariants({ appearance }), className)}
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
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof MenuPrimitive.Positioner>,
    "align" | "alignOffset" | "anchor" | "side" | "sideOffset"
  > & { size?: DropdownMenuDensity }) => (
  <DropdownMenuPortal>
    <MenuPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      anchor={anchor}
      className="z-50"
      side={side}
      sideOffset={sideOffset}
    >
      <DropdownMenuDensityContext.Provider value={size}>
        <MenuPrimitive.Popup
          className={cn(
            menuPopupClassName,
            "will-change-[translate,opacity,height,width]",
            { [menuCompactPopupClassName]: size === "compact" },
            className
          )}
          {...props}
        />
      </DropdownMenuDensityContext.Provider>
    </MenuPrimitive.Positioner>
  </DropdownMenuPortal>
);

export const DropdownMenuSubmenuContent = ({
  align = "start",
  alignOffset = -4,
  className,
  side = "right",
  sideOffset = 4,
  size,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof MenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & { size?: DropdownMenuDensity }) => {
  const parentSize = useContext(DropdownMenuDensityContext);
  const resolvedSize = size ?? parentSize;

  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <DropdownMenuDensityContext.Provider value={resolvedSize}>
          <MenuPrimitive.Popup
            className={cn(
              menuPopupClassName,
              "will-change-[opacity,transform]",
              { [menuCompactPopupClassName]: resolvedSize === "compact" },
              className
            )}
            {...props}
          />
        </DropdownMenuDensityContext.Provider>
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  );
};

type DropdownMenuItemProps = Omit<
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item>,
  "closeOnClick" | "onClick"
> & {
  closeOnSelect?: boolean;
  onSelect?: (event: MouseEvent<HTMLElement>) => void;
  tone?: "default" | "destructive";
};

export const DropdownMenuItem = ({
  className,
  closeOnSelect = true,
  onSelect,
  tone = "default",
  ...props
}: DropdownMenuItemProps) => {
  const size = useContext(DropdownMenuDensityContext);

  return (
    <MenuPrimitive.Item
      className={cn(
        menuItemClassName,
        { [menuCompactItemClassName]: size === "compact" },
        { "text-destructive": tone === "destructive" },
        className
      )}
      closeOnClick={closeOnSelect}
      onClick={(event: MouseEvent<HTMLElement>) => onSelect?.(event)}
      {...props}
    />
  );
};

type DropdownMenuCheckboxItemProps = Omit<
  ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>,
  "closeOnClick"
> & {
  closeOnSelect?: boolean;
  indeterminate?: boolean;
};

export const DropdownMenuCheckboxItem = ({
  children,
  className,
  closeOnSelect = false,
  indeterminate = false,
  ...props
}: DropdownMenuCheckboxItemProps) => {
  const size = useContext(DropdownMenuDensityContext);

  return (
    <MenuPrimitive.CheckboxItem
      className={cn(
        "relative flex min-h-7 cursor-default items-center gap-2 rounded-md py-1 pr-2.5 pl-8 text-body-sm text-fg transition-transform duration-100 ease-out select-none squircle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
        { "min-h-7 gap-1.5 py-1 pr-2 pl-7 text-caption": size === "compact" },
        className
      )}
      closeOnClick={closeOnSelect}
      {...(indeterminate ? { "aria-checked": "mixed" as const } : {})}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-2 flex size-4 items-center justify-center text-fg",
          { "left-1.5": size === "compact" }
        )}
      >
        {indeterminate ? (
          <MinusIcon className="size-3.5" />
        ) : (
          <MenuPrimitive.CheckboxItemIndicator>
            <CheckIcon className="size-3.5" />
          </MenuPrimitive.CheckboxItemIndicator>
        )}
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
};

export const DropdownMenuSubmenuTrigger = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.SubmenuTrigger>) => {
  const size = useContext(DropdownMenuDensityContext);

  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        menuItemClassName,
        "squircle",
        { [menuCompactItemClassName]: size === "compact" },
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-fg" />
    </MenuPrimitive.SubmenuTrigger>
  );
};

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) => {
  const size = useContext(DropdownMenuDensityContext);

  return (
    <MenuPrimitive.Separator
      className={cn(
        menuSeparatorClassName,
        { "my-0.5": size === "compact" },
        className
      )}
      {...props}
    />
  );
};
