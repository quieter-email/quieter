import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export const verificationCodesQueryOptions = (
  mailboxId: string,
  scope:
    | { mode: "threads"; threadIds: string[] }
    | { mode: "messages"; messageIds: string[] },
  enabled: boolean
) => {
  const ids = scope.mode === "threads" ? scope.threadIds : scope.messageIds;
  return queryOptions({
    enabled: enabled && ids.length > 0,
    gcTime: 60_000,
    queryFn: async ({ signal }) =>
      await rpc.mail.listVerificationCodes(
        scope.mode === "threads"
          ? { mailboxId, threadIds: scope.threadIds }
          : { mailboxId, messageIds: scope.messageIds },
        { signal }
      ),
    queryKey: ["verification-codes", mailboxId, scope.mode, ids] as const,
    refetchOnWindowFocus: true,
  });
};
