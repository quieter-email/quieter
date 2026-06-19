"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "./icons";

const selectTriggerVariants = cva(
  "squircle inline-flex shrink-0 items-center justify-between text-left gap-2 rounded-md font-normal whitespace-nowrap transition-transform duration-100 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "w-full border border-input bg-background text-foreground shadow-sm",
        ghost:
          "w-auto bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted/80 active:text-foreground",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        default: "h-9 px-3.5 text-sm [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

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

export type SelectTriggerProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>;

export const SelectTrigger = ({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: SelectTriggerProps) => (
  <SelectPrimitive.Trigger
    className={cn(selectTriggerVariants({ size, variant }), className)}
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
  alignItemWithTrigger = true,
  alignOffset = 0,
  children,
  className,
  positionerClassName,
  side,
  sideOffset = 4,
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
      alignItemWithTrigger={alignItemWithTrigger}
      className={cn("z-50 min-h-20", positionerClassName)}
      side={side}
      sideOffset={sideOffset}
    >
      <SelectPrimitive.Popup
        className={cn(
          "z-50 min-w-52 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=none]:min-w-(--anchor-width) data-[side=none]:duration-100 data-[side=none]:data-ending-style:scale-100 data-[side=none]:data-starting-style:scale-100",
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
  <SelectPrimitive.List
    className={cn(
      "max-h-[min(18rem,var(--available-height))] scroll-py-7 overflow-y-auto overscroll-contain",
      className,
    )}
    {...props}
  />
);

export const SelectItem = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) => (
  <SelectPrimitive.Item
    className={cn(
      "squircle relative flex min-h-9 cursor-default scroll-my-1 items-center gap-2 rounded-md py-2 pr-8 pl-2.5 text-sm text-foreground transition-transform duration-100 ease-out outline-none select-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted/60 motion-reduce:transition-none motion-reduce:active:scale-100",
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
    className={cn("px-2.5 py-1 text-xs text-muted-foreground", className)}
    {...props}
  />
);

export const SelectSeparator = SelectPrimitive.Separator;
