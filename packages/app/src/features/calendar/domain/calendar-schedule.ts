import type {
  CalendarEvent,
  CalendarEventTime,
  CalendarSummary,
} from "@quieter/calendar";
import { getCalendarRecurrencePreview } from "@quieter/calendar/recurrence";
import { splitCalendarEventTime } from "@quieter/calendar/time";
import type { ScheduleItem } from "@quieter/ui/schedule";

import {
  getCalendarEventKey,
  getCalendarRefKey,
  parseCalendarEventFormTime,
} from "./calendar-event-form";
import type { CalendarEventForm } from "./calendar-event-form";

export const getCalendarSchedule = ({
  calendars,
  dates,
  draft,
  events,
  timeZone,
}: {
  calendars: CalendarSummary[];
  dates: string[];
  draft?: { form: CalendarEventForm; id: string };
  events: CalendarEvent[];
  timeZone: string;
}): { items: ScheduleItem[]; previewIssue?: string } => {
  let previewIssue: string | undefined;
  const records: (Pick<
    ScheduleItem,
    "color" | "detail" | "id" | "occurrenceId" | "preview" | "title" | "tone"
  > & { time: CalendarEventTime })[] = events.map((event) => {
    const calendar = calendars.find(
      (candidate) =>
        candidate.connectionId === event.connectionId &&
        candidate.calendarId === event.calendarId
    );
    return {
      color: event.colorOverride ?? calendar?.color ?? event.color,
      detail: event.location,
      id: getCalendarEventKey(event),
      time: event.time,
      title: event.title || "Untitled event",
      tone: event.status === "tentative" ? "warning" : "blue",
    };
  });
  if (draft) {
    let time: CalendarEventTime | undefined;
    try {
      time = parseCalendarEventFormTime(draft.form);
    } catch {
      time = undefined;
    }
    if (time) {
      const calendar = calendars.find(
        (candidate) => getCalendarRefKey(candidate) === draft.form.calendarKey
      );
      const preview = getCalendarRecurrencePreview({
        dates,
        recurrence: draft.form.recurrence,
        time,
        timeZone,
      });
      previewIssue = preview.issue;
      for (const occurrence of preview.times) {
        records.push({
          color: draft.form.color ?? calendar?.color,
          detail: draft.form.location,
          id: draft.id,
          occurrenceId: `${draft.id}:${occurrence.kind === "all-day" ? occurrence.startDate : occurrence.start}`,
          preview: true,
          time: occurrence,
          title: draft.form.title.trim() || "Untitled event",
          tone: "blue",
        });
      }
    }
  }
  const items = records.flatMap(({ time, ...record }) =>
    splitCalendarEventTime({ dates, time, timeZone }).map((segment) => ({
      ...record,
      ...segment,
    }))
  );
  return { items, previewIssue };
};
