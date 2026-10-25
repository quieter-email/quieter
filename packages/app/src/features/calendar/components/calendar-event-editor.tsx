"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarRef,
  CalendarSummary,
} from "@quieter/calendar";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Textarea } from "@quieter/ui/textarea";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { z } from "zod";

import {
  createCalendarEventForm,
  getCalendarRefKey,
  getCalendarTimeZoneOptions,
  parseCalendarEventForm,
} from "../domain/calendar-event-form";
import type {
  CalendarEditor,
  CalendarEventForm,
} from "../domain/calendar-event-form";

type EditorState = {
  baseEvent: CalendarEvent | undefined;
  conflict: boolean;
  problem: string;
  reviewing: boolean;
  reviewed: CalendarEvent | null;
  values: CalendarEventForm;
};

const repeatOptions = [
  { label: "Does not repeat", value: "none" },
  { label: "Every day", value: "DAILY" },
  { label: "Every week", value: "WEEKLY" },
  { label: "Every month", value: "MONTHLY" },
  { label: "Every year", value: "YEARLY" },
  { label: "Custom repeat rule, preserved", value: "preserve" },
];

export const CalendarEventEditor = ({
  calendars,
  editor,
  onClose,
  onReload,
  onSave,
  pending,
  preview,
  timeZone,
}: {
  calendars: CalendarSummary[];
  editor: CalendarEditor;
  onClose: () => void;
  onReload: (event: CalendarEvent) => Promise<CalendarEvent>;
  onSave: (input: {
    editor: CalendarEditor;
    ref: CalendarRef;
    draft: CalendarEventDraft;
    original: CalendarEvent | undefined;
  }) => Promise<void>;
  pending: boolean;
  preview: boolean;
  timeZone: string;
}) => {
  const store = useCreateStore<EditorState>({
    baseEvent: editor.kind === "edit" ? editor.event : undefined,
    conflict: false,
    problem: "",
    reviewed: null,
    reviewing: false,
    values: createCalendarEventForm(editor, timeZone),
  });
  const state = useSelector(store, (current) => current);
  const form = state.values;
  const selectedCalendar = calendars.find(
    (calendar) => getCalendarRefKey(calendar) === form.calendarKey
  );
  const calendarOptions = calendars
    .filter(
      (calendar) => calendar.access === "write" || calendar.access === "owner"
    )
    .map((calendar) => ({
      label: calendar.name,
      value: getCalendarRefKey(calendar),
    }));
  let repeat = "preserve";
  if (form.recurrence.length === 0) {
    repeat = "none";
  } else {
    const frequency =
      /^RRULE:FREQ=(?<frequency>DAILY|WEEKLY|MONTHLY|YEARLY)$/u.exec(
        form.recurrence[0]
      )?.groups?.frequency;
    if (form.recurrence.length === 1 && frequency) {
      repeat = frequency;
    }
  }
  const isOccurrence =
    editor.kind === "edit" &&
    editor.scope === "occurrence" &&
    editor.event.recurringEventId !== undefined;
  let description = "Make room for what matters.";
  if (preview) {
    description = "Sample calendar. Changes stay in this preview.";
  } else if (editor.kind === "edit" && editor.scope === "series") {
    description = "Changes apply to the entire recurring series.";
  } else if (isOccurrence) {
    description = "Changes apply to this occurrence only.";
  }
  const submit = async () => {
    if (!selectedCalendar || pending) {
      return;
    }
    let draft: CalendarEventDraft;
    try {
      draft = parseCalendarEventForm(
        form,
        editor.kind === "edit" ? editor.event : undefined
      );
    } catch (error) {
      let message = "Check the event details.";
      if (error instanceof z.ZodError) {
        message = error.issues[0]?.message ?? message;
      } else if (error instanceof RangeError) {
        message =
          "Check the dates and times. This local time may be skipped or occur twice in the selected time zone.";
      } else if (error instanceof Error) {
        ({ message } = error);
      }
      store.setState((current) => ({ ...current, problem: message }));
      toastError({ message, status: 400 }, { boundary: "calendar" });
      return;
    }
    store.setState((current) => ({ ...current, problem: "" }));
    try {
      await onSave({
        draft,
        editor:
          editor.kind === "edit" && state.baseEvent
            ? { ...editor, event: state.baseEvent }
            : editor,
        original: editor.kind === "edit" ? editor.event : undefined,
        ref: {
          calendarId: selectedCalendar.calendarId,
          connectionId: selectedCalendar.connectionId,
        },
      });
    } catch (error) {
      const conflict =
        typeof error === "object" &&
        error !== null &&
        (("status" in error &&
          (error.status === 409 || error.status === 412)) ||
          ("code" in error &&
            (error.code === "CONFLICT" ||
              error.code === "PRECONDITION_FAILED")));
      store.setState((current) => ({
        ...current,
        conflict,
        problem: conflict
          ? "This event changed elsewhere. Your draft is still here."
          : "Your event could not be saved. Your draft is still here.",
      }));
    }
  };
  const reviewLatest = async () => {
    if (!state.baseEvent) {
      return;
    }
    store.setState((current) => ({ ...current, reviewing: true }));
    try {
      const reviewed = await onReload(state.baseEvent);
      store.setState((current) => ({ ...current, reviewed, reviewing: false }));
    } catch (error) {
      store.setState((current) => ({ ...current, reviewing: false }));
      toastError(error, { boundary: "calendar" });
    }
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="max-w-xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editor.kind === "create" ? "New event" : "Edit event"}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[65dvh] overflow-y-auto" spacing="4">
            {state.problem ? (
              <p className="text-body-sm text-destructive" role="alert">
                {state.problem}
              </p>
            ) : null}
            {state.conflict ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <Button
                  onClick={() => {
                    void reviewLatest();
                  }}
                  pending={state.reviewing}
                  size="sm"
                  variant="secondary"
                >
                  Review latest event
                </Button>
                {state.reviewed ? (
                  <div className="space-y-2 text-body-sm">
                    <p className="font-medium">{state.reviewed.title}</p>
                    <p className="text-muted-fg">
                      {state.reviewed.description || "No description"}
                    </p>
                    <p className="text-muted-fg">
                      {state.reviewed.time.kind === "all-day"
                        ? state.reviewed.time.startDate
                        : new Date(state.reviewed.time.start).toLocaleString(
                            undefined,
                            { timeZone: form.timeZone }
                          )}
                    </p>
                    <Button
                      onClick={() => {
                        store.setState((current) => ({
                          ...current,
                          baseEvent: current.reviewed ?? current.baseEvent,
                          conflict: false,
                          problem: "",
                          reviewed: null,
                        }));
                      }}
                      size="sm"
                    >
                      Keep my draft and use this version
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <Field>
              <FieldLabel htmlFor="calendar-event-title">Title</FieldLabel>
              <Input
                id="calendar-event-title"
                maxLength={1000}
                onChange={(event) => {
                  store.setState((current) => ({
                    ...current,
                    values: { ...current.values, title: event.target.value },
                  }));
                }}
                placeholder="Give your event a name"
                required
                value={form.title}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-event-calendar">
                Calendar
              </FieldLabel>
              <Select
                disabled={editor.kind === "edit"}
                items={calendarOptions}
                onValueChange={(value) => {
                  if (value) {
                    store.setState((current) => ({
                      ...current,
                      values: { ...current.values, calendarKey: value },
                    }));
                  }
                }}
                value={form.calendarKey}
              >
                <SelectTrigger id="calendar-event-calendar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {calendarOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label
              className="flex cursor-pointer items-center gap-2 text-body-sm"
              htmlFor="calendar-event-all-day"
            >
              <Checkbox
                id="calendar-event-all-day"
                checked={form.allDay}
                onCheckedChange={(checked) => {
                  store.setState((current) => ({
                    ...current,
                    values: { ...current.values, allDay: checked },
                  }));
                }}
              >
                <CheckboxIndicator />
              </Checkbox>
              All day
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="calendar-event-start-date">
                  Starts
                </FieldLabel>
                <Input
                  id="calendar-event-start-date"
                  onChange={(event) => {
                    store.setState((current) => ({
                      ...current,
                      values: {
                        ...current.values,
                        startDate: event.target.value,
                      },
                    }));
                  }}
                  required
                  type="date"
                  value={form.startDate}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="calendar-event-end-date">Ends</FieldLabel>
                <Input
                  id="calendar-event-end-date"
                  min={form.startDate}
                  onChange={(event) => {
                    store.setState((current) => ({
                      ...current,
                      values: {
                        ...current.values,
                        endDate: event.target.value,
                      },
                    }));
                  }}
                  required
                  type="date"
                  value={form.endDate}
                />
                {form.allDay ? (
                  <FieldDescription>Includes this date.</FieldDescription>
                ) : null}
              </Field>
              {form.allDay ? null : (
                <>
                  <Field>
                    <FieldLabel htmlFor="calendar-event-start-time">
                      Start time
                    </FieldLabel>
                    <Input
                      id="calendar-event-start-time"
                      onChange={(event) => {
                        store.setState((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            startTime: event.target.value,
                          },
                        }));
                      }}
                      required
                      type="time"
                      value={form.startTime}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="calendar-event-end-time">
                      End time
                    </FieldLabel>
                    <Input
                      id="calendar-event-end-time"
                      onChange={(event) => {
                        store.setState((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            endTime: event.target.value,
                          },
                        }));
                      }}
                      required
                      type="time"
                      value={form.endTime}
                    />
                  </Field>
                </>
              )}
            </div>
            {form.allDay ? null : (
              <Field>
                <FieldLabel htmlFor="calendar-event-time-zone">
                  Time zone
                </FieldLabel>
                <Select
                  items={getCalendarTimeZoneOptions(form.timeZone)}
                  onValueChange={(value) => {
                    if (value) {
                      store.setState((current) => ({
                        ...current,
                        values: { ...current.values, timeZone: value },
                      }));
                    }
                  }}
                  value={form.timeZone}
                >
                  <SelectTrigger id="calendar-event-time-zone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getCalendarTimeZoneOptions(form.timeZone).map((zone) => (
                      <SelectItem key={zone.value} value={zone.value}>
                        {zone.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {isOccurrence ? null : (
              <Field>
                <FieldLabel htmlFor="calendar-event-repeat">Repeat</FieldLabel>
                <Select
                  items={repeatOptions}
                  onValueChange={(value) => {
                    if (value && value !== "preserve") {
                      store.setState((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          recurrence:
                            value === "none" ? [] : [`RRULE:FREQ=${value}`],
                        },
                      }));
                    }
                  }}
                  value={repeat}
                >
                  <SelectTrigger id="calendar-event-repeat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {repeatOptions
                      .filter(
                        (option) =>
                          option.value !== "preserve" || repeat === "preserve"
                      )
                      .map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {repeat === "preserve" ? (
                  <FieldDescription>
                    Existing repeat rules will stay unchanged.
                  </FieldDescription>
                ) : null}
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="calendar-event-location">
                Location
              </FieldLabel>
              <Input
                id="calendar-event-location"
                maxLength={2000}
                onChange={(event) => {
                  store.setState((current) => ({
                    ...current,
                    values: { ...current.values, location: event.target.value },
                  }));
                }}
                placeholder="Add a place"
                value={form.location}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-event-guests">Guests</FieldLabel>
              <Input
                id="calendar-event-guests"
                onChange={(event) => {
                  store.setState((current) => ({
                    ...current,
                    values: {
                      ...current.values,
                      attendees: event.target.value,
                    },
                  }));
                }}
                placeholder="Email addresses, separated by commas"
                value={form.attendees}
              />
              <FieldDescription>
                {preview
                  ? "No invitations are sent from this preview."
                  : "Saving sends invitations and event updates to guests."}
              </FieldDescription>
            </Field>
            {selectedCalendar?.supportsMeetings === true ? (
              <label
                className="flex cursor-pointer items-center gap-2 text-body-sm"
                htmlFor="calendar-event-add-meeting"
              >
                <Checkbox
                  id="calendar-event-add-meeting"
                  checked={form.addMeeting}
                  onCheckedChange={(checked) => {
                    store.setState((current) => ({
                      ...current,
                      values: { ...current.values, addMeeting: checked },
                    }));
                  }}
                >
                  <CheckboxIndicator />
                </Checkbox>
                Video meeting
              </label>
            ) : null}
            <Field>
              <FieldLabel htmlFor="calendar-event-description">
                Description
              </FieldLabel>
              <Textarea
                id="calendar-event-description"
                maxLength={50_000}
                onChange={(event) => {
                  store.setState((current) => ({
                    ...current,
                    values: {
                      ...current.values,
                      description: event.target.value,
                    },
                  }));
                }}
                placeholder="Add a note or an agenda"
                value={form.description}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-event-reminder">
                Reminder
              </FieldLabel>
              <Select
                items={[
                  { label: "Calendar default", value: "default" },
                  { label: "No reminder", value: "none" },
                  { label: "Custom reminder", value: "custom" },
                ]}
                onValueChange={(value) => {
                  if (
                    value === "default" ||
                    value === "none" ||
                    value === "custom"
                  ) {
                    store.setState((current) => ({
                      ...current,
                      values: { ...current.values, reminderKind: value },
                    }));
                  }
                }}
                value={form.reminderKind}
              >
                <SelectTrigger id="calendar-event-reminder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Calendar default</SelectItem>
                  <SelectItem value="none">No reminder</SelectItem>
                  <SelectItem value="custom">Custom reminder</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.reminderKind === "custom" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="calendar-event-reminder-minutes">
                    Minutes before
                  </FieldLabel>
                  <Input
                    id="calendar-event-reminder-minutes"
                    max={40_320}
                    min={0}
                    onChange={(event) => {
                      store.setState((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          reminderMinutes: event.target.value,
                        },
                      }));
                    }}
                    required
                    type="number"
                    value={form.reminderMinutes}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="calendar-event-reminder-method">
                    Notify by
                  </FieldLabel>
                  <Select
                    items={[
                      { label: "Notification", value: "notification" },
                      { label: "Email", value: "email" },
                    ]}
                    onValueChange={(value) => {
                      if (value === "notification" || value === "email") {
                        store.setState((current) => ({
                          ...current,
                          values: { ...current.values, reminderMethod: value },
                        }));
                      }
                    }}
                    value={form.reminderMethod}
                  >
                    <SelectTrigger id="calendar-event-reminder-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="notification">Notification</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {state.baseEvent?.reminders.kind === "custom" &&
                state.baseEvent.reminders.items.length > 1 ? (
                  <p className="col-span-2 text-caption text-muted-fg">
                    Additional reminders on this event are preserved.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="calendar-event-availability">
                  Show as
                </FieldLabel>
                <Select
                  items={[
                    { label: "Busy", value: "busy" },
                    { label: "Free", value: "free" },
                  ]}
                  onValueChange={(value) => {
                    if (value === "busy" || value === "free") {
                      store.setState((current) => ({
                        ...current,
                        values: { ...current.values, availability: value },
                      }));
                    }
                  }}
                  value={form.availability}
                >
                  <SelectTrigger id="calendar-event-availability">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="busy">Busy</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="calendar-event-visibility">
                  Visibility
                </FieldLabel>
                <Select
                  disabled={isOccurrence}
                  items={[
                    { label: "Calendar default", value: "default" },
                    { label: "Private", value: "private" },
                    { label: "Public", value: "public" },
                  ]}
                  onValueChange={(value) => {
                    if (
                      value === "default" ||
                      value === "private" ||
                      value === "public"
                    ) {
                      store.setState((current) => ({
                        ...current,
                        values: { ...current.values, visibility: value },
                      }));
                    }
                  }}
                  value={form.visibility}
                >
                  <SelectTrigger id="calendar-event-visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Calendar default</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button disabled={pending} onClick={onClose} variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={!selectedCalendar || state.conflict}
              pending={pending}
              type="submit"
            >
              {editor.kind === "create" ? "Create event" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
