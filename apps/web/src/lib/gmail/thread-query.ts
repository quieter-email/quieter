import { queryOptions } from "@tanstack/solid-query";
import { GMAIL_QUERY_STALE_TIME_MS, getThreadWithDetails } from "./gmail";

export const getThreadQueryKey = (threadId: string) => ["message-thread", threadId] as const;

export const getThreadWithDetailsOptions = (threadId: string) =>
  queryOptions({
    queryKey: getThreadQueryKey(threadId),
    queryFn: ({ signal }) =>
      getThreadWithDetails(threadId, {
        signal,
      }),
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
