"use client";

import {
  ArrowRight01Icon,
  Calendar03Icon,
  Cancel01Icon,
  Clock01Icon,
  Globe02Icon,
  PaintBoardIcon,
  SquareLock01Icon,
  TextAlignLeftIcon,
} from "@hugeicons/core-free-icons";
import { getCalendarConnectionQueryKey } from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarRef,
  CalendarSummary,
} from "@quieter/calendar";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { ColorSwatch } from "@quieter/ui/color-swatch";
import { DatePicker } from "@quieter/ui/date-picker";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { TimePicker } from "@quieter/ui/time-picker";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";
import { z } from "zod";

import { receiveCalendarEvent } from "../domain/calendar-event-editor";
import type { createCalendarEventEditorStore } from "../domain/calendar-event-editor";
import {
  createCalendarEventForm,
  getCalendarRefKey,
  parseCalendarEventForm,
} from "../domain/calendar-event-form";
import type { CalendarEditor } from "../domain/calendar-event-form";
import { calendarPreviewEventColors } from "../domain/calendar-preview";
import { CalendarEventGuests } from "./calendar-event-guests";
import { CalendarEventLocation } from "./calendar-event-location";
import { CalendarEventRecurrence } from "./calendar-event-recurrence";
import { CalendarEventReminders } from "./calendar-event-reminders";
import { CalendarTimeZonePicker } from "./calendar-time-zone-picker";

const emptyLocationSuggestions: readonly string[] = [];

