import type { MailboxRouteState } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import {
  canPrefetchInBackground,
  hasForegroundWorkspaceFetches,
} from "@quieter/app/lib/background-prefetch";
import {
  calendarAccountsQueryOptions,
  calendarCalendarsQueryOptions,
  calendarEventsQueryOptions,
  getAdjacentCalendarMonthRanges,
  getCalendarCacheMonthRanges,
} from "@quieter/app/lib/calendar-query";
import type { CalendarEventsRange } from "@quieter/app/lib/calendar-query";
import { orpc } from "@quieter/app/lib/orpc";
import type { CalendarRef } from "@quieter/calendar";
import { getZonedDateTimeFields } from "@quieter/calendar/time";
import { CancelledError } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getCalendarRefKey } from "./calendar-event-form";
import { getCalendarGroups, getVisibleCalendars } from "./calendar-groups";
import {
  getCalendarPreferencesKey,
  readCalendarPreferences,
} from "./calendar-preferences";
import { getCalendarWorkspaceRange } from "./calendar-workspace-range";

const BACKGROUND_CONCURRENCY = 3;
const BACKGROUND_EVENT_REQUEST_LIMIT = 48;
const PREDICTED_STALE_TIME = 5 * 60 * 1000;

type PrefetchScope = {
  queryClient: QueryClient;
  signal: AbortSignal;
  userId: string;
};

type PrefetchTask = {
  load: () => Promise<unknown>;
  ref: { calendarId?: string; connectionId: string };
};

const waitForForeground = async ({ queryClient, signal }: PrefetchScope) => {
  if (signal.aborted || !hasForegroundWorkspaceFetches(queryClient)) {
    return;
  }
  const settled = Promise.withResolvers<null>();
  const settle = () => {
    settled.resolve(null);
  };
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (!hasForegroundWorkspaceFetches(queryClient)) {
      settle();
    }
  });
  signal.addEventListener("abort", settle);
  await settled.promise;
  unsubscribe();
  signal.removeEventListener("abort", settle);
};

// A restore resolves with cached data and applies its real age one macrotask later.
// Without an observer nothing revalidates it, so load again once the age is known.
const loadFresh = async <Data>(
  load: () => Promise<Data>,
  signal: AbortSignal
): Promise<Data> => {
  const data = await load();
  const restored = Promise.withResolvers<null>();
  setTimeout(() => {
    restored.resolve(null);
  }, 0);
  await restored.promise;
  return signal.aborted || !canPrefetchInBackground() ? data : await load();
};

