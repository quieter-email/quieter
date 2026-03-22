import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";

export const getLabelsQueryKey = (userId: string) => ["gmail-labels", userId] as const;

export const labelsQueryOptions = (userId: string, enabled = true) =>
  queryOptions({
    queryKey: getLabelsQueryKey(userId),
    queryFn: ({ signal }) => trpc.gmail.listLabels.query(undefined, { signal }),
    enabled,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
