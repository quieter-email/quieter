import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "#/lib/sandbox-mailbox";

import { getManagedDemoThread } from "../managed-mail/demo-managed-mail";
import { getDemoThread } from "./demo-mail";
import { hasRenderableMessageBody } from "./gmail";
import type { ThreadMessagesResult } from "./gmail";
import { getThreadQueryKey } from "./thread-query-keys";

export { getThreadQueryKey } from "./thread-query-keys";

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
  queryOptions({
    enabled,
    gcTime: 1000 * 60 * 30,
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
    refetchOnMount: (query) => shouldRefreshThreadContent(query.state.data),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
  });
