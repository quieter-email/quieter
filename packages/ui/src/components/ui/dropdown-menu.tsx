"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";

import { cn } from "../../lib/cn";
import { CheckIcon, ChevronRightIcon, MinusIcon } from "./icons";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuSubmenu = MenuPrimitive.SubmenuRoot;
export const DropdownMenuPortal = MenuPrimitive.Portal;

type DropdownMenuDensity = "default" | "compact";

const DropdownMenuDensityContext =
  createContext<DropdownMenuDensity>("default");

export const DropdownMenuTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Trigger>) => (
  <MenuPrimitive.Trigger
    className={cn(
      "transition-transform duration-100 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
      className
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
            "z-50 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] min-w-52 origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-body text-popover-fg shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[translate,opacity,height,width] data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
            size === "compact" && "min-w-40 p-0.5 text-caption",
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
              "z-50 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] min-w-52 origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-body text-popover-fg shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
              resolvedSize === "compact" && "min-w-40 p-0.5 text-caption",
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
};

const DropdownMenuItemContent = ({
  className,
  closeOnSelect,
  onSelect,
  ...props
}: DropdownMenuItemProps) => {
  const size = useContext(DropdownMenuDensityContext);

  return (
    <MenuPrimitive.Item
      className={cn(
        "squircle relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-body text-fg transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
        size === "compact" && "min-h-7 gap-1.5 px-2 text-caption",
        className
      )}
      closeOnClick={closeOnSelect}
      onClick={(event: MouseEvent<HTMLElement>) => onSelect?.(event)}
      {...props}
    />
  );
};

export const DropdownMenuItem = ({
  className,
  closeOnSelect = true,
  onSelect,
  ...props
}: DropdownMenuItemProps) => (
  <DropdownMenuItemContent
    className={className}
    closeOnSelect={closeOnSelect}
    onSelect={onSelect}
    {...props}
  />
);

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
        "squircle relative flex min-h-9 cursor-default items-center gap-2 rounded-md py-1.5 pr-2.5 pl-8 text-body text-fg transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
        size === "compact" && "min-h-7 gap-1.5 py-1 pr-2 pl-7 text-caption",
        className
      )}
      closeOnClick={closeOnSelect}
      {...(indeterminate ? { "aria-checked": "mixed" as const } : {})}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-2 flex size-4 items-center justify-center text-fg",
          size === "compact" && "left-1.5"
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

const DropdownMenuSubmenuTriggerContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.SubmenuTrigger>) => {
  const size = useContext(DropdownMenuDensityContext);

  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        "squircle relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-body text-fg transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
        size === "compact" && "min-h-7 gap-1.5 px-2 text-caption",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-fg" />
    </MenuPrimitive.SubmenuTrigger>
  );
};

export const DropdownMenuSubmenuTrigger = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.SubmenuTrigger>) => (
  <DropdownMenuSubmenuTriggerContent className={className} {...props}>
    {children}
  </DropdownMenuSubmenuTriggerContent>
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) => {
  const size = useContext(DropdownMenuDensityContext);

  return (
    <MenuPrimitive.Separator
      className={cn(
        "my-1 h-px bg-border",
        size === "compact" && "my-0.5",
        className
      )}
      {...props}
    />
  );
};
