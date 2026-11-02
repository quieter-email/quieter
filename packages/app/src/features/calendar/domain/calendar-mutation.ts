import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarRef,
} from "@quieter/calendar";

import { getCalendarEventKey } from "./calendar-event-form";

export type CalendarMutation =
  | {
      kind: "create";
      ref: CalendarRef;
      draft: CalendarEventDraft;
      operationId: string;
    }
  | { kind: "update"; event: CalendarEvent; changes: CalendarEventPatch }
  | { kind: "delete"; event: CalendarEvent }
  | {
      kind: "respond";
      event: CalendarEvent;
      response: "accepted" | "tentative" | "declined";
    };

export const createCalendarEventDisplay = ({
  isPending,
  variables,
}: {
  isPending: boolean;
  variables: CalendarMutation | undefined;
}) => {
  const update =
    isPending &&
    variables?.kind === "update" &&
    variables.changes.time &&
    Object.keys(variables.changes).every((field) => field === "time")
      ? {
          key: getCalendarEventKey(variables.event),
          time: variables.changes.time,
        }
      : null;

  return (event: CalendarEvent): CalendarEvent => {
    if (!update || getCalendarEventKey(event) !== update.key) {
      return event;
    }
    return { ...event, time: update.time };
  };
};
