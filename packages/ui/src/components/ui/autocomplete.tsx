"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { Input } from "./input";
import { anchoredPopupMotionClassName } from "./overlay-chrome";

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
        sideOffset={4}
      >
        <AutocompletePrimitive.Popup
          className={cn(
            anchoredPopupMotionClassName,
            "flex max-h-[min(16rem,var(--available-height))] w-80 max-w-(--available-width) min-w-(--anchor-width) flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-fg shadow-md"
          )}
        >
          <AutocompletePrimitive.Empty className="px-3 py-4 text-body-sm text-muted-fg">
            {emptyMessage}
          </AutocompletePrimitive.Empty>
          <AutocompletePrimitive.List className="min-h-0 overflow-y-auto overscroll-contain p-1 empty:p-0">
            {(option: string) => (
              <AutocompletePrimitive.Item
                className="flex min-h-8 cursor-default items-center rounded-md px-2 py-1.5 text-body-sm text-fg select-none data-highlighted:bg-muted"
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
