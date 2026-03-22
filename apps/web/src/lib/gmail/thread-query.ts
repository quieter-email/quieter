import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";
import { GMAIL_QUERY_STALE_TIME_MS, type MailboxCategory } from "./gmail";

const THREAD_QUERY_VERSION = 4;

export const getThreadQueryKey = (userId: string, threadId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, userId, threadId] as const;

export const getThreadWithDetailsOptions = (
  userId: string,
  _category: MailboxCategory,
  threadId: string,
  enabled = true,
) =>
  queryOptions({
    queryKey: getThreadQueryKey(userId, threadId),
    queryFn: ({ signal }) => trpc.gmail.getThread.query({ threadId }, { signal }),
    enabled,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
