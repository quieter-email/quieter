"use client";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { format } from "date-fns";
import { useState } from "react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { parseDateValue } from "../../lib/date-time";
import { Calendar } from "./calendar";
import { Icon } from "./icon";
import type { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { selectTriggerVariants } from "./select";

export type DatePickerProps = Pick<
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
  max?: string;
  min?: string;
  onValueChange: (value: string) => void;
  value: string;
};

export const DatePicker = ({
  chrome = "default",
  className,
  disabled,
  max,
  min,
  name,
  onValueChange,
  required,
  value,
  ...props
}: DatePickerProps) => {
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const earliest = min ? parseDateValue(min) : undefined;
  const latest = max ? parseDateValue(max) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {name ? (
        <input disabled={disabled} name={name} type="hidden" value={value} />
      ) : null}
      <PopoverTrigger
        {...props}
        aria-required={required}
        className={cn(selectTriggerVariants({ variant: chrome }), className)}
        disabled={disabled}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? format(selected, "MMM d, yyyy") : "Choose date"}
        </span>
        <Icon icon={Calendar03Icon} size={14} tone="muted" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-fit">
        <Calendar
          defaultMonth={selected}
          disabled={[
            ...(earliest ? [{ before: earliest }] : []),
            ...(latest ? [{ after: latest }] : []),
          ]}
          mode="single"
          onSelect={(date) => {
            onValueChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
          required
          selected={selected}
        />
      </PopoverContent>
    </Popover>
  );
};
