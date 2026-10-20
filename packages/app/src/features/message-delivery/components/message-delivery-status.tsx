"use client";

import {
  ACCEPTED_DELIVERY_LABEL,
  getAggregateDeliveryStatus,
  getDeliveryStatusDescription,
  getDeliveryStatusLabel,
  getDeliveryStatusTone,
} from "@quieter/app/features/message-delivery/domain/delivery-status";
import type { DeliveryStatusTone } from "@quieter/app/features/message-delivery/domain/delivery-status";
import { getMessageDeliveryOptions } from "@quieter/app/features/message-delivery/domain/message-delivery-query";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";
import { useQuery } from "@tanstack/react-query";

const PILL_TONES: Record<DeliveryStatusTone, PillTone> = {
  danger: "red",
  neutral: "gray",
  positive: "green",
  warning: "orange",
};

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
      tone={PILL_TONES[getDeliveryStatusTone(status)]}
    >
      {label}
    </Pill>
  );
};
