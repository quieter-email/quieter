"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "./icons";
import {
  menuCompactGroupLabelClassName,
  menuCompactItemClassName,
  menuCompactPopupClassName,
  menuGroupLabelClassName,
  menuItemClassName,
  menuListPaddingClassName,
  menuSurfaceClassName,
} from "./menu-chrome";
import {
  anchoredPopupMotionClassName,
  overlayBackdropClassName,
} from "./overlay-chrome";
import { popupSideOffset } from "./popup-surface";

type SelectDensity = "default" | "compact";

const SelectDensityContext = createContext<SelectDensity>("default");

export const selectTriggerVariants = cva(
  "squircle inline-flex shrink-0 items-center justify-between text-left gap-2 rounded-md font-normal whitespace-nowrap select-none focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    compoundVariants: [{ chrome: "toolbar", className: "rounded-xl" }],
    defaultVariants: {
      chrome: "default",
      size: "default",
      variant: "default",
    },
    variants: {
      chrome: {
        default: null,
        toolbar: null,
      },
      size: {
        // Content-sized trigger for a multiline value, such as an identity.
        auto: "h-auto min-h-8 px-2 py-1.5 text-body-sm [&_svg]:size-4",
        default: "h-8 px-2.5 text-body-sm [&_svg]:size-4",
        sm: "h-7 px-2 text-body-sm [&_svg]:size-3.5",
      },
      variant: {
        attached:
          "h-full w-auto rounded-l-none bg-transparent pr-2.5 pl-1.5 text-muted-fg shadow-none hover:bg-muted hover:text-fg active:bg-control-active active:text-fg",
        default:
          "w-full border border-transparent bg-control text-fg hover:bg-control-hover active:bg-control-active",
        ghost:
          "w-auto bg-transparent text-muted-fg hover:bg-muted hover:text-fg active:bg-control-active active:text-fg",
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
    className={cn(overlayBackdropClassName, className)}
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
  chrome = "default",
  className,
  pending = false,
  size = "default",
  variant = "default",
  ...props
}: SelectTriggerProps) => (
  <SelectPrimitive.Trigger
    {...props}
    aria-busy={pending || undefined}
    className={cn(selectTriggerVariants({ chrome, size, variant }), className)}
    disabled={pending || props.disabled}
  >
    {children}
    <SelectPrimitive.Icon className="shrink-0 text-muted-fg">
      {pending ? (
        <Icon aria-hidden size={14} animation="spin" icon={Loading03Icon} />
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
  sideOffset = popupSideOffset,
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
            anchoredPopupMotionClassName,
            menuSurfaceClassName,
            "z-50 max-h-[min(20rem,var(--available-height))] min-w-52 overflow-y-auto overscroll-contain data-[side=none]:min-w-(--anchor-width) data-[side=none]:duration-100 data-[side=none]:data-ending-style:scale-100 data-[side=none]:data-starting-style:scale-100",
            menuListPaddingClassName,
            { [menuCompactPopupClassName]: size === "compact" },
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
      "flex h-7 items-center justify-center text-muted-fg transition-opacity duration-150 ease-(--app-motion-ease-out) data-ending-style:opacity-0 data-ending-style:duration-100 data-instant:transition-none data-starting-style:opacity-0",
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
      "flex h-7 items-center justify-center text-muted-fg transition-opacity duration-150 ease-(--app-motion-ease-out) data-ending-style:opacity-0 data-ending-style:duration-100 data-instant:transition-none data-starting-style:opacity-0",
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
      "max-h-[min(18rem,var(--available-height))] scroll-py-9 overflow-y-auto overscroll-contain",
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
        menuItemClassName,
        "scroll-my-1 pr-8",
        {
          [menuCompactItemClassName]: size === "compact",
          "pr-7": size === "compact",
        },
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
        menuGroupLabelClassName,
        { [menuCompactGroupLabelClassName]: size === "compact" },
        className
      )}
      {...props}
    />
  );
};

export const SelectSeparator = SelectPrimitive.Separator;
