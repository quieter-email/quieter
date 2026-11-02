import { rpc } from "@quieter/app/lib/orpc";
import { queryPersister } from "@quieter/app/lib/query-persister";
import type { CalendarEventRef, CalendarRef } from "@quieter/calendar";
import {
  getCalendarRange,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";
import { queryOptions } from "@tanstack/react-query";

export type CalendarEventsRange = {
  end: string;
  query?: string;
  start: string;
  timeZone: string;
};

export const getCalendarCacheMonthRanges = (
  range: CalendarEventsRange
): CalendarEventsRange[] => {
  const first = getZonedDateTimeFields({
    instant: range.start,
    timeZone: range.timeZone,
  }).date;
  const last = getZonedDateTimeFields({
    instant: new Date(Date.parse(range.end) - 1).toISOString(),
    timeZone: range.timeZone,
  }).date;
  const current = new Date(`${first.slice(0, 7)}-01T12:00:00Z`);
  const months: CalendarEventsRange[] = [];
  while (current.toISOString().slice(0, 7) <= last.slice(0, 7)) {
    const startDate = current.toISOString().slice(0, 10);
    current.setUTCMonth(current.getUTCMonth() + 1);
    const endDate = current.toISOString().slice(0, 10);
    months.push({
      end: getCalendarRange({
        date: endDate,
        timeZone: range.timeZone,
        view: "day",
      }).start,
      query: range.query,
      start: getCalendarRange({
        date: startDate,
        timeZone: range.timeZone,
        view: "day",
      }).start,
      timeZone: range.timeZone,
    });
  }
  return months;
};

export const getCalendarQueryKey = (userId: string) =>
  ["calendar", userId] as const;

export const getCalendarConnectionQueryKey = (
  userId: string,
  connectionId: string
) => ["calendar", userId, "connection", connectionId] as const;

export const getCalendarEventQueryKey = (
  userId: string,
  ref: CalendarEventRef
) =>
  [
    ...getCalendarConnectionQueryKey(userId, ref.connectionId),
    "calendar",
    ref.calendarId,
    "event",
    ref.eventId,
  ] as const;

const calendarCacheOptions = {
  gcTime: 7 * 24 * 60 * 60 * 1000,
  persister: queryPersister.persisterFn,
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
};

export const calendarAccountsQueryOptions = (userId: string) =>
  queryOptions<Awaited<ReturnType<typeof rpc.calendar.accounts>>>({
    ...calendarCacheOptions,
    queryFn: async ({ signal }) =>
      await rpc.calendar.accounts(undefined, { signal }),
    queryKey: [...getCalendarQueryKey(userId), "accounts"],
    staleTime: 5 * 60 * 1000,
  });

export const calendarCalendarsQueryOptions = (
  userId: string,
  connectionId: string
) =>
  queryOptions<Awaited<ReturnType<typeof rpc.calendar.calendars>>>({
    ...calendarCacheOptions,
    queryFn: async ({ signal }) =>
      await rpc.calendar.calendars({ connectionId }, { signal }),
    queryKey: [
      ...getCalendarConnectionQueryKey(userId, connectionId),
      "calendars",
    ],
    staleTime: 5 * 60 * 1000,
  });

export const calendarEventsQueryOptions = (
  userId: string,
  ref: CalendarRef,
  range: CalendarEventsRange
) =>
  queryOptions<Awaited<ReturnType<typeof rpc.calendar.events>>>({
    ...calendarCacheOptions,
    queryFn: async ({ signal }) =>
      await rpc.calendar.events(
        {
          calendarId: ref.calendarId,
          connectionId: ref.connectionId,
          end: range.end,
          query: range.query,
          start: range.start,
          timeZone: range.timeZone,
        },
        { signal }
      ),
    queryKey: [
      ...getCalendarConnectionQueryKey(userId, ref.connectionId),
      "calendar",
      ref.calendarId,
      "events",
      range,
    ],
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: false,
    staleTime: 60 * 1000,
  });

export const calendarEventQueryOptions = (
  userId: string,
  ref: CalendarEventRef
) =>
  queryOptions<Awaited<ReturnType<typeof rpc.calendar.event>>>({
    ...calendarCacheOptions,
    queryFn: async ({ signal }) =>
      await rpc.calendar.event(
        {
          calendarId: ref.calendarId,
          connectionId: ref.connectionId,
          eventId: ref.eventId,
        },
        { signal }
      ),
    queryKey: getCalendarEventQueryKey(userId, ref),
    staleTime: 60 * 1000,
  });
