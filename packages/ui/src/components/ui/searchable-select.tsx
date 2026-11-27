"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useMemo } from "react";

import { cn } from "../../lib/cn";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { Input } from "./input";
import {
  menuEmptyClassName,
  menuItemClassName,
  menuListPaddingClassName,
  menuSurfaceClassName,
} from "./menu-chrome";
import { anchoredPopupMotionClassName } from "./overlay-chrome";
import { PopupMenuSearch } from "./popup-menu";
import { popupSideOffset } from "./popup-surface";
import { selectTriggerVariants } from "./select";
import type { SelectTriggerProps } from "./select";

export type SearchableSelectOption = {
  description?: string;
  keywords?: string[];
  label: string;
  value: string;
};

export type SearchableSelectProps = Pick<
  SelectTriggerProps,
  "aria-label" | "chrome" | "className" | "disabled" | "id" | "size" | "variant"
> & {
  emptyMessage?: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  searchPlaceholder?: string;
  value: string;
};

export const SearchableSelect = ({
  "aria-label": ariaLabel,
  chrome = "default",
  className,
  disabled,
  emptyMessage = "No matches found.",
  id,
  onValueChange,
  options,
  searchPlaceholder = "Search options",
  size = "default",
  value,
  variant = "default",
}: SearchableSelectProps) => {
  const items = useMemo(
    () =>
      ComboboxPrimitive.createItems(options, {
        getLabel: (option) => option.label,
        getValue: (option) => option.value,
      }),
    [options]
  );

  return (
    <ComboboxPrimitive.Root<string, false, SearchableSelectOption>
      autoHighlight
      disabled={disabled}
      filter={(option, query) => {
        const text = [
          option.label,
          option.value,
          option.description ?? "",
          ...(option.keywords ?? []),
        ]
          .join(" ")
          .normalize("NFD")
          .replaceAll(/\p{Diacritic}/gu, "")
          .toLocaleLowerCase();
        return query
          .normalize("NFD")
          .replaceAll(/\p{Diacritic}/gu, "")
          .toLocaleLowerCase()
          .trim()
          .split(/\s+/u)
          .every((word) => text.includes(word));
      }}
      items={items}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          onValueChange(nextValue);
        }
      }}
      value={value}
    >
      <ComboboxPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          selectTriggerVariants({ chrome, size, variant }),
          className
        )}
        id={id}
      >
        <span className="min-w-0 flex-1 truncate">
          <ComboboxPrimitive.Value />
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-fg" />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          className="isolate z-50"
          collisionPadding={8}
          sideOffset={popupSideOffset}
        >
          <ComboboxPrimitive.Popup
            aria-label={ariaLabel}
            className={cn(
              anchoredPopupMotionClassName,
              menuSurfaceClassName,
              "flex max-h-[min(16rem,var(--available-height))] w-80 max-w-(--available-width) min-w-(--anchor-width) flex-col overflow-hidden"
            )}
          >
            <PopupMenuSearch>
              <ComboboxPrimitive.Input
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                render={<Input chrome="command" size="sm" />}
              />
            </PopupMenuSearch>
            <ComboboxPrimitive.Empty>
              <p className={menuEmptyClassName}>{emptyMessage}</p>
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List
              className={cn(
                "min-h-0 overflow-y-auto overscroll-contain empty:p-0",
                menuListPaddingClassName
              )}
            >
              {(option: SearchableSelectOption) => (
                <ComboboxPrimitive.Item
                  className={cn(menuItemClassName, "pr-8")}
                  key={option.value}
                  value={option.value}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-caption text-muted-fg">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <ComboboxPrimitive.ItemIndicator className="absolute right-2.5 flex size-4 items-center justify-center text-primary">
                    <CheckIcon className="size-4" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
};
