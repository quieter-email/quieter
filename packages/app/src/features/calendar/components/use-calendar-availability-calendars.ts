"use client";

import {
  calendarAccountsQueryOptions,
  calendarCalendarsQueryOptions,
} from "@quieter/app/lib/calendar-query";
import { useQueries, useQuery } from "@tanstack/react-query";

export const useCalendarAvailabilityCalendars = (userId: string) => {
  const accounts = useQuery(calendarAccountsQueryOptions(userId));
  const calendarQueries = useQueries({
    queries: (accounts.data?.accounts ?? [])
      .filter((account) => account.status === "connected")
      .map((account) => calendarCalendarsQueryOptions(userId, account.id)),
  });
  return {
    accounts: accounts.data?.accounts ?? [],
    calendars: calendarQueries.flatMap((query) => query.data?.calendars ?? []),
    hasAttention: (accounts.data?.accounts ?? []).some(
      (account) => account.status !== "connected"
    ),
    isError: accounts.isError || calendarQueries.some((query) => query.isError),
    isFetching:
      accounts.isFetching || calendarQueries.some((query) => query.isFetching),
    isPending:
      accounts.isPending || calendarQueries.some((query) => query.isPending),
    retry: () => {
      void accounts.refetch();
      for (const query of calendarQueries) {
        void query.refetch();
      }
    },
  };
};
