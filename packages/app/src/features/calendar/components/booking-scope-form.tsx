"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import type { CalendarRef } from "@quieter/calendar";
import type { CalendarAvailabilityInput } from "@quieter/calendar/availability";
import { Button } from "@quieter/ui/button";
import { DatePicker } from "@quieter/ui/date-picker";
import { DialogBody, DialogFooter } from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { TimePicker } from "@quieter/ui/time-picker";
import { createStore, useSelector } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";

import {
  createCalendarAvailabilityForm,
  parseCalendarAvailabilityExpiry,
  parseCalendarAvailabilityForm,
} from "../domain/calendar-availability-form";
import type { CalendarAvailabilityForm } from "../domain/calendar-availability-form";
import { getCalendarRefKey } from "../domain/calendar-event-form";
import { CalendarAvailabilityFields } from "./calendar-availability-fields";
import { useCalendarAvailabilityCalendars } from "./use-calendar-availability-calendars";

export type BookingScopeFormProps = {
  onCancel: () => void;
  onCreate: (input: {
    availability: CalendarAvailabilityInput;
    destination: CalendarRef;
    expiresAt: string;
    title: string;
  }) => Promise<void>;
  userId: string;
};

type BookingScopeFormState = {
  availability: CalendarAvailabilityForm;
  destinationKey: string;
  expiryDate: string;
  expiryTime: string;
  problem: string;
  submission: "idle" | "pending";
  title: string;
};

const BookingScopeEditor = ({
  onCancel,
  onCreate,
  userId,
}: BookingScopeFormProps) => {
  // oxlint-disable-next-line react/hook-use-state -- The TanStack Store instance stays fixed for this actor's editor lifetime.
  const [store] = useState(() => {
    const availability = createCalendarAvailabilityForm();
    return createStore<BookingScopeFormState>({
      availability,
      destinationKey: "",
      expiryDate: availability.endDate,
      expiryTime: availability.hoursEnd,
      problem: "",
      submission: "idle",
      title: "",
    });
  });
  const state = useSelector(store, (current) => current);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const source = useCalendarAvailabilityCalendars(userId);
  const pending = state.submission === "pending";
  const destinations = source.calendars.filter(
    (calendar) =>
      state.availability.calendarKeys.includes(getCalendarRefKey(calendar)) &&
      (calendar.access === "write" || calendar.access === "owner")
  );
  const destination = destinations.find(
    (calendar) => getCalendarRefKey(calendar) === state.destinationKey
  );
  const updateAvailability = (patch: Partial<CalendarAvailabilityForm>) => {
    store.setState((current) => ({
      ...current,
      availability: { ...current.availability, ...patch },
      destinationKey:
        patch.calendarKeys &&
        !patch.calendarKeys.includes(current.destinationKey)
          ? ""
          : current.destinationKey,
      problem: "",
    }));
  };
  const create = async () => {
    if (
      store.get().submission === "pending" ||
      source.isPending ||
      source.isFetching
    ) {
      return;
    }
    const title = state.title.trim();
    const availability = parseCalendarAvailabilityForm({
      calendars: source.calendars,
      form: state.availability,
    });
    if (!title || availability.kind === "invalid" || !destination) {
      let problem =
        "Choose a writable destination among the checked calendars.";
      if (!title) {
        problem = "Enter a public title for the booking link.";
      } else if (availability.kind === "invalid") {
        problem = availability.message;
      }
      store.setState((current) => ({ ...current, problem }));
      return;
    }
    const expiry = parseCalendarAvailabilityExpiry({
      date: state.expiryDate,
      end: availability.value.end,
      // oxlint-disable-next-line react/purity -- Submission validates expiry against the time the owner confirms.
      now: new Date().toISOString(),
      time: state.expiryTime,
      timeZone: state.availability.timeZone,
    });
    if (expiry.kind === "invalid") {
      store.setState((current) => ({ ...current, problem: expiry.message }));
      return;
    }
    store.setState((current) => ({
      ...current,
      problem: "",
      submission: "pending",
    }));
    try {
      await onCreate({
        availability: availability.value,
        destination: {
          calendarId: destination.calendarId,
          connectionId: destination.connectionId,
        },
        expiresAt: expiry.value,
        title,
      });
    } catch (error) {
      if (active.current) {
        toastError(error, { boundary: "booking-scope" });
      }
    } finally {
      if (active.current) {
        store.setState((current) => ({ ...current, submission: "idle" }));
      }
    }
  };
  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
        <Text as="p" size="caption" tone="muted">
          Anyone with this link can book an available time. Each booking creates
          a private event on your destination calendar. No invitation is sent.
        </Text>
        <Field>
          <FieldLabel size="caption">Public title</FieldLabel>
          <Input
            aria-label="Public booking title"
            disabled={pending}
            maxLength={120}
            onChange={(event) => {
              store.setState((current) => ({
                ...current,
                problem: "",
                title: event.target.value,
              }));
            }}
            required
            value={state.title}
          />
          <Text as="p" size="caption" tone="muted">
            People who open the link will see this title.
          </Text>
        </Field>
        <CalendarAvailabilityFields
          disabled={pending}
          firstDateLabel="First booking date"
          lastDateLabel="Last booking date"
          onChange={updateAvailability}
          source={source}
          timeZoneLabel="Booking time zone"
          value={state.availability}
        />
        <Field>
          <FieldLabel size="caption">Destination calendar</FieldLabel>
          <Select
            disabled={pending || destinations.length === 0}
            items={destinations.map((calendar) => ({
              label: calendar.name,
              value: getCalendarRefKey(calendar),
            }))}
            onValueChange={(value) => {
              store.setState((current) => ({
                ...current,
                destinationKey: value ?? "",
                problem: "",
              }));
            }}
            value={destination ? state.destinationKey : null}
          >
            <SelectTrigger aria-label="Destination calendar">
              <SelectValue placeholder="Choose a calendar" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((calendar) => (
                <SelectItem
                  key={getCalendarRefKey(calendar)}
                  value={getCalendarRefKey(calendar)}
                >
                  {calendar.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Text as="p" size="caption" tone="muted">
            Choose a checked calendar you can add events to.
          </Text>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel size="caption">Link expires on</FieldLabel>
            <DatePicker
              aria-label="Booking link expiry date"
              disabled={pending}
              onValueChange={(expiryDate) => {
                store.setState((current) => ({
                  ...current,
                  expiryDate,
                  problem: "",
                }));
              }}
              required
              value={state.expiryDate}
            />
          </Field>
          <Field>
            <FieldLabel size="caption">At</FieldLabel>
            <TimePicker
              aria-label="Booking link expiry time"
              disabled={pending}
              onValueChange={(expiryTime) => {
                store.setState((current) => ({
                  ...current,
                  expiryTime,
                  problem: "",
                }));
              }}
              required
              value={state.expiryTime}
            />
          </Field>
        </div>
        <Text as="p" size="caption" tone="muted">
          The expiry uses the booking time zone.
        </Text>
        {state.problem ? (
          <Text as="p" role="alert" size="sm" tone="destructive">
            {state.problem}
          </Text>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={pending || source.isPending || source.isFetching}
          type="submit"
        >
          {pending ? "Creating…" : "Create booking link"}
        </Button>
      </DialogFooter>
    </form>
  );
};

export const BookingScopeForm = (props: BookingScopeFormProps) => (
  <BookingScopeEditor key={props.userId} {...props} />
);
