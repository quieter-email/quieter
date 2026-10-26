"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { CalendarEvent } from "@quieter/calendar";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Pill } from "@quieter/ui/pill";
import { Text } from "@quieter/ui/text";

import { addCalendarDays } from "../domain/calendar-event-form";

const responseLabels = {
  accepted: "Going",
  declined: "Declined",
  "needs-action": "Awaiting response",
  tentative: "Maybe",
};
const responseDescriptions = {
  accepted: "You are going.",
  declined: "You declined this invitation.",
  "needs-action": "You have not responded yet.",
  tentative: "You might attend.",
};

export const CalendarEventDetails = ({
  calendarName,
  event,
  onClose,
  onDelete,
  onRespond,
  pending,
  timeZone,
}: {
  calendarName: string;
  event: CalendarEvent;
  onClose: () => void;
  onDelete: () => void;
  onRespond: (response: "accepted" | "tentative" | "declined") => void;
  pending: boolean;
  timeZone: string;
}) => {
  const self = event.attendees.find((attendee) => attendee.self);
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    timeZone,
    weekday: "long",
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Text as="h2" className="flex-1" size="sm" truncate weight="medium">
          Event details
        </Text>
        <IconButtonTooltip label="Close event details">
          <Button
            aria-label="Close event details"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <Icon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <div className="space-y-2">
          <Pill size="xs" tone="neutral">
            {calendarName}
          </Pill>
          <Text as="h3" size="lg" truncate weight="medium">
            {event.title || "Untitled event"}
          </Text>
          {event.permissions.edit ? null : (
            <p className="text-caption text-muted-fg">
              This event is read only.
            </p>
          )}
        </div>
        <div className="space-y-1 text-body-sm">
          {event.time.kind === "timed" ? (
            <>
              <p>{dateFormatter.format(new Date(event.time.start))}</p>
              <p>
                {timeFormatter.format(new Date(event.time.start))} to{" "}
                {timeFormatter.format(new Date(event.time.end))}
              </p>
              {dateFormatter.format(new Date(event.time.start)) ===
              dateFormatter.format(new Date(event.time.end)) ? null : (
                <p>Ends {dateFormatter.format(new Date(event.time.end))}</p>
              )}
              <p className="text-caption text-muted-fg">
                {timeZone.replaceAll("_", " ")}
              </p>
            </>
          ) : (
            <>
              <p>
                {new Intl.DateTimeFormat(undefined, {
                  day: "numeric",
                  month: "long",
                  timeZone: "UTC",
                  weekday: "long",
                }).format(new Date(`${event.time.startDate}T12:00:00Z`))}
              </p>
              {event.time.endDate ===
              addCalendarDays(event.time.startDate, 1) ? null : (
                <p>Through {addCalendarDays(event.time.endDate, -1)}</p>
              )}
              <p className="text-caption text-muted-fg">All day</p>
            </>
          )}
          {event.recurringEventId || event.recurrence.length > 0 ? (
            <Pill size="xs" tone="neutral">
              Repeating event
            </Pill>
          ) : null}
        </div>
        {event.meetingUrl ? (
          <Button
            fullWidth
            nativeButton={false}
            render={
              <a
                aria-label="Join video meeting"
                href={event.meetingUrl}
                rel="noreferrer"
                target="_blank"
              />
            }
          >
            Join video meeting
          </Button>
        ) : null}
        {!event.meetingUrl && event.meetingPending ? (
          <p className="text-body-sm text-muted-fg">
            Your meeting link is being prepared. Refresh in a moment.
          </p>
        ) : null}
        {event.location ? (
          <div className="space-y-1">
            <h4 className="text-caption text-muted-fg">Location</h4>
            <p className="text-body-sm wrap-break-word">{event.location}</p>
          </div>
        ) : null}
        {event.permissions.respond && self ? (
          <div className="space-y-2">
            <h4 className="text-caption text-muted-fg">Your response</h4>
            <ActionFooter>
              <Button
                aria-pressed={self.response === "declined"}
                disabled={pending}
                onClick={() => {
                  onRespond("declined");
                }}
                size="sm"
                variant="secondary"
              >
                No
              </Button>
              <Button
                aria-pressed={self.response === "tentative"}
                disabled={pending}
                onClick={() => {
                  onRespond("tentative");
                }}
                size="sm"
                variant="secondary"
              >
                Maybe
              </Button>
              <Button
                aria-pressed={self.response === "accepted"}
                disabled={pending}
                onClick={() => {
                  onRespond("accepted");
                }}
                size="sm"
              >
                Yes
              </Button>
            </ActionFooter>
            <p className="text-caption text-muted-fg">
              {responseDescriptions[self.response]}
            </p>
          </div>
        ) : null}
        {event.attendees.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-caption text-muted-fg">Guests</h4>
            <ul className="space-y-2">
              {event.attendees.map((guest) => (
                <li className="min-w-0 text-body-sm" key={guest.email}>
                  <p className="truncate" title={guest.email}>
                    {guest.name ?? guest.email}
                    {guest.self ? " (you)" : ""}
                  </p>
                  <p className="text-caption text-muted-fg">
                    {guest.organizer ? "Organizer, " : ""}
                    {responseLabels[guest.response]}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {event.description ? (
          <div className="space-y-1">
            <h4 className="text-caption text-muted-fg">Description</h4>
            <p className="text-body-sm wrap-break-word whitespace-pre-wrap">
              {event.description}
            </p>
          </div>
        ) : null}
        <div className="space-y-2 text-caption text-muted-fg">
          <p>
            {event.availability === "busy" ? "Busy" : "Free"},{" "}
            {event.visibility === "default"
              ? "calendar visibility"
              : `${event.visibility} event`}
          </p>
          {event.reminders.kind === "default" ? (
            <p>Calendar default reminders</p>
          ) : null}
          {event.reminders.kind === "custom" &&
          event.reminders.items.length === 0 ? (
            <p>No reminders</p>
          ) : null}
          {event.reminders.kind === "custom"
            ? event.reminders.items.map((reminder) => (
                <p key={`${reminder.method}-${reminder.minutesBefore}`}>
                  {reminder.method === "email" ? "Email" : "Notification"},{" "}
                  {reminder.minutesBefore === 0
                    ? "when the event starts"
                    : `${reminder.minutesBefore} minutes before`}
                </p>
              ))
            : null}
        </div>
      </div>
      {event.permissions.delete ? (
        <div className="border-t border-border p-4">
          <ActionFooter>
            {event.permissions.delete ? (
              <Button
                disabled={pending}
                onClick={onDelete}
                variant="destructive"
              >
                Delete
              </Button>
            ) : null}
          </ActionFooter>
        </div>
      ) : null}
    </div>
  );
};