const runPrefetchTasks = async (
  scope: PrefetchScope,
  tasks: PrefetchTask[]
) => {
  const blocked = new Set<string>();
  const queue = tasks.values();
  const work = async () => {
    for (const { load, ref } of queue) {
      await waitForForeground(scope);
      if (scope.signal.aborted || !canPrefetchInBackground()) {
        return;
      }
      const calendarKey = JSON.stringify([ref.connectionId, ref.calendarId]);
      if (blocked.has(ref.connectionId) || blocked.has(calendarKey)) {
        continue;
      }
      try {
        await loadFresh(load, scope.signal);
      } catch (error) {
        const status: unknown =
          typeof error === "object" && error !== null
            ? Reflect.get(error, "status")
            : undefined;
        if (status === 403 || status === 404) {
          blocked.add(calendarKey);
        } else if (!(error instanceof CancelledError)) {
          blocked.add(ref.connectionId);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: BACKGROUND_CONCURRENCY }, work));
};

const getEventTasks = ({
  calendars,
  queryClient,
  ranges,
  staleTime,
  userId,
}: Pick<PrefetchScope, "queryClient" | "userId"> & {
  calendars: CalendarRef[];
  ranges: CalendarEventsRange[];
  staleTime?: number;
}): PrefetchTask[] =>
  ranges.flatMap((range) =>
    calendars.map((ref) => {
      const options = calendarEventsQueryOptions(userId, ref, range);
      return {
        load: async () =>
          await queryClient.query({
            ...options,
            retry: false,
            staleTime: staleTime ?? options.staleTime,
          }),
        ref,
      };
    })
  );

export const prefetchAdjacentCalendarEvents = async (
  queryClient: QueryClient,
  {
    calendars,
    range,
    signal,
    userId,
  }: {
    calendars: CalendarRef[];
    range: CalendarEventsRange;
    signal: AbortSignal;
    userId: string;
  }
) => {
  await runPrefetchTasks(
    { queryClient, signal, userId },
    getEventTasks({
      calendars,
      queryClient,
      ranges: getAdjacentCalendarMonthRanges(range),
      staleTime: PREDICTED_STALE_TIME,
      userId,
    }).slice(0, BACKGROUND_EVENT_REQUEST_LIMIT)
  );
};

export const prefetchCalendarWorkspace = async (
  queryClient: QueryClient,
  {
    route,
    signal,
    userId,
  }: {
    route: Pick<
      MailboxRouteState,
      | "calendarConnectionId"
      | "calendarDate"
      | "calendarEventId"
      | "calendarId"
      | "calendarTimeZone"
      | "calendarView"
    >;
    signal: AbortSignal;
    userId: string;
  }
) => {
  if (signal.aborted || !canPrefetchInBackground()) {
    return;
  }
  let accounts: Awaited<
    ReturnType<typeof orpc.calendar.accounts.call>
  >["accounts"];
  try {
    ({ accounts } = await loadFresh(
      async () =>
        await queryClient.query({
          ...calendarAccountsQueryOptions(userId),
          retry: false,
        }),
      signal
    ));
  } catch {
    return;
  }
  const connected = new Set(
    accounts
      .filter((account) => account.status === "connected")
      .map((account) => account.id)
  );
  await runPrefetchTasks(
    { queryClient, signal, userId },
    [...connected].map((connectionId) => ({
      load: async () =>
        await queryClient.query({
          ...calendarCalendarsQueryOptions(userId, connectionId),
          retry: false,
        }),
      ref: { connectionId },
    }))
  );
  if (signal.aborted) {
    return;
  }
  const revealedKey =
    route.calendarConnectionId && route.calendarId && route.calendarEventId
      ? getCalendarRefKey({
          calendarId: route.calendarId,
          connectionId: route.calendarConnectionId,
        })
      : undefined;
  const calendars = getVisibleCalendars({
    groups: getCalendarGroups({
      accounts,
      calendars: accounts.flatMap(
        (account) =>
          queryClient.getQueryData(
            calendarCalendarsQueryOptions(userId, account.id).queryKey
          )?.calendars ?? []
      ),
    }),
    hiddenCalendarKeys: readCalendarPreferences(
      getCalendarPreferencesKey(userId, null)
    ).hiddenCalendarKeys.filter((key) => key !== revealedKey),
  }).filter((calendar) => connected.has(calendar.connectionId));
  const timeZone =
    route.calendarTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const preferencesOptions = orpc.accountPreferences.get.queryOptions();
  if (queryClient.getQueryData(preferencesOptions.queryKey) === undefined) {
    await Promise.allSettled([
      queryClient.query({ ...preferencesOptions, retry: false }),
    ]);
  }
  const { end, start } = getCalendarWorkspaceRange({
    date:
      route.calendarDate ??
      getZonedDateTimeFields({
        instant: new Date().toISOString(),
        timeZone,
      }).date,
    timeZone,
    view: route.calendarView ?? "week",
    weekStartsOn: queryClient.getQueryData(preferencesOptions.queryKey)
      ?.weekStartsOn,
  });
  const range = { end, start, timeZone };
  await runPrefetchTasks(
    { queryClient, signal, userId },
    getEventTasks({
      calendars,
      queryClient,
      ranges: getCalendarCacheMonthRanges(range),
      staleTime: PREDICTED_STALE_TIME,
      userId,
    }).slice(0, BACKGROUND_EVENT_REQUEST_LIMIT)
  );
};
