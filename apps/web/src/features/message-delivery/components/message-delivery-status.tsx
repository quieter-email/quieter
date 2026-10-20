"use client";

import { Pill } from "@quieter/ui/pill";
import { useQuery } from "@tanstack/react-query";

import {
  ACCEPTED_DELIVERY_LABEL,
  DELIVERY_PILL_TONES,
  getAggregateDeliveryStatus,
  getDeliveryStatusDescription,
  getDeliveryStatusLabel,
  getDeliveryStatusTone,
} from "../domain/delivery-status";
import { getMessageDeliveryOptions } from "../domain/message-delivery-query";

export const MessageDeliveryStatus = ({
  mailboxId,
  messageId,
}: {
  mailboxId: string;
  messageId: string;
}) => {
  const { data: delivery } = useQuery(
    getMessageDeliveryOptions(mailboxId, messageId)
  );

  if (delivery === undefined || delivery === null) {
    return null;
  }

  const status = getAggregateDeliveryStatus(delivery.recipients);
  const label =
    status === null ? ACCEPTED_DELIVERY_LABEL : getDeliveryStatusLabel(status);

  return (
    <Pill
      aria-label={`Delivery status: ${label}`}
      className="cursor-text"
      title={getDeliveryStatusDescription(status)}
      tone={DELIVERY_PILL_TONES[getDeliveryStatusTone(status)]}
    >
      {label}
    </Pill>
  );
};
