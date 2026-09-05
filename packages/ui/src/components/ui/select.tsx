"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "./icons";

type SelectDensity = "default" | "compact";

const SelectDensityContext = createContext<SelectDensity>("default");

const selectTriggerVariants = cva(
  "squircle inline-flex shrink-0 items-center justify-between text-left gap-2 rounded-md font-normal whitespace-nowrap transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-3.5 text-body [&_svg]:size-4",
        sm: "h-8 px-3 text-body-sm [&_svg]:size-3.5",
      },
      variant: {
        default: "w-full border border-border bg-bg-raised text-fg shadow-sm",
        ghost:
          "w-auto bg-transparent text-muted-fg hover:bg-muted hover:text-fg active:bg-muted/80 active:text-fg",
      },
    },
  }
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
      className
    )}
    {...props}
  />
);

export const SelectValue = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Value>) => (
  <SelectPrimitive.Value
    className={cn(
      "min-w-0 flex-1 truncate data-placeholder:text-muted-fg",
      className
    )}
    {...props}
  />
);

export type SelectTriggerProps = ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> &
  VariantProps<typeof selectTriggerVariants> & {
    pending?: boolean;
  };

export const SelectTrigger = ({
  children,
  className,
  pending = false,
  size = "default",
  variant = "default",
  ...props
}: SelectTriggerProps) => (
  <SelectPrimitive.Trigger
    {...props}
    aria-busy={pending || undefined}
    className={cn(selectTriggerVariants({ size, variant }), className)}
    disabled={pending || props.disabled}
  >
    {children}
    <SelectPrimitive.Icon className="shrink-0 text-muted-fg">
      {pending ? (
        <HugeiconsIcon
          aria-hidden
          className="size-3.5 animate-spin"
          icon={Loading03Icon}
        />
      ) : (
        <ChevronDownIcon className="size-4" />
      )}
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

export const SelectContent = ({
  align = "center",
  alignItemWithTrigger = false,
  alignOffset = 0,
  children,
  className,
  positionerClassName,
  side,
  sideOffset = 4,
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Popup> &
  Pick<
    ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>,
    "align" | "alignItemWithTrigger" | "alignOffset" | "side" | "sideOffset"
  > & {
    positionerClassName?: string;
    size?: SelectDensity;
  }) => (
  <SelectPortal>
    <SelectPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      alignItemWithTrigger={alignItemWithTrigger}
      className={cn("z-50", positionerClassName)}
      side={side}
      sideOffset={sideOffset}
    >
      <SelectDensityContext.Provider value={size}>
        <SelectPrimitive.Popup
          className={cn(
            "z-50 min-w-52 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover p-1 text-popover-fg shadow-md transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=none]:min-w-(--anchor-width) data-[side=none]:duration-100 data-[side=none]:data-ending-style:scale-100 data-[side=none]:data-starting-style:scale-100",
            size === "compact" && "min-w-40 p-0.5 text-caption",
            className
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectDensityContext.Provider>
    </SelectPrimitive.Positioner>
  </SelectPortal>
);

export const SelectScrollUpArrow = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpArrow>) => (
  <SelectPrimitive.ScrollUpArrow
    className={cn(
      "flex h-7 items-center justify-center text-muted-fg transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0",
      className
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
      "flex h-7 items-center justify-center text-muted-fg transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0",
      className
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
      className
    )}
    {...props}
  />
);

export const SelectItem = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) => {
  const size = useContext(SelectDensityContext);

  return (
    <SelectPrimitive.Item
      className={cn(
        "squircle relative flex min-h-9 cursor-default scroll-my-1 items-center gap-2 rounded-md py-2 pr-8 pl-2.5 text-body text-fg transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
        size === "compact" && "min-h-7 gap-1.5 py-1 pr-7 pl-2 text-caption",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex size-4 items-center justify-center text-primary">
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
};

export const SelectGroupLabel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.GroupLabel>) => {
  const size = useContext(SelectDensityContext);

  return (
    <SelectPrimitive.GroupLabel
      className={cn(
        "px-2.5 py-1 text-caption text-muted-fg",
        size === "compact" && "px-2 py-0.5 text-micro",
        className
      )}
      {...props}
    />
  );
};

export const SelectSeparator = SelectPrimitive.Separator;
