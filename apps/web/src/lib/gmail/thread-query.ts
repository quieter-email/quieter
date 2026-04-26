import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import {
  GMAIL_QUERY_STALE_TIME_MS,
  type MailboxCategory,
  type MessageListItem,
  type ThreadMessagesResult,
} from "./gmail";

const THREAD_QUERY_VERSION = 3;

export const getThreadQueryKey = (mailboxId: string, threadId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, mailboxId, threadId] as const;

const hasRenderableBody = (message: MessageListItem) =>
  Boolean(message.bodyHtml?.trim() || message.bodyText?.trim());

const shouldRefreshThreadContent = (data: ThreadMessagesResult | undefined) =>
  !data?.messages.length ||
  data.messages.some((message) => Boolean(message.snippet?.trim()) && !hasRenderableBody(message));

export const getThreadWithDetailsOptions = (
  mailboxId: string,
  _category: MailboxCategory,
  threadId: string,
  enabled = true,
) =>
  queryOptions({
    queryKey: getThreadQueryKey(mailboxId, threadId),
    queryFn: ({ signal }) => rpc.mail.getThread({ mailboxId, threadId }, { signal }),
    enabled,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnMount: (query) => (shouldRefreshThreadContent(query.state.data) ? "always" : true),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
