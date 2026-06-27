import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";
import { isSandboxMailboxId, getDemoThread } from "./demo-mail";
import {
  GMAIL_QUERY_STALE_TIME_MS,
  hasRenderableMessageBody,
  type ThreadMessagesResult,
} from "./gmail";

const THREAD_QUERY_VERSION = 3;

export const getThreadQueryKey = (mailboxId: string, threadId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, mailboxId, threadId] as const;

const shouldRefreshThreadContent = (data: ThreadMessagesResult | undefined) =>
  !data?.messages.length ||
  data.messages.some((message) => !!message.snippet?.trim() && !hasRenderableMessageBody(message));

export const getThreadWithDetailsOptions = (mailboxId: string, threadId: string, enabled = true) =>
  queryOptions({
    queryKey: getThreadQueryKey(mailboxId, threadId),
    queryFn: ({ signal }) =>
      isSandboxMailboxId(mailboxId)
        ? getDemoThread(mailboxId, threadId)
        : rpc.mail.getThread({ mailboxId, threadId }, { signal }),
    enabled,
    persister: queryPersister.persisterFn,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnMount: (query) => (shouldRefreshThreadContent(query.state.data) ? "always" : true),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
