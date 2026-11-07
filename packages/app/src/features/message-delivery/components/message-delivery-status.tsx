"use client";

import {
  ACCEPTED_DELIVERY_LABEL,
  DELIVERY_PILL_TONES,
  getAggregateDeliveryStatus,
  getDeliveryStatusDescription,
  getDeliveryStatusLabel,
  getDeliveryStatusTone,
} from "@quieter/app/features/message-delivery/domain/delivery-status";
import { getMessageDeliveryOptions } from "@quieter/app/features/message-delivery/domain/message-delivery-query";
import { Pill } from "@quieter/ui/pill";
import { useQuery } from "@tanstack/react-query";

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

  if (!delivery.deliveryTrackingAvailable) {
    return (
      <Pill
        title="Tracking image loads are approximate and do not confirm the message was read."
        tone="gray"
      >
        {(delivery.openTracking?.reportedLoadCount ?? 0) > 0
          ? "Image loaded"
          : "No image loads"}
      </Pill>
    );
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
