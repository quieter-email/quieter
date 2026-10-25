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
import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarMutationResult,
  CalendarRef,
} from "@quieter/calendar";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  getCalendarEventKey,
  getCalendarRefKey,
} from "../domain/calendar-event-form";
import {
  calendarPreviewAccounts,
  calendarPreviewCalendars,
  createCalendarPreviewEvents,
} from "../domain/calendar-preview";

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
  const accounts = preview
    ? calendarPreviewAccounts
    : (accountsQuery.data?.accounts ?? []);
  const calendarQueries = useQueries({
    queries: preview
      ? []
      : accounts.map((account) => ({
          ...calendarCalendarsQueryOptions(userId, account.id),
          enabled: preview === null && account.status === "connected",
        })),
  });
  const calendars = preview
    ? calendarPreviewCalendars
    : calendarQueries.flatMap((query) => query.data?.calendars ?? []);
  const visibleCalendars = calendars.filter(
    (calendar) => !hiddenCalendarKeys.includes(getCalendarRefKey(calendar))
  );
  const requests = preview
    ? []
    : visibleCalendars.flatMap((calendar) =>
        getCalendarCacheMonthRanges(range).map((month) => ({ calendar, month }))
      );
  const eventQueries = useQueries({
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
  const events = preview
    ? (previewQuery.data ?? []).filter((event) =>
        visibleCalendars.some(
          (calendar) =>
            calendar.calendarId === event.calendarId &&
            calendar.connectionId === event.connectionId
        )
      )
    : [
        ...new Map(
          eventQueries
            .toSorted((left, right) => left.dataUpdatedAt - right.dataUpdatedAt)
            .flatMap((query) => query.data?.events ?? [])
            .map((event) => [getCalendarEventKey(event), event])
        ).values(),
      ];
  const failures = preview
    ? []
    : [
        ...(accountsQuery.isError
          ? [
              {
                key: "accounts",
                label: "Calendar accounts",
                retry: async () => await accountsQuery.refetch(),
              },
            ]
          : []),
        ...calendarQueries.flatMap((query, index) =>
          query.isError
            ? [
                {
                  key: `calendars-${accounts[index]?.id ?? index}`,
                  label: accounts[index]?.name ?? "Calendar list",
                  retry: async () => await query.refetch(),
                },
              ]
            : []
        ),
        ...eventQueries.flatMap((query, index) =>
          query.isError
            ? [
                {
                  key: `events-${requests[index]?.calendar.connectionId}-${requests[index]?.calendar.calendarId}-${requests[index]?.month.start}`,
                  label: `${requests[index]?.calendar.name ?? "Calendar events"}, ${requests[index]?.month.start.slice(0, 7) ?? ""}`,
                  retry: async () => await query.refetch(),
                },
              ]
            : []
        ),
      ];
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
        nextEvent = {
          ...input.draft,
          ...input.ref,
          attendees: input.draft.attendees.map((guest) => ({
            ...guest,
            organizer: false,
            response: "needs-action",
            self: false,
          })),
          eventId: `preview-${input.operationId}`,
          meetingPending: false,
          organizer: { email: "alex@example.com", name: "Alex", self: true },
          permissions: { delete: true, edit: true, respond: false },
          status: "confirmed",
          version: crypto.randomUUID(),
        };
      } else if (input.kind === "update") {
        nextEvent = {
          ...input.event,
          ...input.changes,
          attendees:
            input.changes.attendees?.map((guest) => ({
              ...guest,
              organizer: false,
              response:
                input.event.attendees.find(
                  (original) => original.email === guest.email
                )?.response ?? "needs-action",
              self: guest.email === "alex@example.com",
            })) ?? input.event.attendees,
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
    onError: (error) => {
      toastError(error, { boundary: "calendar" });
    },
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
  const refresh = async () => {
    if (!preview) {
      await queryClient.invalidateQueries({
        queryKey: getCalendarQueryKey(userId),
      });
    }
  };
  return {
    accounts,
    calendars,
    events,
    failures,
    isConfigured: preview !== null || accountsQuery.data?.isConfigured === true,
    isLoading:
      !preview &&
      (accountsQuery.isPending ||
        calendarQueries.some((query) => query.isLoading) ||
        eventQueries.some((query) => query.isLoading)),
    isRefreshing:
      !preview &&
      (accountsQuery.isFetching ||
        calendarQueries.some((query) => query.isFetching) ||
        eventQueries.some((query) => query.isFetching)),
    mutation,
    refresh,
    visibleCalendars,
  };
};
