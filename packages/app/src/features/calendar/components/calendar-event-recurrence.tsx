import { RepeatIcon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { DatePicker } from "@quieter/ui/date-picker";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { Input } from "@quieter/ui/input";
import { entranceMotionVariants } from "@quieter/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { useId, useState } from "react";

import {
  buildRecurrence,
  createRecurrenceDraft,
  parseAdvancedRecurrence,
  readRecurrence,
  recurrenceWeekdays,
} from "../domain/calendar-recurrence";
import type {
  RecurrenceContext,
  RecurrenceDraft,
} from "../domain/calendar-recurrence";

const weekdays = [
  { label: "Monday", value: "MO" },
  { label: "Tuesday", value: "TU" },
  { label: "Wednesday", value: "WE" },
  { label: "Thursday", value: "TH" },
  { label: "Friday", value: "FR" },
  { label: "Saturday", value: "SA" },
  { label: "Sunday", value: "SU" },
];
const frequencies = [
  { label: "Days", value: "DAILY" },
  { label: "Weeks", value: "WEEKLY" },
  { label: "Months", value: "MONTHLY" },
  { label: "Years", value: "YEARLY" },
];
const presets = [
  { label: "Does not repeat", rule: "", value: "none" },
  { label: "Daily", rule: "RRULE:FREQ=DAILY", value: "daily" },
  {
    label: "Every weekday",
    rule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    value: "weekdays",
  },
  { label: "Weekly", rule: "RRULE:FREQ=WEEKLY", value: "weekly" },
  { label: "Monthly", rule: "RRULE:FREQ=MONTHLY", value: "monthly" },
  { label: "Yearly", rule: "RRULE:FREQ=YEARLY", value: "yearly" },
  { label: "Custom repeat", rule: "", value: "custom" },
];

const RecurrenceChoice = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) => {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options}
        value={value}
        onValueChange={(next) => {
          if (next) {
            onChange(next);
          }
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
};

const CustomRecurrence = ({
  value,
  context,
  onApply,
  onClose,
}: {
  value: string[];
  context: RecurrenceContext;
  onApply: (value: string[]) => void;
  onClose: () => void;
}) => {
  const parsed = readRecurrence(value, context);
  const [draft, setDraft] = useState<RecurrenceDraft>(
    () => parsed ?? createRecurrenceDraft(context.startDate)
  );
  const [mode, setMode] = useState(parsed ? "schedule" : "advanced");
  const [raw, setRaw] = useState(value.join("\n"));
  const [problem, setProblem] = useState("");
  const id = useId();
  const update = (change: Partial<RecurrenceDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    setProblem("");
  };
  const changeMode = (next: string) => {
    try {
      if (next === "advanced") {
        setRaw(buildRecurrence(draft, context).join("\n"));
      } else {
        const schedule = readRecurrence(
          parseAdvancedRecurrence(raw, context),
          context
        );
        if (!schedule) {
          setProblem(
            "This rule uses options available only in Advanced rules. Edit it here, or choose a different repeat option outside this dialog."
          );
          return;
        }
        setDraft(schedule);
      }
      setMode(next);
      setProblem("");
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Check the repeat schedule."
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>Custom repeat</DialogTitle>
          <DialogDescription>
            Choose when this event repeats and when it ends.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
          <RecurrenceChoice
            label="Edit mode"
            value={mode}
            onChange={changeMode}
            options={[
              { label: "Repeat schedule", value: "schedule" },
              { label: "Advanced rules", value: "advanced" },
            ]}
          />
          {mode === "advanced" ? (
            <Field reveal>
              <FieldLabel htmlFor={`${id}-rules`}>Repeat rules</FieldLabel>
              <Textarea
                id={`${id}-rules`}
                value={raw}
                rows={6}
                maxLength={40_000}
                onChange={(event) => {
                  setRaw(event.target.value);
                  setProblem("");
                }}
                aria-describedby={`${id}-help`}
              />
              <Text as="p" size="caption" tone="muted" id={`${id}-help`}>
                One iCalendar rule per line. Use RRULE or RDATE to add repeats,
                and EXDATE or EXRULE to exclude them. Example:
                RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10
              </Text>
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor={`${id}-interval`}>
                    Repeat every
                  </FieldLabel>
                  <Input
                    id={`${id}-interval`}
                    type="number"
                    min={1}
                    max={2_147_483_647}
                    value={draft.interval}
                    onChange={(event) => {
                      update({ interval: event.target.value });
                    }}
                  />
                </Field>
                <RecurrenceChoice
                  label="Frequency"
                  value={draft.frequency}
                  options={frequencies}
                  onChange={(frequency) => {
                    if (
                      frequency === "DAILY" ||
                      frequency === "WEEKLY" ||
                      frequency === "MONTHLY" ||
                      frequency === "YEARLY"
                    ) {
                      update({ frequency });
                    }
                  }}
                />
              </div>
              {draft.frequency === "WEEKLY" ? (
                <Field reveal>
                  <FieldLabel>Repeat on</FieldLabel>
                  <div className="flex flex-wrap gap-1">
                    {recurrenceWeekdays.map((day, index) => (
                      <Button
                        key={day}
                        aria-label={weekdays[index]?.label}
                        aria-pressed={draft.weekdays.includes(day)}
                        size="sm"
                        variant="chip"
                        onClick={() => {
                          update({
                            weekdays: draft.weekdays.includes(day)
                              ? draft.weekdays.filter(
                                  (selected) => selected !== day
                                )
                              : [...draft.weekdays, day],
                          });
                        }}
                      >
                        {weekdays[index]?.label.slice(0, 3)}
                      </Button>
                    ))}
                  </div>
                </Field>
              ) : null}
              {draft.frequency === "MONTHLY" ? (
                <>
                  <RecurrenceChoice
                    label="Repeat by"
                    value={draft.monthly}
                    options={[
                      { label: "Day of the month", value: "date" },
                      { label: "Weekday of the month", value: "weekday" },
                    ]}
                    onChange={(monthly) => {
                      if (monthly === "date" || monthly === "weekday") {
                        update({ monthly });
                      }
                    }}
                  />
                  {draft.monthly === "date" ? (
                    <Field reveal>
                      <FieldLabel htmlFor={`${id}-month-day`}>
                        Day of month
                      </FieldLabel>
                      <Input
                        id={`${id}-month-day`}
                        type="number"
                        min={1}
                        max={31}
                        value={draft.monthDay}
                        onChange={(event) => {
                          update({ monthDay: event.target.value });
                        }}
                      />
                      <Text as="p" size="caption" tone="muted">
                        Months without this day are skipped.
                      </Text>
                    </Field>
                  ) : (
                    <div
                      className={cn(
                        "grid grid-cols-2 gap-3",
                        entranceMotionVariants()
                      )}
                    >
                      <RecurrenceChoice
                        label="Week"
                        value={draft.ordinal}
                        options={[
                          { label: "First", value: "1" },
                          { label: "Second", value: "2" },
                          { label: "Third", value: "3" },
                          { label: "Fourth", value: "4" },
                          { label: "Fifth", value: "5" },
                          { label: "Last", value: "-1" },
                        ]}
                        onChange={(ordinal) => {
                          update({ ordinal });
                        }}
                      />
                      <RecurrenceChoice
                        label="Weekday"
                        value={draft.weekday}
                        options={weekdays}
                        onChange={(weekday) => {
                          const day = recurrenceWeekdays.find(
                            (candidate) => candidate === weekday
                          );
                          if (day) {
                            update({ weekday: day });
                          }
                        }}
                      />
                    </div>
                  )}
                </>
              ) : null}
              {draft.frequency === "YEARLY" ? (
                <Text as="p" size="sm" tone="muted">
                  Repeats on the event’s start month and day. Years without this
                  date are skipped.
                </Text>
              ) : null}
              <RecurrenceChoice
                label="Ends"
                value={draft.ending}
                options={[
                  { label: "Never", value: "never" },
                  { label: "On date", value: "date" },
                  { label: "After occurrences", value: "count" },
                ]}
                onChange={(ending) => {
                  if (
                    ending === "never" ||
                    ending === "date" ||
                    ending === "count"
                  ) {
                    update({ ending });
                  }
                }}
              />
              {draft.ending === "date" ? (
                <Field reveal>
                  <FieldLabel htmlFor={`${id}-end`}>
                    Last repeat date
                  </FieldLabel>
                  <DatePicker
                    id={`${id}-end`}
                    min={context.startDate}
                    value={draft.endDate}
                    onValueChange={(endDate) => {
                      update({ endDate });
                    }}
                  />
                  <Text as="p" size="caption" tone="muted">
                    Includes repeats on this date in the event’s time zone.
                  </Text>
                </Field>
              ) : null}
              {draft.ending === "count" ? (
                <Field reveal>
                  <FieldLabel htmlFor={`${id}-count`}>
                    Number of occurrences
                  </FieldLabel>
                  <Input
                    id={`${id}-count`}
                    type="number"
                    min={1}
                    max={2_147_483_647}
                    value={draft.count}
                    onChange={(event) => {
                      update({ count: event.target.value });
                    }}
                  />
                  <Text as="p" size="caption" tone="muted">
                    Includes the first event.
                  </Text>
                </Field>
              ) : null}
            </>
          )}
          {problem ? (
            <p className="text-body-sm text-destructive" role="alert">
              {problem}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              try {
                onApply(
                  mode === "advanced"
                    ? parseAdvancedRecurrence(raw, context)
                    : buildRecurrence(draft, context)
                );
              } catch (error) {
                setProblem(
                  error instanceof Error
                    ? error.message
                    : "Check the repeat schedule."
                );
              }
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const CalendarEventRecurrence = ({
  value,
  onChange,
  startDate,
  timeZone,
  allDay,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  startDate: string;
  timeZone: string;
  allDay: boolean;
  disabled: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const selected =
    value.length === 0
      ? "none"
      : (presets.find(
          (preset) => value.length === 1 && preset.rule === value[0]
        )?.value ?? "custom");
  return (
    <>
      <Field>
        <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
          <Icon icon={RepeatIcon} tone="muted" />
          <FieldLabel className="sr-only" htmlFor={id}>
            Repeat
          </FieldLabel>
          <div className="flex min-w-0 items-center gap-1">
            <Select
              disabled={disabled}
              items={presets}
              value={selected}
              onValueChange={(next) => {
                if (next === "custom") {
                  setOpen(true);
                } else {
                  const preset = presets.find((item) => item.value === next);
                  if (preset) {
                    onChange(preset.rule ? [preset.rule] : []);
                  }
                }
              }}
            >
              <SelectTrigger id={id} variant="ghost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected === "custom" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  setOpen(true);
                }}
              >
                Edit
              </Button>
            ) : null}
          </div>
        </div>
      </Field>
      {open && !disabled ? (
        <CustomRecurrence
          value={value}
          context={{ allDay, startDate, timeZone }}
          onClose={() => {
            setOpen(false);
          }}
          onApply={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
};
