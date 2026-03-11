import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";

export const getLabelsQueryKey = () => ["gmail-labels"] as const;

export const labelsQueryOptions = (enabled = true) =>
  queryOptions({
    queryKey: getLabelsQueryKey(),
    queryFn: ({ signal }) => trpc.gmail.listLabels.query(undefined, { signal }),
    enabled,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
