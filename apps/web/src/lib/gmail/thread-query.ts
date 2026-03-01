import { queryOptions } from "@tanstack/solid-query";
import { GMAIL_QUERY_STALE_TIME_MS, getThreadWithDetails } from "./gmail";

export const getThreadWithDetailsOptions = (threadId: string) =>
  queryOptions({
    queryKey: ["message-thread", threadId],
    queryFn: ({ signal }) =>
      getThreadWithDetails(threadId, {
        signal,
      }),
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
