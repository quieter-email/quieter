import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

import type { MessageDeliveryStatus } from "./delivery-status";
import {
  getAggregateDeliveryStatus,
  isDeliveryStatusUnsettled,
} from "./delivery-status";

const DELIVERY_POLL_INTERVAL_MS = 5000;
/** Roughly one minute of polling at the interval above. */
const DELIVERY_POLL_ATTEMPTS = 12;
const DELIVERY_STALE_TIME_MS = 5000;

export const getMessageDeliveryQueryKey = (
  mailboxId: string,
  messageId: string
) => ["message-delivery", mailboxId, messageId] as const;

/**
 * Delivery feedback arrives out of band, so the first minute after opening a
 * sent message is polled. After that the status only refreshes when the window
 * regains focus or the message is opened again.
 */
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
    refetchInterval: (query) => {
      const delivery = query.state.data;
      if (delivery === null) {
        return false;
      }
      if (
        delivery !== undefined &&
        !isDeliveryStatusUnsettled(
          getAggregateDeliveryStatus(delivery.recipients)
        )
      ) {
        return false;
      }
      return query.state.dataUpdateCount < DELIVERY_POLL_ATTEMPTS
        ? DELIVERY_POLL_INTERVAL_MS
        : false;
    },
    refetchOnWindowFocus: true,
    staleTime: DELIVERY_STALE_TIME_MS,
  });

const LIST_DELIVERY_POLL_INTERVAL_MS = 15_000;
/** A few gentle list refreshes while any row is still moving. */
const LIST_DELIVERY_POLL_ATTEMPTS = 4;
const LIST_DELIVERY_STALE_TIME_MS = 15_000;

export const getMessageListDeliveryQueryKey = (mailboxId: string) =>
  ["message-delivery-list", mailboxId] as const;

/**
 * One batched status read per visible page of outbound messages. The result is
 * a map of message id to that message's recipient statuses; chips derive from
 * the same normalized timeline as the detail view.
 */
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
          // oxlint-disable-next-line no-await-in-loop -- Bound concurrent requests when many pages are loaded.
          await rpc.mail.listMessageDeliveryStatuses(
            { mailboxId, messageIds: ids.slice(offset, offset + 100) },
            { signal }
          )
        );
      }
      return result;
    },
    queryKey: [...getMessageListDeliveryQueryKey(mailboxId), ids],
    refetchInterval: (query) => {
      if (query.state.data === undefined) {
        return false;
      }
      const hasUnsettled = ids.some((id) => {
        const statuses = query.state.data?.[id];
        return (
          statuses === undefined ||
          statuses.length === 0 ||
          statuses.some(isDeliveryStatusUnsettled)
        );
      });
      if (!hasUnsettled) {
        return false;
      }
      return query.state.dataUpdateCount < LIST_DELIVERY_POLL_ATTEMPTS
        ? LIST_DELIVERY_POLL_INTERVAL_MS
        : false;
    },
    staleTime: LIST_DELIVERY_STALE_TIME_MS,
  });
};
