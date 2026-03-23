import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";

export const getLabelsQueryKey = (mailboxId: string) => ["gmail-labels", mailboxId] as const;

export const labelsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    queryKey: getLabelsQueryKey(mailboxId),
    queryFn: ({ signal }) => trpc.mail.listLabels.query({ mailboxId }, { signal }),
    enabled,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
