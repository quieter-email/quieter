import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";
import { GMAIL_QUERY_STALE_TIME_MS, type MailboxCategory } from "./gmail";

export const getThreadQueryKey = (threadId: string) => ["message-thread", threadId] as const;

export const getThreadWithDetailsOptions = (_category: MailboxCategory, threadId: string) =>
  queryOptions({
    queryKey: getThreadQueryKey(threadId),
    queryFn: ({ signal }) => trpc.gmail.getThread.query({ threadId }, { signal }),
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
