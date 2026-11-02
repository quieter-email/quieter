import { applyCalendarMutationReceipt } from "@quieter/app/lib/calendar-cache-lifecycle";
import {
  calendarAccountsQueryOptions,
  calendarCalendarsQueryOptions,
  calendarEventsQueryOptions,
  getCalendarCacheMonthRanges,
  getCalendarQueryKey,
} from "@quieter/app/lib/calendar-query";
import type { CalendarEventsRange } from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { persistQueryByKey } from "@quieter/app/lib/query-persister";
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarMutationResult,
  CalendarSummary,
} from "@quieter/calendar";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import {
  getCalendarEventKey,
  getCalendarRefKey,
} from "../domain/calendar-event-form";
import { getCalendarGroups } from "../domain/calendar-groups";
import { createCalendarEventDisplay } from "../domain/calendar-mutation";
import type { CalendarMutation } from "../domain/calendar-mutation";
import {
  calendarPreviewAccounts,
  calendarPreviewCalendars,
  createCalendarPreviewEvents,
} from "../domain/calendar-preview";

const combineCalendarQueries = (
  queries: UseQueryResult<Awaited<ReturnType<typeof rpc.calendar.calendars>>>[]
) => ({
  calendars: queries.flatMap((query) => query.data?.calendars ?? []),
  queries,
});

const combineEventQueries = (
  queries: UseQueryResult<Awaited<ReturnType<typeof rpc.calendar.events>>>[]
) => ({
  events: [
    ...new Map(
      queries
        .toSorted((left, right) => left.dataUpdatedAt - right.dataUpdatedAt)
        .flatMap((query) => query.data?.events ?? [])
        .map((event) => [getCalendarEventKey(event), event])
    ).values(),
  ],
  queries,
});

