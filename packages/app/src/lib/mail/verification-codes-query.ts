import { rpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const verificationCodesQueryOptions = (
  queryClient: QueryClient,
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
    placeholderData: () => {
      const requestedIds = new Set(ids);
      const cachedQueries = queryClient
        .getQueriesData<RouterOutputs["mail"]["listVerificationCodes"]>({
          predicate: ({ queryKey }) =>
            scope.mode === "messages" || queryKey[2] === "threads",
          queryKey: ["verification-codes", mailboxId],
        })
        .toSorted(
          ([leftKey], [rightKey]) =>
            (queryClient.getQueryState(rightKey)?.dataUpdatedAt ?? 0) -
            (queryClient.getQueryState(leftKey)?.dataUpdatedAt ?? 0)
        );
      const codes = new Map<
        string,
        RouterOutputs["mail"]["listVerificationCodes"]["items"][number]
      >();
      for (const [, data] of cachedQueries) {
        for (const code of data?.items ?? []) {
          const id = scope.mode === "threads" ? code.threadId : code.messageId;
          if (requestedIds.has(id) && !codes.has(id)) {
            codes.set(id, code);
          }
        }
      }
      return { items: [...codes.values()] };
    },
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
