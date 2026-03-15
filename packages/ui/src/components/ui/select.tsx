"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "./icons";
import { floatingPanelClassName } from "./shared";

export const Select = SelectPrimitive.Root;
export const SelectPortal = SelectPrimitive.Portal;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) => (
  <SelectPrimitive.Trigger
    className={cn(
      buttonVariants({ size: "default", variant: "outline" }),
      "w-full justify-between px-3.5 font-normal",
      className,
    )}
    {...props}
  >
    <span className="min-w-0 flex-1 truncate">{children}</span>
    <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

export const SelectContent = ({
  align = "center",
  children,
  className,
  side = "bottom",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>,
    "align" | "side" | "sideOffset"
  >) => (
  <SelectPortal>
    <SelectPrimitive.Positioner align={align} side={side} sideOffset={sideOffset}>
      <SelectPrimitive.Popup
        className={cn(floatingPanelClassName, "overflow-hidden p-1", className)}
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
    className={cn("flex h-7 items-center justify-center text-muted-foreground", className)}
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
    className={cn("flex h-7 items-center justify-center text-muted-foreground", className)}
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
      "relative flex min-h-9 cursor-default items-center gap-2 rounded-md py-2 pr-8 pl-2.5 text-sm text-foreground transition-colors duration-150 ease-out outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted/60",
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
