"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { formatTimeMinute, parseTimeValue } from "../../lib/date-time";
import { useDateTimePreferences } from "./date-time-preferences";
import { Icon } from "./icon";
import { CheckIcon } from "./icons";
import { inputVariants } from "./input";
import type { Input } from "./input";
import { selectTriggerVariants } from "./select";

export type TimePickerProps = Pick<
  ComponentProps<typeof Input>,
  | "aria-label"
  | "aria-labelledby"
  | "aria-invalid"
  | "className"
  | "disabled"
  | "id"
  | "name"
  | "required"
> & {
  chrome?: "default" | "ghost";
  onValueChange: (value: string) => void;
  value: string;
};

type TimeOption = { label: string; value: string };

export const TimePicker = ({
  "aria-label": ariaLabel,
  chrome = "default",
  className,
  disabled,
  name,
  onValueChange,
  required,
  value,
  ...props
}: TimePickerProps) => {
  const { timeFormat } = useDateTimePreferences();
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const values = new Set(
      Array.from({ length: 96 }, (_, index) =>
        formatTimeMinute(index * 15, "24h")
      )
    );
    const typed = parseTimeValue(query);
    if (typed) {
      values.add(typed);
    }
    if (value) {
      values.add(value);
    }
    return [...values].toSorted().map((time) => {
      const [hour = 0, minute = 0] = time.split(":").map(Number);
      return {
        label: formatTimeMinute(hour * 60 + minute, timeFormat),
        value: time,
      };
    });
  }, [query, timeFormat, value]);
  const items = useMemo(
    () =>
      ComboboxPrimitive.createItems(options, {
        getLabel: (option) => option.label,
        getValue: (option) => option.value,
      }),
    [options]
  );
  return (
    <ComboboxPrimitive.Root<string, false, TimeOption>
      autoHighlight
      disabled={disabled}
      filter={(option, search) =>
        option.value === parseTimeValue(search) ||
        option.label.toLowerCase().includes(search.toLowerCase()) ||
        option.value.includes(search)
      }
      inputValue={query}
      items={items}
      name={name}
      onInputValueChange={setQuery}
      onOpenChange={() => {
        setQuery("");
      }}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          onValueChange(nextValue);
        }
      }}
      required={required}
      value={value}
    >
      <ComboboxPrimitive.Trigger
        {...props}
        aria-label={ariaLabel}
        className={cn(selectTriggerVariants({ variant: chrome }), className)}
      >
        <span className="min-w-0 flex-1 truncate">
          <ComboboxPrimitive.Value placeholder="Choose time" />
        </span>
        <Icon icon={Clock01Icon} size={14} tone="muted" />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          className="isolate z-50"
          collisionPadding={8}
          sideOffset={4}
        >
          <ComboboxPrimitive.Popup
            aria-label={ariaLabel ?? "Choose time"}
            className="flex max-h-[min(18rem,var(--available-height))] w-52 max-w-(--available-width) min-w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-fg shadow-md transition-[opacity,transform] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            <div className="shrink-0 border-b border-border p-2">
              <ComboboxPrimitive.Input
                aria-label="Type a time"
                id={props.id ? `${props.id}-input` : undefined}
                placeholder={
                  timeFormat === "12h" ? "e.g. 2:35 PM" : "e.g. 14:35"
                }
                className={inputVariants()}
              />
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-4 text-body-sm text-muted-fg">
              Enter a valid time.
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="min-h-0 overflow-y-auto overscroll-contain p-1 empty:p-0">
              {(option: TimeOption) => (
                <ComboboxPrimitive.Item
                  className="relative flex min-h-8 cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-body-sm text-fg tabular-nums select-none data-highlighted:bg-muted"
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
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
