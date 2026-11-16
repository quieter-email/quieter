"use client";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import type { CalendarAvailabilityInput } from "@quieter/calendar/availability";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
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
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { ToolbarButton } from "@quieter/ui/toolbar";
import { useQuery } from "@tanstack/react-query";
import { createStore, useSelector } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import {
  createCalendarAvailabilityForm,
  parseCalendarAvailabilityForm,
} from "../domain/calendar-availability-form";
import type { CalendarAvailabilityForm } from "../domain/calendar-availability-form";
import { getCalendarRefKey } from "../domain/calendar-event-form";
import {
  activateMeetingProposals,
  formatMeetingProposal,
  rememberMeetingProposal,
} from "../domain/meeting-proposals";
import type {
  MeetingProposalInsertion,
  MeetingReplyTarget,
} from "../domain/meeting-proposals";
import { CalendarAvailabilityFields } from "./calendar-availability-fields";
import { useCalendarAvailabilityCalendars } from "./use-calendar-availability-calendars";

type ProposalPickerProps = {
  disabled: boolean;
  onInsert: (input: MeetingProposalInsertion) => boolean;
  target: MeetingReplyTarget;
  title: string;
  userId: string;
};

type ProposalEditorState = {
  filters: CalendarAvailabilityForm;
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
  const [store] = useState(() =>
    createStore<ProposalEditorState>({
      filters: createCalendarAvailabilityForm(),
      introduction: "Would any of these times work for you?",
      problem: "",
      request: null,
      selected: [],
    })
  );
  const state = useSelector(store, (current) => current);
  const { filters } = state;
  const source = useCalendarAvailabilityCalendars(userId);
  const { calendars } = source;
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
  const updateFilters = (patch: Partial<CalendarAvailabilityForm>) => {
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
    const request = parseCalendarAvailabilityForm({ calendars, form: filters });
    if (request.kind === "invalid") {
      store.setState((current) => ({
        ...current,
        problem: request.message,
      }));
      return;
    }
    store.setState((current) => ({
      ...current,
      problem: "",
      request: request.value,
      selected: [],
    }));
    if (JSON.stringify(state.request) === JSON.stringify(request.value)) {
      void availability.refetch();
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
        <CalendarAvailabilityFields
          onChange={updateFilters}
          source={source}
          value={filters}
        />
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
            const scope = parseCalendarAvailabilityForm({
              calendars,
              form: filters,
            });
            if (scope.kind === "invalid") {
              store.setState((current) => ({
                ...current,
                problem: scope.message,
              }));
              return;
            }
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
