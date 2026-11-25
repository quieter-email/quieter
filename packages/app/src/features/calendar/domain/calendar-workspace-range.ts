import type { CalendarView } from "@quieter/calendar";
import { getCalendarRange } from "@quieter/calendar/time";
import type { WeekStartsOn } from "@quieter/ui/date-time-preferences";

import { addCalendarDays } from "./calendar-event-form";

export const getCalendarWorkspaceRange = ({
  date,
  timeZone,
  view,
  weekStartsOn,
}: {
  date: string;
  timeZone: string;
  view: CalendarView;
  weekStartsOn?: WeekStartsOn;
}) => {
  const visible = getCalendarRange({ date, timeZone, view, weekStartsOn });
  if (view !== "month") {
    return visible;
  }
  const first = addCalendarDays(visible.dates[0] ?? date, -28);
  const dates = Array.from({ length: visible.dates.length + 56 }, (_, index) =>
    addCalendarDays(first, index)
  );
  return {
    dates,
    end: getCalendarRange({
      date: addCalendarDays(first, dates.length),
      timeZone,
      view: "day",
    }).start,
    start: getCalendarRange({ date: first, timeZone, view: "day" }).start,
  };
};
