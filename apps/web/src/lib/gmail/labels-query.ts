import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

const getLabelsQueryKey = (mailboxId: string) => ["gmail-labels", mailboxId] as const;

export const labelsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    queryKey: getLabelsQueryKey(mailboxId),
    queryFn: ({ signal }) => rpc.mail.listLabels({ mailboxId }, { signal }),
    enabled,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
