import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { isManagedSandboxMailboxId, isSandboxMailboxId } from "~/lib/sandbox-mailbox";
import { getManagedDemoThread } from "../managed-mail/demo-managed-mail";
import { getDemoThread } from "./demo-mail";
import {
  GMAIL_QUERY_STALE_TIME_MS,
  hasRenderableMessageBody,
  type ThreadMessagesResult,
} from "./gmail";

const THREAD_QUERY_VERSION = 3;

export const getThreadQueryKey = (mailboxId: string, threadId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, mailboxId, threadId] as const;

export const getMailboxThreadQueriesKey = (mailboxId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, mailboxId] as const;

const shouldRefreshThreadContent = (data: ThreadMessagesResult | undefined) =>
  !data?.messages.length ||
  data.messages.some((message) => !!message.snippet?.trim() && !hasRenderableMessageBody(message));

export const getThreadWithDetailsOptions = (mailboxId: string, threadId: string, enabled = true) =>
  queryOptions({
    queryKey: getThreadQueryKey(mailboxId, threadId),
    queryFn: ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoThread(threadId);
      }

      return isSandboxMailboxId(mailboxId)
        ? getDemoThread(mailboxId, threadId)
        : rpc.mail.getThread({ mailboxId, threadId }, { signal });
    },
    enabled,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnMount: (query) => (shouldRefreshThreadContent(query.state.data) ? "always" : true),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
