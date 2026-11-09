"use client";

import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";
import type { CreateReminder, ReminderTarget } from "@quieter/mail/reminders";
import { createReminderSchema } from "@quieter/mail/reminders";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { DatePicker } from "@quieter/ui/date-picker";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { TimePicker } from "@quieter/ui/time-picker";
import { useCallback, useState } from "react";
import type { SubmitEvent } from "react";

import { CalendarTimeZonePicker } from "../calendar/components/calendar-time-zone-picker";
import { ReminderMailContext } from "./reminder-mail-context";
import { getReminderPresetTime } from "./reminder-time";

export type ReminderEditorValues = Pick<
  CreateReminder,
  "title" | "dueAt" | "timeZone" | "target"
>;

export const ReminderEditor = ({
  initial,
  initialCondition,
  mailboxId,
  onCancel,
  onRemove,
  onSave,
  pending = false,
  followUp = false,
  focusTitleOnOpen = false,
  submitLabel = "Set reminder",
}: {
  initial: ReminderEditorValues;
  initialCondition?: string;
  mailboxId?: string;
  onCancel: () => void;
  onRemove?: () => void;
  onSave: (value: ReminderEditorValues & { condition: string | null }) => void;
  pending?: boolean;
  followUp?: boolean;
  focusTitleOnOpen?: boolean;
  submitLabel?: string;
}) => {
  const focusTitle = useCallback(
    (input: HTMLInputElement | null) => {
      if (focusTitleOnOpen) {
        input?.focus({ preventScroll: true });
      }
    },
    [focusTitleOnOpen]
  );
  const [title, setTitle] = useState(initial.title);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [local, setLocal] = useState(() =>
    getZonedDateTimeFields({
      instant: initial.dueAt,
      timeZone: initial.timeZone,
    })
  );
  const [linked, setLinked] = useState(initial.target.kind === "thread");
  const [conditional, setConditional] = useState(
    followUp ||
      (initial.target.kind === "thread" && initial.target.condition !== null)
  );
  const [condition, setCondition] = useState(
    initialCondition ??
      (initial.target.kind === "thread" ? (initial.target.condition ?? "") : "")
  );
  const [error, setError] = useState<string | null>(null);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    let dueAt: string;
    try {
      dueAt = calendarWallTimeToInstant({
        date: local.date,
        disambiguation: "reject",
        time: local.time,
        timeZone,
      });
    } catch {
      setError(
        "This local time is missing or occurs twice because the clocks change. Choose a different time."
      );
      return;
    }
    const target: ReminderTarget =
      linked && initial.target.kind === "thread"
        ? {
            ...initial.target,
            condition: conditional ? condition.trim() : null,
          }
        : { kind: "standalone" };
    const parsed = createReminderSchema.safeParse({
      dueAt,
      mailboxId: "editor",
      requestId: crypto.randomUUID(),
      target,
      timeZone,
      title,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the reminder details."
      );
      return;
    }
    if (followUp && condition.trim() === "") {
      setError("Describe the reply you are waiting for.");
      return;
    }
    setError(null);
    onSave({
      condition: conditional ? condition.trim() : null,
      dueAt,
      target,
      timeZone,
      title: parsed.data.title,
    });
  };
  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="space-y-5">
        <Field>
          <FieldLabel size="caption">Remind me to</FieldLabel>
          <Input
            disabled={pending}
            ref={focusTitle}
            maxLength={240}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            required
            placeholder="Review the proposal"
            value={title}
          />
        </Field>
        <div className="grid gap-1.5">
          <Text as="p" size="caption" tone="muted">
            When
          </Text>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { days: 1, label: "Tomorrow morning" },
                { days: 7, label: "Next week" },
              ] as const
            ).map((preset) => {
              const dueAt = getReminderPresetTime({
                days: preset.days,
                timeZone,
              });
              const fields = getZonedDateTimeFields({
                instant: dueAt,
                timeZone,
              });
              return (
                <Button
                  aria-pressed={
                    fields.date === local.date && fields.time === local.time
                  }
                  disabled={pending}
                  key={preset.days}
                  onClick={() => {
                    setLocal(fields);
                  }}
                  size="sm"
                  type="button"
                  variant="option"
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <DatePicker
                aria-label="Reminder date"
                disabled={pending}
                onValueChange={(date) => {
                  setLocal((value) => ({ ...value, date }));
                }}
                value={local.date}
                required
              />
            </div>
            <div className="w-28 shrink-0">
              <TimePicker
                aria-label="Reminder time"
                disabled={pending}
                onValueChange={(time) => {
                  setLocal((value) => ({ ...value, time }));
                }}
                value={local.time}
                required
              />
            </div>
          </div>
          <div className="justify-self-start">
            <CalendarTimeZonePicker
              aria-label="Time zone"
              disabled={pending}
              onValueChange={setTimeZone}
              size="sm"
              value={timeZone}
              variant="ghost"
            />
          </div>
        </div>
        {initial.target.kind === "thread" && !followUp ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-muted-fg">Linked mail</p>
              <Switch
                aria-label="Link to this conversation"
                checked={linked}
                disabled={pending}
                onCheckedChange={setLinked}
                size="sm"
              >
                <SwitchThumb />
              </Switch>
            </div>
            {linked && mailboxId ? (
              <ReminderMailContext
                layout="summary"
                mailboxId={mailboxId}
                target={initial.target}
              />
            ) : null}
          </div>
        ) : null}
        {linked || followUp ? (
          <div className="space-y-2.5">
            {followUp ? (
              <p className="text-caption text-muted-fg">
                What are you waiting for?
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm font-medium">
                  Complete when they reply
                </span>
                <Switch
                  aria-label="Complete when the reply condition is met"
                  checked={conditional}
                  disabled={pending}
                  onCheckedChange={setConditional}
                  size="sm"
                >
                  <SwitchThumb />
                </Switch>
              </div>
            )}
            {conditional ? (
              <>
                <Textarea
                  aria-label="What are you waiting for?"
                  disabled={pending}
                  maxLength={2000}
                  onChange={(event) => {
                    setCondition(event.target.value);
                  }}
                  placeholder="They confirm the signed contract has been returned"
                  required
                  value={condition}
                  variant="composer"
                />
                <p className="text-caption text-muted-fg">
                  Replies are checked for your condition. A quick
                  acknowledgement will not dismiss it.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="text-body-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <ActionFooter>
        <Button
          disabled={pending}
          onClick={onCancel}
          size="field"
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        {onRemove ? (
          <Button
            aria-label="Remove follow-up reminder"
            disabled={pending}
            onClick={onRemove}
            size="field"
            type="button"
            variant="destructive"
          >
            Remove
          </Button>
        ) : null}
        <Button disabled={pending} size="field" type="submit">
          {pending ? "Saving..." : submitLabel}
        </Button>
      </ActionFooter>
    </form>
  );
};
