"use client";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import {
  calendarAccountsQueryOptions,
  calendarCalendarsQueryOptions,
} from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { calendarAvailabilityInputSchema } from "@quieter/calendar/availability";
import type { CalendarAvailabilityInput } from "@quieter/calendar/availability";
import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { DatePicker } from "@quieter/ui/date-picker";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { TimePicker } from "@quieter/ui/time-picker";
import { ToolbarButton } from "@quieter/ui/toolbar";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createStore, useSelector } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import {
  addCalendarDays,
  getCalendarRefKey,
} from "../domain/calendar-event-form";
import {
  activateMeetingProposals,
  formatMeetingProposal,
  rememberMeetingProposal,
} from "../domain/meeting-proposals";
import type {
  MeetingProposalInsertion,
  MeetingReplyTarget,
} from "../domain/meeting-proposals";
import { CalendarTimeZonePicker } from "./calendar-time-zone-picker";

type ProposalFilters = {
  calendarKeys: string[];
  duration: string;
  endDate: string;
  hoursEnd: string;
  hoursStart: string;
  bufferAfter: string;
  bufferBefore: string;
  startDate: string;
  timeZone: string;
  weekdays: number[];
};
type ProposalPickerProps = {
  disabled: boolean;
  onInsert: (input: MeetingProposalInsertion) => boolean;
  target: MeetingReplyTarget;
  title: string;
  userId: string;
};

type ProposalEditorState = {
  filters: ProposalFilters;
  introduction: string;
  problem: string;
  request: CalendarAvailabilityInput | null;
  selected: string[];
};

