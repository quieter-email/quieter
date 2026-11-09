import { getDemoThread } from "@quieter/app/lib/gmail/demo-mail";
import {
  hasRenderableMessageBody,
  MAILBOX_LABELS,
} from "@quieter/app/lib/mail";
import type {
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";
import { getManagedDemoThread } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { rpc } from "@quieter/app/lib/orpc";
import { queryPersister } from "@quieter/app/lib/query-persister";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import { queryOptions } from "@tanstack/react-query";

export { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";

type ThreadMessageExpectation = Pick<
  MessageListItem,
  "id" | "threadMessageCount"
> & { includeDrafts: boolean };

export const shouldRefreshThreadContent = (
  data: ThreadMessagesResult | undefined,
  expectedMessage?: ThreadMessageExpectation
) => {
  if (data === undefined || data.messages.length === 0) {
    return true;
  }
  const includeDrafts = expectedMessage?.includeDrafts === true;
  let expectedMessageFound = expectedMessage === undefined;
  let messageCount = 0;
  for (const message of data.messages) {
    expectedMessageFound ||= message.id === expectedMessage?.id;
    if (
      (message.snippet?.trim() ?? "") !== "" &&
      !hasRenderableMessageBody(message)
    ) {
      return true;
    }
    if (
      includeDrafts ||
      (!message.draftId?.trim() &&
        message.labelIds?.includes(MAILBOX_LABELS.drafts) !== true)
    ) {
      messageCount += 1;
    }
  }
  return (
    !expectedMessageFound ||
    messageCount < (expectedMessage?.threadMessageCount ?? 0)
  );
};

export const getThreadWithDetailsOptions = (
  mailboxId: string,
  threadId: string,
  enabled = true,
  expectedMessage?: ThreadMessageExpectation
) =>
  queryOptions<ThreadMessagesResult>({
    enabled,
    gcTime: 1000 * 60 * 30,
    persister: queryPersister.persisterFn,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoThread(threadId);
      }

      if (isSandboxMailboxId(mailboxId)) {
        return getDemoThread(mailboxId, threadId);
      }

      return await rpc.mail.getThread({ mailboxId, threadId }, { signal });
    },
    queryKey: getThreadQueryKey(mailboxId, threadId),
    refetchOnMount: (query) =>
      shouldRefreshThreadContent(query.state.data, expectedMessage)
        ? "always"
        : query.state.isInvalidated,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: (query) =>
      shouldRefreshThreadContent(query.state.data, expectedMessage)
        ? 0
        : 1000 * 60 * 5,
  });
