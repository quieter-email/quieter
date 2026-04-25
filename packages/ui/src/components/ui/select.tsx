"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "../../lib/cn";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "./icons";

export const Select = SelectPrimitive.Root;
export const SelectPortal = SelectPrimitive.Portal;
export const SelectGroup = SelectPrimitive.Group;
export const SelectBackdrop = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Backdrop>) => (
  <SelectPrimitive.Backdrop
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0",
      className,
    )}
    {...props}
  />
);

export const SelectValue = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Value>) => (
  <SelectPrimitive.Value
    className={cn("min-w-0 flex-1 truncate data-placeholder:text-muted-foreground", className)}
    {...props}
  />
);

export const SelectTrigger = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) => (
  <SelectPrimitive.Trigger
    className={cn(
      "squircle inline-flex h-9 w-full shrink-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3.5 text-sm leading-none font-normal whitespace-nowrap text-foreground shadow-sm transition-transform duration-100 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

export const SelectContent = ({
  align = "center",
  alignOffset = 0,
  children,
  className,
  positionerClassName,
  side = "bottom",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>,
    "align" | "alignItemWithTrigger" | "alignOffset" | "side" | "sideOffset"
  > & {
    positionerClassName?: string;
  }) => (
  <SelectPortal>
    <SelectPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      alignItemWithTrigger={false}
      className={cn("z-50", positionerClassName)}
      side={side}
      sideOffset={sideOffset}
    >
      <SelectPrimitive.Popup
        className={cn(
          "z-50 min-w-52 origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPortal>
);

export const SelectScrollUpArrow = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpArrow>) => (
  <SelectPrimitive.ScrollUpArrow
    className={cn(
      "flex h-7 items-center justify-center text-muted-foreground transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0",
      className,
    )}
    {...props}
  >
    <ChevronUpIcon className="size-4" />
  </SelectPrimitive.ScrollUpArrow>
);

export const SelectScrollDownArrow = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownArrow>) => (
  <SelectPrimitive.ScrollDownArrow
    className={cn(
      "flex h-7 items-center justify-center text-muted-foreground transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0",
      className,
    )}
    {...props}
  >
    <ChevronDownIcon className="size-4" />
  </SelectPrimitive.ScrollDownArrow>
);

export const SelectList = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.List>) => (
  <SelectPrimitive.List className={cn("max-h-72 overflow-y-auto", className)} {...props} />
);

export const SelectItem = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) => (
  <SelectPrimitive.Item
    className={cn(
      "squircle relative flex min-h-9 cursor-default items-center gap-2 rounded-md py-2 pr-8 pl-2.5 text-sm text-foreground transition-transform duration-100 ease-out outline-none select-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted/60 motion-reduce:transition-none motion-reduce:active:scale-100",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex size-4 items-center justify-center text-primary">
      <CheckIcon className="size-4" />
    </SelectPrimitive.ItemIndicator>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
);

export const SelectGroupLabel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.GroupLabel>) => (
  <SelectPrimitive.GroupLabel
    className={cn(
      "px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase",
      className,
    )}
    {...props}
  />
);

export const SelectSeparator = SelectPrimitive.Separator;
