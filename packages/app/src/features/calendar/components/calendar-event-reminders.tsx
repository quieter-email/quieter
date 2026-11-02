"use client";

import { Notification02Icon } from "@hugeicons/core-free-icons";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { Input } from "@quieter/ui/input";
import { entranceMotionVariants } from "@quieter/ui/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useState } from "react";

import type { CalendarEventForm } from "../domain/calendar-event-form";

export type CalendarEventRemindersProps = {
  kind: CalendarEventForm["reminderKind"];
  items: CalendarEventForm["reminderItems"];
  onKindChange: (kind: CalendarEventForm["reminderKind"]) => void;
  onItemsChange: (items: CalendarEventForm["reminderItems"]) => void;
  disabled: boolean;
};

const reminderUnits = [
  { label: "Minutes", value: 1 },
  { label: "Hours", value: 60 },
  { label: "Days", value: 1440 },
];

const reminderMinutes = (amount: string, unit: number): string => {
  if (amount.trim() === "") {
    return "";
  }
  const minutes = Number(amount) * unit;
  const nearestMinute = Math.round(minutes);
  return String(
    Math.abs(minutes - nearestMinute) <= Number.EPSILON * Math.abs(minutes) * 2
      ? nearestMinute
      : minutes
  );
};

const CalendarReminderRow = ({
  item,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  item: CalendarEventForm["reminderItems"][number];
  index: number;
  disabled: boolean;
  onChange: (item: CalendarEventForm["reminderItems"][number]) => void;
  onRemove: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState(() => {
    const minutes = Number(item.minutesBefore);
    if (minutes > 0 && minutes % 1440 === 0) {
      return 1440;
    }
    return minutes > 0 && minutes % 60 === 0 ? 60 : 1;
  });
  const amount =
    item.minutesBefore.trim() === ""
      ? ""
      : String(Number(item.minutesBefore) / unit);
  let unitLabel = "minute";
  if (unit === 1440) {
    unitLabel = "day";
  } else if (unit === 60) {
    unitLabel = "hour";
  }
  let timing = `${amount} ${unitLabel}${Number(amount) === 1 ? "" : "s"} before`;
  if (amount === "") {
    timing = "Set time";
  } else if (Number(amount) === 0) {
    timing = "At start";
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            className="max-w-full"
            disabled={disabled}
            size="sm"
            variant="ghost"
          />
        }
        aria-label={`Edit reminder ${index + 1}`}
      >
        <span className="truncate">
          {item.method === "email" ? "Email" : "Notification"},{" "}
          {timing.toLowerCase()}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" size="sm">
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor={`reminder-amount-${item.id}`}>
                Before event
              </FieldLabel>
              <Input
                aria-label={`Reminder ${index + 1} amount before`}
                disabled={disabled}
                id={`reminder-amount-${item.id}`}
                max={40_320 / unit}
                min={0}
                onChange={(event) => {
                  const { value } = event.target;
                  onChange({
                    ...item,
                    minutesBefore: reminderMinutes(value, unit),
                  });
                }}
                required
                step="any"
                type="number"
                value={amount}
              />
            </Field>
            <Field className="min-w-0 flex-1">
              <FieldLabel
                className="sr-only"
                htmlFor={`reminder-unit-${item.id}`}
              >
                Time unit
              </FieldLabel>
              <Select
                disabled={disabled}
                items={reminderUnits}
                onValueChange={(value) => {
                  if (value === 1 || value === 60 || value === 1440) {
                    setUnit(value);
                    onChange({
                      ...item,
                      minutesBefore: reminderMinutes(amount, value),
                    });
                  }
                }}
                value={unit}
              >
                <SelectTrigger
                  aria-label={`Reminder ${index + 1} time unit`}
                  id={`reminder-unit-${item.id}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reminderUnits.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={`reminder-method-${item.id}`}>
              Notify by
            </FieldLabel>
            <Select
              disabled={disabled}
              items={[
                { label: "Notification", value: "notification" },
                { label: "Email", value: "email" },
              ]}
              onValueChange={(value) => {
                if (value === "notification" || value === "email") {
                  onChange({ ...item, method: value });
                }
              }}
              value={item.method}
            >
              <SelectTrigger
                aria-label={`Reminder ${index + 1} method`}
                id={`reminder-method-${item.id}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="notification">Notification</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <ActionFooter>
            <Button variant="destructive" onClick={onRemove}>
              Remove
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Done
            </Button>
          </ActionFooter>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const CalendarEventReminders = ({
  kind,
  items,
  onKindChange,
  onItemsChange,
  disabled,
}: CalendarEventRemindersProps) => (
  <div className="space-y-1">
    <Field>
      <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
        <Icon icon={Notification02Icon} tone="muted" />
        <FieldLabel className="sr-only" htmlFor="calendar-event-reminder">
          Reminders
        </FieldLabel>
        <Select
          disabled={disabled}
          items={[
            { label: "Default reminders", value: "default" },
            { label: "No reminders", value: "none" },
            { label: "Custom reminders", value: "custom" },
          ]}
          onValueChange={(value) => {
            if (value === "default" || value === "none" || value === "custom") {
              if (value === "custom" && items.length === 0) {
                onItemsChange([
                  {
                    id: crypto.randomUUID(),
                    method: "notification",
                    minutesBefore: "30",
                  },
                ]);
              }
              onKindChange(value);
            }
          }}
          value={kind}
        >
          <SelectTrigger id="calendar-event-reminder" variant="ghost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default reminders</SelectItem>
            <SelectItem value="none">No reminders</SelectItem>
            <SelectItem value="custom">Custom reminders</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Field>
    {kind === "custom" ? (
      <div className="ml-6 flex flex-col items-start gap-1">
        {items.map((item, index) => (
          <div className={entranceMotionVariants()} key={item.id}>
            <CalendarReminderRow
              item={item}
              index={index}
              disabled={disabled}
              onChange={(updated) => {
                onItemsChange(
                  items.map((entry) => (entry.id === item.id ? updated : entry))
                );
              }}
              onRemove={() => {
                const remaining = items.filter((entry) => entry.id !== item.id);
                onItemsChange(remaining);
                if (remaining.length === 0) {
                  onKindChange("none");
                }
              }}
            />
          </div>
        ))}
        <Button
          disabled={disabled || items.length >= 5}
          onClick={() => {
            onItemsChange([
              ...items,
              {
                id: crypto.randomUUID(),
                method: "notification",
                minutesBefore: "30",
              },
            ]);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Add reminder
        </Button>
      </div>
    ) : null}
  </div>
);
