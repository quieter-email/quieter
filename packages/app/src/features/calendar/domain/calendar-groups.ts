import type {
  CalendarAccount,
  CalendarEventRef,
  CalendarSummary,
} from "@quieter/calendar";

import { getCalendarRefKey } from "./calendar-event-form";

export type CalendarGroup = {
  calendar: CalendarSummary;
  keys: string[];
};

export const getCalendarGroups = ({
  accounts,
  calendars,
}: {
  accounts: CalendarAccount[];
  calendars: CalendarSummary[];
}): CalendarGroup[] => {
  const accountStatuses = new Map(
    accounts.map((account) => [account.id, account.status])
  );
  const groups = new Map<string, CalendarSummary[]>();
  for (const calendar of calendars) {
    if (!accountStatuses.has(calendar.connectionId)) {
      continue;
    }
    const key =
      calendar.access === "read" && !calendar.primary
        ? JSON.stringify(["shared", calendar.calendarId])
        : JSON.stringify(["account", getCalendarRefKey(calendar)]);
    const group = groups.get(key);
    if (group) {
      group.push(calendar);
    } else {
      groups.set(key, [calendar]);
    }
  }
  return [...groups.values()].map((members) => {
    const sorted = members.toSorted((left, right) => {
      const availability =
        Number(accountStatuses.get(right.connectionId) === "connected") -
        Number(accountStatuses.get(left.connectionId) === "connected");
      return (
        availability || left.connectionId.localeCompare(right.connectionId)
      );
    });
    const [calendar] = sorted;
    return { calendar, keys: sorted.map(getCalendarRefKey) };
  });
};

export const toggleCalendarGroupVisibility = ({
  calendar,
  groups,
  hiddenCalendarKeys,
}: {
  calendar: CalendarSummary;
  groups: CalendarGroup[];
  hiddenCalendarKeys: string[];
}): string[] => {
  const key = getCalendarRefKey(calendar);
  const keys = groups.find((group) => group.keys.includes(key))?.keys ?? [key];
  const hidden = new Set(hiddenCalendarKeys);
  const isVisible = keys.some((member) => !hidden.has(member));
  for (const member of keys) {
    if (isVisible) {
      hidden.add(member);
    } else {
      hidden.delete(member);
    }
  }
  return [...hidden];
};

export const getVisibleCalendarEventRef = ({
  groups,
  hiddenCalendarKeys,
  ref,
}: {
  groups: CalendarGroup[];
  hiddenCalendarKeys: string[];
  ref: CalendarEventRef;
}): CalendarEventRef | undefined => {
  const key = getCalendarRefKey(ref);
  const group = groups.find((candidate) => candidate.keys.includes(key));
  if (
    !group ||
    group.keys.every((member) => hiddenCalendarKeys.includes(member))
  ) {
    return undefined;
  }
  return {
    calendarId: group.calendar.calendarId,
    connectionId: group.calendar.connectionId,
    eventId: ref.eventId,
  };
};
