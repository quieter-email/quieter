"use client";

import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { useCallback, useId, useState } from "react";

import type { ReminderEditorValues } from "./reminder-editor";
import { getReminderPresetTime } from "./reminder-time";

export const ReminderQuickEntry = ({
  onCancel,
  onChooseDate,
  onSave,
  pending,
}: {
  onCancel: () => void;
  onChooseDate: (values: ReminderEditorValues) => void;
  onSave: (values: ReminderEditorValues) => void;
  pending: boolean;
}) => {
  const titleId = useId();
  const focusTitle = useCallback((input: HTMLInputElement | null) => {
    input?.focus({ preventScroll: true });
  }, []);
  const [preset, setPreset] = useState<1 | 7>(1);
  const [values, setValues] = useState<ReminderEditorValues>(() => {
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    return {
      dueAt: getReminderPresetTime({ days: 1, timeZone }),
      target: { kind: "standalone" },
      timeZone,
      title: "",
    };
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const title = values.title.trim();
        if (title) {
          onSave({ ...values, title });
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={titleId} size="caption">
          Remind me to
        </FieldLabel>
        <Input
          ref={focusTitle}
          id={titleId}
          disabled={pending}
          maxLength={240}
          onChange={(event) => {
            setValues((current) => ({ ...current, title: event.target.value }));
          }}
          placeholder="Review the proposal"
          required
          value={values.title}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        {(
          [
            { days: 1, label: "Tomorrow morning" },
            { days: 7, label: "Next week" },
          ] satisfies { days: 1 | 7; label: string }[]
        ).map((option) => (
          <Button
            aria-pressed={preset === option.days}
            disabled={pending}
            key={option.days}
            onClick={() => {
              if (option.days === 1 || option.days === 7) {
                setPreset(option.days);
                setValues((current) => ({
                  ...current,
                  dueAt: getReminderPresetTime({
                    days: option.days,
                    timeZone: current.timeZone,
                  }),
                }));
              }
            }}
            size="sm"
            type="button"
            variant="option"
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-fg">
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: values.timeZone,
          }).format(new Date(values.dueAt))}
        </p>
        <Button
          disabled={pending}
          onClick={() => {
            onChooseDate(values);
          }}
          size="text"
          type="button"
          variant="ghost"
        >
          Choose date or details...
        </Button>
      </div>
      <ActionFooter>
        <Button
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button disabled={pending || values.title.trim() === ""} type="submit">
          {pending ? "Setting..." : "Set reminder"}
        </Button>
      </ActionFooter>
    </form>
  );
};