const MeetingProposalEditor = ({
  onClose,
  onInsert,
  target,
  title,
  userId,
}: Omit<ProposalPickerProps, "disabled"> & { onClose: () => void }) => {
  // oxlint-disable-next-line react/hook-use-state -- The TanStack Store instance stays fixed for this editor lifetime.
  const [store] = useState(() => {
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    const today = getZonedDateTimeFields({
      instant: new Date().toISOString(),
      timeZone,
    }).date;
    return createStore<ProposalEditorState>({
      filters: {
        bufferAfter: "0",
        bufferBefore: "0",
        calendarKeys: [],
        duration: "30",
        endDate: addCalendarDays(today, 7),
        hoursEnd: "17:00",
        hoursStart: "09:00",
        startDate: addCalendarDays(today, 1),
        timeZone,
        weekdays: [1, 2, 3, 4, 5],
      },
      introduction: "Would any of these times work for you?",
      problem: "",
      request: null,
      selected: [],
    });
  });
  const state = useSelector(store, (current) => current);
  const { filters } = state;
  const accounts = useQuery(calendarAccountsQueryOptions(userId));
  const calendarQueries = useQueries({
    queries: (accounts.data?.accounts ?? [])
      .filter((account) => account.status === "connected")
      .map((account) => calendarCalendarsQueryOptions(userId, account.id)),
  });
  const calendars = calendarQueries.flatMap(
    (query) => query.data?.calendars ?? []
  );
  const availability = useQuery({
    enabled: state.request !== null,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!state.request) {
        throw new Error("Choose calendars and scheduling preferences first.");
      }
      const result = await rpc.calendar.availability(state.request, { signal });
      return {
        ...result,
        candidates: result.candidates.filter(
          (candidate) => Date.parse(candidate.start) > Date.now()
        ),
      };
    },
    queryKey: [
      "calendar",
      userId,
      "mailbox",
      target.mailboxId,
      "reply-proposal",
      target,
      state.request,
    ],
    staleTime: 0,
  });
  useEffect(() => {
    activateMeetingProposals(userId);
  }, [userId]);
  useEffect(() => {
    if (availability.error) {
      toastError(availability.error, { boundary: "meeting-proposal" });
    }
  }, [availability.error]);
  const updateFilters = (patch: Partial<ProposalFilters>) => {
    store.setState((current) => ({
      ...current,
      filters: { ...current.filters, ...patch },
      problem: "",
      request: null,
      selected: [],
    }));
  };
  const slots =
    availability.data?.candidates.filter((slot) =>
      state.selected.includes(slot.start)
    ) ?? [];
  const wording = formatMeetingProposal({
    introduction: state.introduction,
    slots,
    timeZone: filters.timeZone,
  });
  const findTimes = () => {
    try {
      const startMinute =
        Number(filters.hoursStart.slice(0, 2)) * 60 +
        Number(filters.hoursStart.slice(3, 5));
      const endMinute =
        Number(filters.hoursEnd.slice(0, 2)) * 60 +
        Number(filters.hoursEnd.slice(3, 5));
      const request = calendarAvailabilityInputSchema.safeParse({
        calendars: calendars
          .filter((calendar) =>
            filters.calendarKeys.includes(getCalendarRefKey(calendar))
          )
          .map(({ calendarId, connectionId }) => ({
            calendarId,
            connectionId,
          })),
        end: calendarWallTimeToInstant({
          date: addCalendarDays(filters.endDate, 1),
          time: "00:00",
          timeZone: filters.timeZone,
        }),
        limit: 20,
        preferences: {
          bufferAfterMinutes: Number(filters.bufferAfter),
          bufferBeforeMinutes: Number(filters.bufferBefore),
          durationMinutes: Number(filters.duration),
          stepMinutes: 15,
          workingHours: filters.weekdays.map((weekday) => ({
            endMinute,
            startMinute,
            weekday,
          })),
        },
        start: calendarWallTimeToInstant({
          date: filters.startDate,
          time: "00:00",
          timeZone: filters.timeZone,
        }),
        timeZone: filters.timeZone,
      });
      if (!request.success) {
        store.setState((current) => ({
          ...current,
          problem:
            request.error.issues[0]?.message ??
            "Review the selected calendars and times.",
        }));
        return;
      }
      store.setState((current) => ({
        ...current,
        problem: "",
        request: request.data,
        selected: [],
      }));
      if (JSON.stringify(state.request) === JSON.stringify(request.data)) {
        void availability.refetch();
      }
    } catch {
      store.setState((current) => ({
        ...current,
        problem:
          "A selected time is missing or occurs twice when the clocks change. Choose another time.",
      }));
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Propose meeting times</DialogTitle>
      </DialogHeader>
      <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
        <Text as="p" size="caption" tone="muted">
          Reply from {target.senderEmail} to {target.recipients.to}. Only your
          selected calendars are checked.
        </Text>
        <div className="space-y-2">
          <Text as="p" size="sm">
            Calendars to check
          </Text>
          {accounts.isPending ||
          calendarQueries.some((query) => query.isPending) ? (
            <Text size="caption" tone="muted">
              Loading calendars…
            </Text>
          ) : null}
          {calendars.map((calendar) => (
            <label
              className="flex min-w-0 items-center gap-2"
              key={getCalendarRefKey(calendar)}
            >
              <Checkbox
                aria-label={`Check ${calendar.name}`}
                checked={filters.calendarKeys.includes(
                  getCalendarRefKey(calendar)
                )}
                onCheckedChange={(checked) => {
                  updateFilters({
                    calendarKeys: checked
                      ? [...filters.calendarKeys, getCalendarRefKey(calendar)]
                      : filters.calendarKeys.filter(
                          (key) => key !== getCalendarRefKey(calendar)
                        ),
                  });
                }}
              >
                <CheckboxIndicator />
              </Checkbox>
              <Text size="sm" truncate>
                {calendar.name}
              </Text>
            </label>
          ))}
          {(accounts.data?.accounts ?? []).some(
            (account) => account.status !== "connected"
          ) ? (
            <Text as="p" size="caption" tone="muted">
              Some accounts need attention in Settings. Their calendars are not
              included.
            </Text>
          ) : null}
          {accounts.isError ||
          calendarQueries.some((query) => query.isError) ? (
            <Button
              onClick={() => {
                void accounts.refetch();
                for (const query of calendarQueries) {
                  void query.refetch();
                }
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              Retry calendar access
            </Button>
          ) : null}
          {!accounts.isPending && calendars.length === 0 ? (
            <Text as="p" size="caption" tone="muted">
              Connect a calendar in Settings to find times.
            </Text>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel size="caption">From date</FieldLabel>
            <DatePicker
              aria-label="First proposal date"
              onValueChange={(startDate) => {
                updateFilters({ startDate });
              }}
              value={filters.startDate}
            />
          </Field>
          <Field>
            <FieldLabel size="caption">Through date</FieldLabel>
            <DatePicker
              aria-label="Last proposal date"
              onValueChange={(endDate) => {
                updateFilters({ endDate });
              }}
              value={filters.endDate}
            />
          </Field>
          <Field>
            <FieldLabel size="caption">Working day starts</FieldLabel>
            <TimePicker
              aria-label="Working day starts"
              onValueChange={(hoursStart) => {
                updateFilters({ hoursStart });
              }}
              value={filters.hoursStart}
            />
          </Field>
          <Field>
            <FieldLabel size="caption">Working day ends</FieldLabel>
            <TimePicker
              aria-label="Working day ends"
              onValueChange={(hoursEnd) => {
                updateFilters({ hoursEnd });
              }}
              value={filters.hoursEnd}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Working weekdays">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
            (day, index) => (
              <Button
                aria-pressed={filters.weekdays.includes(index + 1)}
                key={day}
                onClick={() => {
                  updateFilters({
                    weekdays: filters.weekdays.includes(index + 1)
                      ? filters.weekdays.filter((value) => value !== index + 1)
                      : [...filters.weekdays, index + 1],
                  });
                }}
                size="sm"
                type="button"
                variant="option"
              >
                {day}
              </Button>
            )
          )}
        </div>
        <CalendarTimeZonePicker
          aria-label="Proposal time zone"
          onValueChange={(timeZone) => {
            updateFilters({ timeZone });
          }}
          value={filters.timeZone}
        />
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { field: "duration", label: "Minutes" },
              { field: "bufferBefore", label: "Gap before" },
              { field: "bufferAfter", label: "Gap after" },
            ] as const
          ).map(({ field, label }) => (
            <Field key={field}>
              <FieldLabel size="caption">{label}</FieldLabel>
              <Input
                aria-label={label}
                min={field === "duration" ? 5 : 0}
                onChange={(event) => {
                  updateFilters({ [field]: event.target.value });
                }}
                type="number"
                value={filters[field]}
              />
            </Field>
          ))}
        </div>
        <Button
          disabled={availability.isFetching}
          onClick={findTimes}
          type="button"
          variant="secondary"
        >
          {availability.isFetching
            ? "Checking calendars…"
            : "Find available times"}
        </Button>
        {state.problem ? (
          <Text as="p" role="alert" size="sm" tone="destructive">
            {state.problem}
          </Text>
        ) : null}
        {availability.isError ? (
          <Text as="p" role="alert" size="sm">
            Calendar access could not be checked. Retry after reviewing account
            access.
          </Text>
        ) : null}
        {availability.data ? (
          <div className="space-y-2">
            <Text as="p" size="caption" tone="muted">
              {availability.data.explanation}
            </Text>
            {availability.data.candidates.length === 0 &&
            availability.data.status === "complete" ? (
              <Text as="p" size="sm">
                No times fit these preferences. Adjust the dates or working
                hours.
              </Text>
            ) : null}
            {availability.data.candidates.map((slot) => (
              <label className="flex items-start gap-2" key={slot.start}>
                <Checkbox
                  aria-label={`Select ${new Date(slot.start).toLocaleString(undefined, { timeZone: filters.timeZone })}`}
                  checked={state.selected.includes(slot.start)}
                  onCheckedChange={(checked) => {
                    store.setState((current) => ({
                      ...current,
                      selected: checked
                        ? [...current.selected, slot.start]
                        : current.selected.filter(
                            (start) => start !== slot.start
                          ),
                    }));
                  }}
                >
                  <CheckboxIndicator />
                </Checkbox>
                <Text size="sm">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: filters.timeZone,
                  }).format(new Date(slot.start))}
                </Text>
              </label>
            ))}
          </div>
        ) : null}
        <Field>
          <FieldLabel size="caption">Introduction</FieldLabel>
          <Textarea
            aria-label="Proposal wording"
            onChange={(event) => {
              store.setState((current) => ({
                ...current,
                introduction: event.target.value,
              }));
            }}
            value={state.introduction}
          />
        </Field>
        {slots.length > 0 ? (
          <Text as="p" className="whitespace-pre-wrap" size="sm">
            {wording}
          </Text>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="secondary">
          Cancel
        </Button>
        <Button
          disabled={
            slots.length === 0 ||
            availability.isError ||
            availability.isFetching ||
            availability.data?.status !== "complete"
          }
          onClick={() => {
            if (!state.request || !onInsert({ target, text: wording })) {
              store.setState((current) => ({
                ...current,
                problem:
                  "This reply changed. Close this panel and open it from the current reply.",
              }));
              return;
            }
            rememberMeetingProposal({
              availability: state.request,
              calendars: calendars.filter((calendar) =>
                filters.calendarKeys.includes(getCalendarRefKey(calendar))
              ),
              id: crypto.randomUUID(),
              operationId: crypto.randomUUID(),
              slots,
              target,
              title,
              userId,
            });
            onClose();
          }}
          type="button"
        >
          Insert into reply
        </Button>
      </DialogFooter>
    </>
  );
};

export const ComposeMeetingProposal = ({
  disabled,
  onInsert,
  target,
  title,
  userId,
}: ProposalPickerProps) => {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconButtonTooltip label="Propose meeting times">
        <DialogTrigger
          aria-label="Propose meeting times"
          disabled={disabled}
          render={<ToolbarButton size="icon" type="button" />}
        >
          <Icon icon={Calendar03Icon} />
        </DialogTrigger>
      </IconButtonTooltip>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden">
        {open ? (
          <MeetingProposalEditor
            key={JSON.stringify(target)}
            onClose={() => {
              setOpen(false);
            }}
            onInsert={onInsert}
            target={target}
            title={title}
            userId={userId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
