import { getDemoMessageInspector } from "@quieter/app/lib/gmail/demo-mail";
import { GMAIL_QUERY_STALE_TIME_MS } from "@quieter/app/lib/mail";
import { getManagedDemoMessageInspector } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { rpc } from "@quieter/app/lib/orpc";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import { queryOptions } from "@tanstack/react-query";

const MESSAGE_INSPECTOR_QUERY_VERSION = 2;

const getMessageInspectorQueryKey = (mailboxId: string, messageId: string) =>
  [
    "message-inspector",
    MESSAGE_INSPECTOR_QUERY_VERSION,
    mailboxId,
    messageId,
  ] as const;

export const getMessageInspectorOptions = (
  mailboxId: string,
  messageId: string,
  enabled = true
) =>
  queryOptions({
    enabled,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoMessageInspector(messageId);
      }

      if (isSandboxMailboxId(mailboxId)) {
        return getDemoMessageInspector(mailboxId, messageId);
      }

      return await rpc.mail.getMessageInspector(
        { mailboxId, messageId },
        { signal }
      );
    },
    queryKey: getMessageInspectorQueryKey(mailboxId, messageId),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
  });
