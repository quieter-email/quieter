import { rpc } from "@quieter/app/lib/orpc";
import {
  isGmailSandboxMailboxId,
  isSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import { queryOptions } from "@tanstack/react-query";

export const labelSuggestionsQueryOptions = (
  mailboxId: string,
  messageIds: readonly string[],
  enabled = true
) => {
  const ids = [...new Set(messageIds)];
  return queryOptions({
    enabled: enabled && ids.length > 0,
    queryFn: async ({ signal }) => {
      if (isSandboxMailboxId(mailboxId)) {
        return isGmailSandboxMailboxId(mailboxId) &&
          ids.includes("demo-thread-notion-1")
          ? ["Label_Product", "Label_Clients"]
          : [];
      }
      const results: string[] = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = await rpc.mail.listLabelSuggestions(
          { mailboxId, messageIds: ids.slice(offset, offset + 100) },
          { signal }
        );
        results.push(...batch);
      }
      return [...new Set(results)];
    },
    queryKey: ["label-suggestions", mailboxId, ids] as const,
    staleTime: 60_000,
  });
};