export const CalendarEventEditor = ({
  calendars,
  editor,
  events,
  locationSuggestions = emptyLocationSuggestions,
  onClose,
  onDelete,
  onRespond,
  onScopeChange,
  onReload,
  onSave,
  pending,
  preview,
  previewIssue,
  store,
  timeZone,
  userId,
}: {
  calendars: CalendarSummary[];
  editor: CalendarEditor;
  events: readonly CalendarEvent[];
  locationSuggestions?: readonly string[];
  onClose: () => void;
  onDelete?: () => void;
  onRespond?: (
    event: CalendarEvent,
    response: "accepted" | "tentative" | "declined"
  ) => Promise<CalendarEvent | undefined>;
  onScopeChange?: (scope: "occurrence" | "series") => Promise<void>;
  onReload: (event: CalendarEvent) => Promise<CalendarEvent>;
  onSave: (input: {
    editor: CalendarEditor;
    ref: CalendarRef;
    draft: CalendarEventDraft;
    original: CalendarEvent | undefined;
  }) => Promise<CalendarEvent | undefined>;
  pending: boolean;
  preview: boolean;
  previewIssue?: string;
  store: ReturnType<typeof createCalendarEventEditorStore>;
  timeZone: string;
  userId: string;
}) => {
  useEffect(() => {
    if (editor.kind === "edit") {
      receiveCalendarEvent({ editor, store, timeZone });
    }
  }, [editor, store, timeZone]);
  const state = useSelector(store, (current) => current);
  const form = state.values;
  const { baseEvent } = state;
  const self = baseEvent?.attendees.find((attendee) => attendee.self);
  const dirty = JSON.stringify(form) !== JSON.stringify(state.initialValues);
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
  const colorsQuery = useQuery({
    enabled: !preview && selectedCalendar !== undefined,
    queryFn: async ({ signal }) =>
      await rpc.calendar.colors(
        { connectionId: selectedCalendar?.connectionId ?? "" },
        { signal }
      ),
    queryKey: [
      ...getCalendarConnectionQueryKey(
        userId,
        selectedCalendar?.connectionId ?? "none"
      ),
      "colors",
    ],
    staleTime: 24 * 60 * 60 * 1000,
  });
  const colors = new Set(
    (preview
      ? calendarPreviewEventColors
      : (colorsQuery.data?.colors ?? [])
    ).map((color) => color.toLowerCase())
  );
  for (const event of events) {
    if (
      event.connectionId === selectedCalendar?.connectionId &&
      event.colorOverride
    ) {
      colors.add(event.colorOverride.toLowerCase());
    }
  }
  if (form.color) {
    colors.add(form.color.toLowerCase());
  }
  const isOccurrence =
    editor.kind === "edit" &&
    editor.scope === "occurrence" &&
    editor.event.recurringEventId !== undefined;
  let description = "";
  if (preview) {
    description = "Sample calendar. Changes stay in this preview.";
  } else if (editor.kind === "edit" && editor.scope === "series") {
    description = "Changes apply to the entire recurring series.";
  } else if (isOccurrence) {
    description = "Changes apply to this occurrence only.";
  }
  const submit = async () => {
    if (!selectedCalendar || pending || (editor.kind === "edit" && !dirty)) {
      return;
    }
    let draft: CalendarEventDraft;
    try {
      draft = parseCalendarEventForm(form, state.baseEvent);
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
      const saved = await onSave({
        draft,
        editor:
          editor.kind === "edit" && state.baseEvent
            ? { ...editor, event: state.baseEvent }
            : editor,
        original: state.baseEvent,
        ref: {
          calendarId: selectedCalendar.calendarId,
          connectionId: selectedCalendar.connectionId,
        },
      });
      if (saved) {
        const values = createCalendarEventForm(
          {
            event: saved,
            kind: "edit",
            scope: editor.kind === "edit" ? editor.scope : "occurrence",
          },
          timeZone
        );
        store.setState((current) => ({
          ...current,
          baseEvent: saved,
          initialValues: values,
          values,
        }));
      }
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
  const respond = async (response: "accepted" | "tentative" | "declined") => {
    if (!state.baseEvent || !onRespond || dirty || pending) {
      return;
    }
    const saved = await onRespond(state.baseEvent, response);
    if (saved) {
      store.setState((current) => ({ ...current, baseEvent: saved }));
    }
  };
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        void submit();
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-5 py-4">
        <Text as="h2" className="flex-1" size="sm" weight="medium">
          {editor.kind === "create" ? "New event" : "Event details"}
        </Text>
        {dirty ? (
          <Text size="caption" tone="muted">
            Unsaved
          </Text>
        ) : null}
        <IconButtonTooltip label="Close event details">
          <Button
            aria-label="Close event details"
            disabled={pending}
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <Icon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <fieldset
          className="@container min-w-0 space-y-4 px-5 pt-2 pb-5"
          disabled={pending}
        >
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
          <Field className="ml-6 w-auto">
            <FieldLabel className="sr-only" htmlFor="calendar-event-title">
              Title
            </FieldLabel>
            <Input
              aria-label="Event title"
              chrome="ghost"
              id="calendar-event-title"
              maxLength={1000}
              onChange={(changeEvent) => {
                store.setState((current) => ({
                  ...current,
                  values: {
                    ...current.values,
                    title: changeEvent.target.value,
                  },
                }));
              }}
              placeholder="Untitled event"
              required
              value={form.title}
            />
            {preview ||
            isOccurrence ||
            (editor.kind === "edit" && editor.scope === "series") ? (
              <FieldDescription className="ml-2.5">
                {description}
              </FieldDescription>
            ) : null}
          </Field>
          {onScopeChange && editor.kind === "edit" ? (
            <Field className="ml-6 w-auto">
              <FieldLabel className="ml-2.5" htmlFor="calendar-event-scope">
                Apply changes to
              </FieldLabel>
              <Select
                disabled={dirty || pending}
                items={[
                  { label: "This event", value: "occurrence" },
                  { label: "Entire series", value: "series" },
                ]}
                onValueChange={(value) => {
                  if (value === "occurrence" || value === "series") {
                    void onScopeChange(value);
                  }
                }}
                value={editor.scope}
              >
                <SelectTrigger id="calendar-event-scope" variant="ghost">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="occurrence">This event</SelectItem>
                  <SelectItem value="series">Entire series</SelectItem>
                </SelectContent>
              </Select>
              {dirty ? (
                <FieldDescription className="ml-2.5">
                  Save or cancel your changes before switching.
                </FieldDescription>
              ) : null}
            </Field>
          ) : null}
          <div className="space-y-1">
            <label
              className="flex cursor-pointer items-center gap-2 py-1 text-body-sm"
              htmlFor="calendar-event-all-day"
            >
              <Checkbox
                disabled={pending}
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
              <span className="ml-2.5">All day</span>
            </label>
            <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 @min-[18rem]:grid-cols-[1rem_minmax(0,1fr)_auto_minmax(0,1fr)]">
              <Icon className="mt-2" icon={Calendar03Icon} tone="muted" />
              <Field className="min-w-0">
                <FieldLabel
                  className="sr-only"
                  htmlFor="calendar-event-start-date"
                >
                  Starts
                </FieldLabel>
                <DatePicker
                  chrome="ghost"
                  id="calendar-event-start-date"
                  onValueChange={(value) => {
                    store.setState((current) => ({
                      ...current,
                      values: {
                        ...current.values,
                        startDate: value,
                      },
                    }));
                  }}
                  required
                  disabled={pending}
                  value={form.startDate}
                />
              </Field>
              <Icon
                className="mt-2.5"
                icon={ArrowRight01Icon}
                size={12}
                tone="muted"
              />
              <Field className="min-w-0">
                <FieldLabel
                  className="sr-only"
                  htmlFor="calendar-event-end-date"
                >
                  Ends
                </FieldLabel>
                <DatePicker
                  chrome="ghost"
                  id="calendar-event-end-date"
                  min={form.startDate}
                  onValueChange={(value) => {
                    store.setState((current) => ({
                      ...current,
                      values: {
                        ...current.values,
                        endDate: value,
                      },
                    }));
                  }}
                  required
                  disabled={pending}
                  value={form.endDate}
                />
                {form.allDay ? (
                  <FieldDescription className="ml-2.5">
                    Includes this date.
                  </FieldDescription>
                ) : null}
              </Field>
              {form.allDay ? null : (
                <>
                  <Icon className="mt-2" icon={Clock01Icon} tone="muted" />
                  <Field className="min-w-0">
                    <FieldLabel
                      className="sr-only"
                      htmlFor="calendar-event-start-time"
                    >
                      Start time
                    </FieldLabel>
                    <TimePicker
                      chrome="ghost"
                      id="calendar-event-start-time"
                      onValueChange={(value) => {
                        store.setState((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            startTime: value,
                          },
                        }));
                      }}
                      required
                      disabled={pending}
                      value={form.startTime}
                    />
                  </Field>
                  <Icon
                    className="mt-2.5"
                    icon={ArrowRight01Icon}
                    size={12}
                    tone="muted"
                  />
                  <Field className="min-w-0">
                    <FieldLabel
                      className="sr-only"
                      htmlFor="calendar-event-end-time"
                    >
                      End time
                    </FieldLabel>
                    <TimePicker
                      chrome="ghost"
                      id="calendar-event-end-time"
                      onValueChange={(value) => {
                        store.setState((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            endTime: value,
                          },
                        }));
                      }}
                      required
                      disabled={pending}
                      value={form.endTime}
                    />
                  </Field>
                </>
              )}
            </div>
            {form.allDay ? null : (
              <Field>
                <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
                  <Icon icon={Globe02Icon} tone="muted" />
                  <FieldLabel
                    className="sr-only"
                    htmlFor="calendar-event-time-zone"
                  >
                    Time zone
                  </FieldLabel>
                  <CalendarTimeZonePicker
                    aria-label="Event time zone"
                    disabled={pending}
                    id="calendar-event-time-zone"
                    onValueChange={(value) => {
                      store.setState((current) => ({
                        ...current,
                        values: { ...current.values, timeZone: value },
                      }));
                    }}
                    value={form.timeZone}
                    variant="ghost"
                  />
                </div>
              </Field>
            )}
            {isOccurrence ? null : (
              <CalendarEventRecurrence
                allDay={form.allDay}
                disabled={pending}
                onChange={(recurrence) => {
                  store.setState((current) => ({
                    ...current,
                    values: { ...current.values, recurrence },
                  }));
                }}
                startDate={form.startDate}
                timeZone={form.timeZone}
                value={form.recurrence}
              />
            )}
            {previewIssue ? (
              <Text
                aria-live="polite"
                className="ml-8.5"
                size="caption"
                tone="muted"
              >
                {previewIssue}
              </Text>
            ) : null}
          </div>
          <div className="space-y-1 border-t border-border pt-3">
            <CalendarEventGuests
              attendees={baseEvent?.attendees}
              disabled={pending}
              onChange={(attendees) => {
                store.setState((current) => ({
                  ...current,
                  values: { ...current.values, attendees },
                }));
              }}
              onOptionalGuestEmailsChange={(optionalGuestEmails) => {
                store.setState((current) => ({
                  ...current,
                  values: { ...current.values, optionalGuestEmails },
                }));
              }}
              optionalGuestEmails={form.optionalGuestEmails}
              preview={preview}
              value={form.attendees}
            />
            {baseEvent?.organizer &&
            !baseEvent.attendees.some((guest) => guest.organizer) ? (
              <div className="ml-6 space-y-1 pl-2.5">
                <Text size="caption" tone="muted">
                  Organizer
                </Text>
                <Text as="p" size="sm">
                  {baseEvent.organizer.name ??
                    baseEvent.organizer.email ??
                    (baseEvent.organizer.self ? "You" : "Event organizer")}
                </Text>
              </div>
            ) : null}
            {baseEvent?.permissions.respond === true && self && onRespond ? (
              <Field className="ml-8.5 w-auto">
                <FieldLabel>Your response</FieldLabel>
                <div className="flex gap-2">
                  {(
                    [
                      { label: "No", value: "declined" },
                      { label: "Maybe", value: "tentative" },
                      { label: "Yes", value: "accepted" },
                    ] as const
                  ).map((response) => (
                    <Button
                      aria-pressed={self.response === response.value}
                      disabled={pending || dirty}
                      key={response.value}
                      onClick={() => {
                        void respond(response.value);
                      }}
                      size="sm"
                      variant="chip"
                    >
                      {response.label}
                    </Button>
                  ))}
                </div>
              </Field>
            ) : null}
            <CalendarEventLocation
              disabled={pending}
              onValueChange={(location) => {
                store.setState((current) => ({
                  ...current,
                  values: { ...current.values, location },
                }));
              }}
              suggestions={locationSuggestions}
              value={form.location}
            />
            <div className="flex items-start gap-2">
              <span className="flex h-9 items-center">
                <Icon icon={TextAlignLeftIcon} tone="muted" />
              </span>
              <Field className="ml-1.5">
                <FieldLabel
                  className="sr-only"
                  htmlFor="calendar-event-description"
                >
                  Description
                </FieldLabel>
                <Textarea
                  variant="compact-prompt"
                  rows={1}
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
                  placeholder="Add description"
                  value={form.description}
                />
              </Field>
            </div>
          </div>
          <div className="space-y-1 border-t border-border pt-3">
            <Field>
              <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
                <Icon icon={Calendar03Icon} tone="muted" />
                <FieldLabel
                  className="sr-only"
                  htmlFor="calendar-event-calendar"
                >
                  Calendar
                </FieldLabel>
                {editor.kind === "edit" ? (
                  <Text className="ml-2.5" size="sm">
                    {selectedCalendar?.name ?? "Calendar"}
                  </Text>
                ) : (
                  <Select
                    disabled={pending}
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
                    <SelectTrigger id="calendar-event-calendar" variant="ghost">
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
                )}
              </div>
            </Field>
            <Field>
              <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
                <Icon icon={PaintBoardIcon} tone="muted" />
                <FieldLabel className="sr-only">Event color</FieldLabel>
                <Popover>
                  <PopoverTrigger
                    aria-label="Event color"
                    className="justify-self-start"
                    disabled={pending}
                    render={<Button size="sm" variant="ghost" />}
                  >
                    <ColorSwatch
                      color={
                        form.color ??
                        selectedCalendar?.color ??
                        "var(--color-q-blue)"
                      }
                    />
                    {form.color ? "Custom color" : "Calendar default"}
                  </PopoverTrigger>
                  <PopoverContent align="start">
                    <PopoverTitle>Event color</PopoverTitle>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[...colors].map((color) => (
                        <IconButtonTooltip key={color} label={`Use ${color}`}>
                          <Button
                            aria-label={`Use ${color}`}
                            aria-pressed={form.color?.toLowerCase() === color}
                            onClick={() => {
                              store.setState((current) => ({
                                ...current,
                                values: { ...current.values, color },
                              }));
                            }}
                            size="icon-sm"
                            variant="chip"
                          >
                            <ColorSwatch
                              color={color}
                              shape="square"
                              size="lg"
                            />
                          </Button>
                        </IconButtonTooltip>
                      ))}
                    </div>
                    {colorsQuery.isError ? (
                      <p className="mt-3 text-caption text-muted-fg">
                        Colors could not load.
                      </p>
                    ) : null}
                    <div className="mt-3">
                      <ActionFooter>
                        <Button
                          onClick={() => {
                            store.setState((current) => ({
                              ...current,
                              values: { ...current.values, color: null },
                            }));
                          }}
                          size="sm"
                          variant="secondary"
                        >
                          <ColorSwatch
                            color={
                              selectedCalendar?.color ?? "var(--color-q-blue)"
                            }
                          />
                          Calendar default
                        </Button>
                      </ActionFooter>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </Field>
            <CalendarEventReminders
              disabled={pending}
              items={form.reminderItems}
              kind={form.reminderKind}
              onItemsChange={(reminderItems) => {
                store.setState((current) => ({
                  ...current,
                  values: { ...current.values, reminderItems },
                }));
              }}
              onKindChange={(reminderKind) => {
                store.setState((current) => ({
                  ...current,
                  values: { ...current.values, reminderKind },
                }));
              }}
            />
            <div className="space-y-1">
              <Field>
                <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
                  <Icon icon={Clock01Icon} tone="muted" />
                  <FieldLabel
                    className="sr-only"
                    htmlFor="calendar-event-availability"
                  >
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
                    <SelectTrigger
                      id="calendar-event-availability"
                      variant="ghost"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="busy">Busy</SelectItem>
                      <SelectItem value="free">Free</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Field>
              <Field>
                <div className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2">
                  <Icon icon={SquareLock01Icon} tone="muted" />
                  <FieldLabel
                    className="sr-only"
                    htmlFor="calendar-event-visibility"
                  >
                    Visibility
                  </FieldLabel>
                  <Select
                    disabled={pending || isOccurrence}
                    items={[
                      { label: "Default visibility", value: "default" },
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
                    <SelectTrigger
                      id="calendar-event-visibility"
                      variant="ghost"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        Default visibility
                      </SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="public">Public</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Field>
            </div>
          </div>
        </fieldset>
      </div>
      {dirty || editor.kind === "create" || onDelete ? (
        <div className="shrink-0 p-5">
          <ActionFooter>
            {dirty || editor.kind === "create" ? (
              <Button
                disabled={pending}
                onClick={() => {
                  if (editor.kind === "create") {
                    onClose();
                  } else {
                    store.setState((current) => {
                      const values = current.sourceEvent
                        ? createCalendarEventForm(
                            { ...editor, event: current.sourceEvent },
                            timeZone
                          )
                        : current.initialValues;
                      return {
                        ...current,
                        baseEvent: current.sourceEvent ?? current.baseEvent,
                        conflict: false,
                        initialValues: values,
                        problem: "",
                        reviewed: null,
                        values,
                      };
                    });
                  }
                }}
                variant="secondary"
              >
                Cancel
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                disabled={pending}
                onClick={onDelete}
                variant="destructive"
              >
                Delete
              </Button>
            ) : null}
            {dirty || editor.kind === "create" ? (
              <Button
                disabled={!selectedCalendar || state.conflict}
                pending={pending}
                type="submit"
              >
                {editor.kind === "create" ? "Create event" : "Save changes"}
              </Button>
            ) : null}
          </ActionFooter>
        </div>
      ) : null}
    </form>
  );
};
