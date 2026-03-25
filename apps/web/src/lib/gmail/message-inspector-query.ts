import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { GMAIL_QUERY_STALE_TIME_MS } from "./gmail";

const MESSAGE_INSPECTOR_QUERY_VERSION = 2;

export const getMessageInspectorQueryKey = (mailboxId: string, messageId: string) =>
  ["message-inspector", MESSAGE_INSPECTOR_QUERY_VERSION, mailboxId, messageId] as const;

export const getMessageInspectorOptions = (mailboxId: string, messageId: string, enabled = true) =>
  queryOptions({
    queryKey: getMessageInspectorQueryKey(mailboxId, messageId),
    queryFn: ({ signal }) => rpc.mail.getMessageInspector({ mailboxId, messageId }, { signal }),
    enabled,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
