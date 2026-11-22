"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { Input } from "./input";
import { menuEmptyClassName, menuItemClassName } from "./menu-chrome";
import { anchoredPopupMotionClassName } from "./overlay-chrome";
import { popupSideOffset, popupSurfaceClassName } from "./popup-surface";

export type AutocompleteProps = Pick<
  ComponentProps<typeof Input>,
  | "aria-label"
  | "chrome"
  | "className"
  | "disabled"
  | "id"
  | "maxLength"
  | "name"
  | "placeholder"
  | "required"
  | "size"
> & {
  emptyMessage?: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  value: string;
};

export const Autocomplete = ({
  chrome,
  disabled,
  emptyMessage = "No suggestions. You can enter your own value.",
  onValueChange,
  options,
  size,
  value,
  ...props
}: AutocompleteProps) => (
  <AutocompletePrimitive.Root
    disabled={disabled}
    filter={(option, query) =>
      option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    }
    items={options}
    onValueChange={onValueChange}
    openOnInputClick
    value={value}
  >
    <AutocompletePrimitive.Input
      render={<Input chrome={chrome} size={size} />}
      {...props}
    />
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        align="start"
        className="isolate z-50"
        collisionPadding={8}
        sideOffset={popupSideOffset}
      >
        <AutocompletePrimitive.Popup
          className={cn(
            anchoredPopupMotionClassName,
            popupSurfaceClassName,
            "flex max-h-[min(16rem,var(--available-height))] w-80 max-w-(--available-width) min-w-(--anchor-width) flex-col overflow-hidden rounded-xl"
          )}
        >
          <AutocompletePrimitive.Empty
            className={cn(menuEmptyClassName, "empty:p-0")}
          >
            {emptyMessage}
          </AutocompletePrimitive.Empty>
          <AutocompletePrimitive.List className="min-h-0 overflow-y-auto overscroll-contain p-1 empty:p-0">
            {(option: string) => (
              <AutocompletePrimitive.Item
                className={menuItemClassName}
                key={option}
                value={option}
              >
                <span className="truncate">{option}</span>
              </AutocompletePrimitive.Item>
            )}
          </AutocompletePrimitive.List>
        </AutocompletePrimitive.Popup>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  </AutocompletePrimitive.Root>
);
