import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";
import { GMAIL_QUERY_STALE_TIME_MS } from "./gmail";

export const getMessageInspectorQueryKey = (userId: string, messageId: string) =>
  ["message-inspector", userId, messageId] as const;

export const getMessageInspectorOptions = (userId: string, messageId: string, enabled = true) =>
  queryOptions({
    queryKey: getMessageInspectorQueryKey(userId, messageId),
    queryFn: ({ signal }) => trpc.gmail.getMessageInspector.query({ messageId }, { signal }),
    enabled,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
