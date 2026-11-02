import { getDemoThread } from "@quieter/app/lib/gmail/demo-mail";
import { hasRenderableMessageBody } from "@quieter/app/lib/mail";
import type { ThreadMessagesResult } from "@quieter/app/lib/mail";
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

const shouldRefreshThreadContent = (data: ThreadMessagesResult | undefined) =>
  data === undefined ||
  data.messages.length === 0 ||
  data.messages.some(
    (message) =>
      message.snippet?.trim() !== undefined &&
      message.snippet.trim() !== "" &&
      !hasRenderableMessageBody(message)
  );

export const getThreadWithDetailsOptions = (
  mailboxId: string,
  threadId: string,
  enabled = true
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
      query.state.isInvalidated || shouldRefreshThreadContent(query.state.data),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
  });
