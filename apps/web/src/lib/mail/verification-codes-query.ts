import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export const verificationCodesQueryOptions = (
  mailboxId: string,
  threadIds: string[],
  enabled: boolean
) =>
  queryOptions({
    enabled: enabled && threadIds.length > 0,
    gcTime: 60_000,
    queryFn: async ({ signal }) =>
      await rpc.mail.listVerificationCodes(
        { mailboxId, threadIds },
        { signal }
      ),
    queryKey: ["verification-codes", mailboxId, threadIds] as const,
    refetchOnWindowFocus: true,
  });
