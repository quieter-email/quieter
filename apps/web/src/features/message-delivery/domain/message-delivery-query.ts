import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

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