export const useCalendarData = ({
  date,
  hiddenCalendarKeys,
  preview,
  range,
  userId,
}: {
  date: string;
  hiddenCalendarKeys: string[];
  preview: string | null;
  range: CalendarEventsRange;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const accountsOptions = calendarAccountsQueryOptions(userId);
  const accountsQuery = useQuery({
    ...accountsOptions,
    enabled: preview === null,
    persister: preview ? undefined : accountsOptions.persister,
    queryKey: preview
      ? ["calendar-preview", userId, preview, "accounts"]
      : accountsOptions.queryKey,
  });
  const accounts = useMemo<CalendarAccount[]>(
    () =>
      preview ? calendarPreviewAccounts : (accountsQuery.data?.accounts ?? []),
    [accountsQuery.data?.accounts, preview]
  );
  const calendarResults = useQueries({
    combine: combineCalendarQueries,
    queries: preview
      ? []
      : accounts.map((account) => ({
          ...calendarCalendarsQueryOptions(userId, account.id),
          enabled: preview === null && account.status === "connected",
        })),
  });
  const calendarQueries = calendarResults.queries;
  const previewCalendarsKey = [
    "calendar-preview",
    userId,
    preview ?? "disabled",
    "calendars",
  ] as const;
  const previewCalendarsQuery = useQuery({
    enabled: false,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    initialData: preview ? calendarPreviewCalendars : undefined,
    queryFn: () => calendarPreviewCalendars,
    queryKey: previewCalendarsKey,
    staleTime: Infinity,
  });
  const calendarGroups = useMemo(
    () =>
      getCalendarGroups({
        accounts,
        calendars: preview
          ? (previewCalendarsQuery.data ?? [])
          : calendarResults.calendars,
      }),
    [accounts, calendarResults.calendars, preview, previewCalendarsQuery.data]
  );
  const calendars = useMemo(
    () => calendarGroups.map((group) => group.calendar),
    [calendarGroups]
  );
  const visibleCalendars = useMemo(
    () =>
      calendarGroups
        .filter((group) =>
          group.keys.some((key) => !hiddenCalendarKeys.includes(key))
        )
        .map((group) => group.calendar),
    [calendarGroups, hiddenCalendarKeys]
  );
  const monthRanges = useMemo(
    () =>
      getCalendarCacheMonthRanges({
        end: range.end,
        query: range.query,
        start: range.start,
        timeZone: range.timeZone,
      }),
    [range.end, range.query, range.start, range.timeZone]
  );
  const requests = useMemo(
    () =>
      preview
        ? []
        : visibleCalendars.flatMap((calendar) =>
            monthRanges.map((month) => ({ calendar, month }))
          ),
    [monthRanges, preview, visibleCalendars]
  );
  const eventResults = useQueries({
    combine: combineEventQueries,
    queries: requests.map(({ calendar, month }) => ({
      ...calendarEventsQueryOptions(userId, calendar, month),
      enabled:
        preview === null &&
        accounts.some(
          (account) =>
            account.id === calendar.connectionId &&
            account.status === "connected"
        ),
    })),
  });
  const eventQueries = eventResults.queries;
  const previewKey = [
    "calendar-preview",
    userId,
    preview ?? "disabled",
    "events",
  ] as const;
  const previewQuery = useQuery({
    enabled: false,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    initialData: preview
      ? () => createCalendarPreviewEvents({ date, timeZone: range.timeZone })
      : undefined,
    queryFn: () =>
      createCalendarPreviewEvents({ date, timeZone: range.timeZone }),
    queryKey: previewKey,
    staleTime: Infinity,
  });
  const confirmedEvents = useMemo(
    () =>
      preview
        ? (previewQuery.data ?? []).filter((event) =>
            visibleCalendars.some(
              (calendar) =>
                calendar.calendarId === event.calendarId &&
                calendar.connectionId === event.connectionId
            )
          )
        : eventResults.events,
    [eventResults.events, preview, previewQuery.data, visibleCalendars]
  );
  const scopedQueries = [
    ...calendarQueries.map((query, index) => ({
      connectionId: accounts[index]?.id,
      query,
    })),
    ...eventQueries.map((query, index) => ({
      connectionId: requests[index]?.calendar.connectionId,
      query,
    })),
  ];
  const authorizationFailures = JSON.stringify([
    ...new Set(
      scopedQueries.flatMap(({ connectionId, query }) =>
        query.isError &&
        "status" in query.error &&
        (query.error.status === 401 || query.error.status === 403)
          ? [connectionId]
          : []
      )
    ),
  ]);
  const refreshedAuthorizationFailures = useRef(new Set<string>());
  useEffect(() => {
    if (
      authorizationFailures !== "[]" &&
      !refreshedAuthorizationFailures.current.has(authorizationFailures)
    ) {
      refreshedAuthorizationFailures.current.add(authorizationFailures);
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: [...getCalendarQueryKey(userId), "accounts"],
      });
    }
  }, [authorizationFailures, queryClient, userId]);
  const failures = preview
    ? []
    : [
        ...(accountsQuery.isError ? [accountsQuery] : []),
        ...scopedQueries.flatMap(({ connectionId, query }) =>
          query.isError &&
          !("status" in query.error && query.error.status === 401) &&
          accounts.some(
            (account) =>
              account.id === connectionId && account.status === "connected"
          )
            ? [query]
            : []
        ),
      ];
  const onMutationError = async (error: Error) => {
    toastError(error, { boundary: "calendar" });
    if ("status" in error && error.status === 401) {
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: accountsOptions.queryKey,
      });
    }
  };
  const mutation = useMutation({
    mutationFn: async (
      input: CalendarMutation
    ): Promise<CalendarMutationResult> => {
      if (!preview) {
        if (input.kind === "create") {
          return await rpc.calendar.create({
            ...input.ref,
            event: input.draft,
            operationId: input.operationId,
          });
        }
        const ref = {
          calendarId: input.event.calendarId,
          connectionId: input.event.connectionId,
          eventId: input.event.eventId,
          version: input.event.version,
        };
        if (input.kind === "update") {
          return await rpc.calendar.update({ ...ref, changes: input.changes });
        }
        if (input.kind === "delete") {
          return await rpc.calendar.delete(ref);
        }
        return await rpc.calendar.respond({ ...ref, response: input.response });
      }
      let nextEvent: CalendarEvent;
      if (input.kind === "create") {
        const calendar = calendars.find(
          (candidate) =>
            getCalendarRefKey(candidate) === getCalendarRefKey(input.ref)
        );
        nextEvent = {
          ...input.draft,
          ...input.ref,
          attendees: input.draft.attendees.map((guest) => ({
            ...guest,
            organizer: false,
            response: "needs-action",
            self: false,
          })),
          color: input.draft.color ?? calendar?.color,
          colorOverride: input.draft.color ?? undefined,
          eventId: `preview-${input.operationId}`,
          meetingPending: false,
          organizer: { email: "alex@example.com", name: "Alex", self: true },
          permissions: { delete: true, edit: true, respond: false },
          status: "confirmed",
          version: crypto.randomUUID(),
        };
      } else if (input.kind === "update") {
        const calendar = calendars.find(
          (candidate) =>
            getCalendarRefKey(candidate) === getCalendarRefKey(input.event)
        );
        nextEvent = {
          ...input.event,
          ...input.changes,
          attendees:
            input.changes.attendees?.map((guest) => {
              const existing = input.event.attendees.find(
                (original) =>
                  original.email.toLowerCase() === guest.email.toLowerCase()
              );
              return {
                ...guest,
                organizer: existing?.organizer ?? false,
                response: existing?.response ?? "needs-action",
                self:
                  existing?.self ??
                  guest.email.toLowerCase() === "alex@example.com",
              };
            }) ?? input.event.attendees,
          color:
            input.changes.color === undefined
              ? input.event.color
              : (input.changes.color ?? calendar?.color),
          colorOverride:
            input.changes.color === undefined
              ? input.event.colorOverride
              : (input.changes.color ?? undefined),
          version: crypto.randomUUID(),
        };
      } else if (input.kind === "respond") {
        nextEvent = {
          ...input.event,
          attendees: input.event.attendees.map((guest) =>
            guest.self ? { ...guest, response: input.response } : guest
          ),
          version: crypto.randomUUID(),
        };
      } else {
        nextEvent = input.event;
      }
      queryClient.setQueryData<CalendarEvent[]>(previewKey, (current = []) => [
        ...current.filter(
          (event) =>
            event.calendarId !== nextEvent.calendarId ||
            event.eventId !== nextEvent.eventId
        ),
        ...(input.kind === "delete" ? [] : [nextEvent]),
      ]);
      return {
        action: (
          {
            create: "created",
            delete: "deleted",
            respond: "responded",
            update: "updated",
          } satisfies Record<
            CalendarMutation["kind"],
            CalendarMutationResult["action"]
          >
        )[input.kind],
        calendarId: nextEvent.calendarId,
        connectionId: nextEvent.connectionId,
        event: input.kind === "delete" ? undefined : nextEvent,
        eventId: nextEvent.eventId,
        status: "success",
      };
    },
    onError: onMutationError,
    onMutate: async () => {
      if (!preview) {
        await queryClient.cancelQueries({
          queryKey: getCalendarQueryKey(userId),
        });
      }
    },
    onSuccess: async (result) => {
      if (preview) {
        return;
      }
      await applyCalendarMutationReceipt(queryClient, userId, result);
    },
  });
  const colorMutation = useMutation({
    mutationFn: async ({
      calendar,
      color,
    }: {
      calendar: CalendarSummary;
      color: string;
    }): Promise<CalendarSummary> => {
      if (preview) {
        return { ...calendar, color };
      }
      return await rpc.calendar.updateColor({
        calendarId: calendar.calendarId,
        color,
        connectionId: calendar.connectionId,
      });
    },
    onError: onMutationError,
    onSuccess: async (calendar) => {
      if (preview) {
        queryClient.setQueryData<CalendarSummary[]>(
          previewCalendarsKey,
          (current = []) =>
            current.map((candidate) =>
              getCalendarRefKey(candidate) === getCalendarRefKey(calendar)
                ? calendar
                : candidate
            )
        );
        return;
      }
      const calendarsKey = calendarCalendarsQueryOptions(
        userId,
        calendar.connectionId
      ).queryKey;
      await queryClient.cancelQueries({ exact: true, queryKey: calendarsKey });
      queryClient.setQueryData(calendarsKey, (current) =>
        current
          ? {
              ...current,
              calendars: current.calendars.map((candidate) =>
                getCalendarRefKey(candidate) === getCalendarRefKey(calendar)
                  ? calendar
                  : candidate
              ),
            }
          : current
      );
      await persistQueryByKey(calendarsKey, queryClient);
      await queryClient.invalidateQueries({
        queryKey: [
          ...calendarsKey.slice(0, 4),
          "calendar",
          calendar.calendarId,
        ],
      });
    },
  });
  const displayEvent = useMemo(
    () =>
      createCalendarEventDisplay({
        isPending: mutation.isPending,
        variables: mutation.variables,
      }),
    [mutation.isPending, mutation.variables]
  );
  const events = useMemo(() => {
    const displayed = confirmedEvents.map(displayEvent);
    return displayed.some((event, index) => event !== confirmedEvents[index])
      ? displayed
      : confirmedEvents;
  }, [confirmedEvents, displayEvent]);
  const refresh = async () => {
    if (!preview) {
      await queryClient.invalidateQueries({
        queryKey: getCalendarQueryKey(userId),
      });
    }
  };
  return {
    accounts,
    calendarGroups,
    calendars,
    colorMutation,
    confirmedEvents,
    displayEvent,
    events,
    failures,
    hiddenCalendarKeys: calendarGroups
      .filter((group) =>
        group.keys.every((key) => hiddenCalendarKeys.includes(key))
      )
      .map((group) => getCalendarRefKey(group.calendar)),
    isConfigured: preview !== null || accountsQuery.data?.isConfigured === true,
    isLoading:
      !preview &&
      (accountsQuery.isLoading ||
        (calendars.length === 0 &&
          calendarQueries.some((query) => query.isLoading)) ||
        (eventQueries.every((query) => query.data === undefined) &&
          eventQueries.some((query) => query.isLoading))),
    isRefreshing:
      !preview &&
      (accountsQuery.isFetching ||
        calendarQueries.some((query) => query.isFetching) ||
        eventQueries.some((query) => query.isFetching)),
    mutation,
    refresh,
    retryFailures: async () => {
      await Promise.allSettled(
        failures.map(async (query) => await query.refetch())
      );
    },
    retryingFailures: failures.some((query) => query.isFetching),
    visibleCalendars,
  };
};
