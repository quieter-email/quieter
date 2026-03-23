import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";
import { GMAIL_QUERY_STALE_TIME_MS, type MailboxCategory } from "./gmail";

const THREAD_QUERY_VERSION = 3;

export const getThreadQueryKey = (mailboxId: string, threadId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, mailboxId, threadId] as const;

export const getThreadWithDetailsOptions = (
  mailboxId: string,
  _category: MailboxCategory,
  threadId: string,
  enabled = true,
) =>
  queryOptions({
    queryKey: getThreadQueryKey(mailboxId, threadId),
    queryFn: ({ signal }) => trpc.mail.getThread.query({ mailboxId, threadId }, { signal }),
    enabled,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
