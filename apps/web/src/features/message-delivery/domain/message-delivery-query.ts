import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

import type { MessageDeliveryStatus } from "./delivery-status";

const DELIVERY_STALE_TIME_MS = 5000;

const getMessageDeliveryQueryKey = (mailboxId: string, messageId: string) =>
  ["message-delivery", mailboxId, messageId] as const;

export const getMessageDeliveryOptions = (
  mailboxId: string,
  messageId: string,
  enabled = true
) =>
  queryOptions({
    enabled: enabled && mailboxId !== "" && messageId !== "",
    queryFn: async ({ signal }) =>
      await rpc.mail.getMessageDelivery({ mailboxId, messageId }, { signal }),
    queryKey: getMessageDeliveryQueryKey(mailboxId, messageId),
    refetchOnWindowFocus: false,
    staleTime: DELIVERY_STALE_TIME_MS,
  });

const LIST_DELIVERY_STALE_TIME_MS = 15_000;

const getMessageListDeliveryQueryKey = (mailboxId: string) =>
  ["message-delivery-list", mailboxId] as const;

export const getMessageListDeliveryOptions = ({
  enabled,
  mailboxId,
  messageIds,
}: {
  enabled: boolean;
  mailboxId: string;
  messageIds: string[];
}) => {
  const ids = [...new Set(messageIds)].toSorted();
  return queryOptions({
    enabled: enabled && mailboxId !== "" && ids.length > 0,
    queryFn: async ({ signal }) => {
      const result: Record<string, MessageDeliveryStatus[]> = {};
      for (let offset = 0; offset < ids.length; offset += 100) {
        Object.assign(
          result,
          await rpc.mail.listMessageDeliveryStatuses(
            { mailboxId, messageIds: ids.slice(offset, offset + 100) },
            { signal }
          )
        );
      }
      return result;
    },
    queryKey: [...getMessageListDeliveryQueryKey(mailboxId), ids],
    staleTime: LIST_DELIVERY_STALE_TIME_MS,
  });
};
