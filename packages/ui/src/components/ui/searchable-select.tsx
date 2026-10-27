"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useMemo } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { Input } from "./input";
import { InputAddon, InputGroup } from "./input-group";
import { anchoredPopupMotionClassName } from "./overlay-chrome";
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
  "aria-label" | "className" | "disabled" | "id" | "size" | "variant"
> & {
  emptyMessage?: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  searchPlaceholder?: string;
  value: string;
};

export const SearchableSelect = ({
  "aria-label": ariaLabel,
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
        className={cn(selectTriggerVariants({ size, variant }), className)}
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
          sideOffset={4}
        >
          <ComboboxPrimitive.Popup
            aria-label={ariaLabel}
            className={cn(
              anchoredPopupMotionClassName,
              "flex max-h-[min(16rem,var(--available-height))] w-80 max-w-(--available-width) min-w-(--anchor-width) flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-fg shadow-md"
            )}
          >
            <div className="shrink-0 border-b border-border p-2">
              <InputGroup>
                <InputAddon
                  aria-hidden
                  className="ml-3 flex shrink-0 items-center"
                >
                  <Icon icon={Search01Icon} size={14} tone="muted" />
                </InputAddon>
                <ComboboxPrimitive.Input
                  aria-label={searchPlaceholder}
                  placeholder={searchPlaceholder}
                  render={<Input chrome="attached" />}
                />
              </InputGroup>
            </div>
            <ComboboxPrimitive.Empty className="text-center text-body-sm text-muted-fg">
              <p className="px-3 py-4">{emptyMessage}</p>
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="min-h-0 overflow-y-auto overscroll-contain p-1 empty:p-0">
              {(option: SearchableSelectOption) => (
                <ComboboxPrimitive.Item
                  className="relative flex min-h-8 cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-body-sm text-fg select-none data-highlighted:bg-muted"
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
                  <ComboboxPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center text-primary">
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
