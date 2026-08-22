"use client";

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@quieter/ui/accordion";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";
import { useQuery } from "@tanstack/react-query";

import {
  ACCEPTED_DELIVERY_LABEL,
  getAggregateDeliveryStatus,
  getDeliveryActionGuidance,
  getDeliveryStatusDescription,
  getDeliveryStatusLabel,
  getDeliveryStatusTone,
  getRecipientDeliveryEvents,
  hasDeliveryDiagnostics,
} from "../domain/delivery-status";
import type {
  DeliveryStatusTone,
  MessageDeliveryEvent,
  MessageDeliveryRecipient,
  MessageDeliveryResult,
} from "../domain/delivery-status";
import { getMessageDeliveryOptions } from "../domain/message-delivery-query";

const PILL_TONES: Record<DeliveryStatusTone, PillTone> = {
  danger: "red",
  neutral: "gray",
  positive: "green",
  warning: "orange",
};

const eventTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const DiagnosticRow = ({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) => {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }

  return (
    <p className="text-caption text-muted-fg">
      <span className="font-medium text-fg">{label}: </span>
      <span className="wrap-break-word">{trimmed}</span>
    </p>
  );
};

const DeliveryEventRow = ({ event }: { event: MessageDeliveryEvent }) => (
  <li className="space-y-1 border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="text-body text-fg">
        {getDeliveryStatusLabel(event.eventType)}
      </span>
      <span className="text-caption text-muted-fg">
        {eventTimeFormatter.format(event.occurredAt)}
      </span>
    </div>

    {hasDeliveryDiagnostics(event) ? (
      <Collapsible>
        <CollapsibleTrigger className="text-caption text-muted-fg underline underline-offset-2 hover:text-fg">
          Technical details
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-1 pt-1.5">
              <DiagnosticRow label="Reason" value={event.reason} />
              <DiagnosticRow label="Status" value={event.providerStatus} />
              <DiagnosticRow label="Diagnostic" value={event.diagnosticCode} />
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    ) : null}
  </li>
);

const DeliveryRecipientItem = ({
  events,
  recipient,
}: {
  events: readonly MessageDeliveryEvent[];
  recipient: MessageDeliveryRecipient;
}) => {
  const recipientEvents = getRecipientDeliveryEvents(
    events,
    recipient.recipient
  );

  return (
    <AccordionItem value={recipient.recipient}>
      <AccordionHeader>
        <AccordionTrigger>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-normal text-fg">
              {recipient.recipient}
            </span>
            <Pill tone={PILL_TONES[getDeliveryStatusTone(recipient.status)]}>
              {getDeliveryStatusLabel(recipient.status)}
            </Pill>
            <span className="text-caption font-normal text-muted-fg">
              {eventTimeFormatter.format(recipient.lastEventAt)}
            </span>
          </span>
        </AccordionTrigger>
      </AccordionHeader>

      <AccordionPanel>
        {getDeliveryActionGuidance(recipient.status) !== null && (
          <p className="mb-2 text-caption text-fg">
            {getDeliveryActionGuidance(recipient.status)}
          </p>
        )}
        {recipientEvents.length > 0 ? (
          <ul className="space-y-2">
            {recipientEvents.map((event) => (
              <DeliveryEventRow
                event={event}
                key={`${event.eventType}-${event.occurredAt.toISOString()}`}
              />
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-fg">No events recorded yet.</p>
        )}
      </AccordionPanel>
    </AccordionItem>
  );
};

const DeliveryRecipients = ({
  delivery,
}: {
  delivery: MessageDeliveryResult;
}) => {
  if (delivery.recipients.length === 0) {
    return (
      <p className="text-body text-muted-fg">
        Recipient updates appear here once the receiving mail servers respond.
      </p>
    );
  }

  return (
    <Accordion className="space-y-2">
      {delivery.recipients.map((recipient) => (
        <DeliveryRecipientItem
          events={delivery.events}
          key={recipient.recipient}
          recipient={recipient}
        />
      ))}
    </Accordion>
  );
};

export const MessageDeliverySection = ({
  enabled,
  mailboxId,
  messageId,
}: {
  enabled: boolean;
  mailboxId: string;
  messageId: string;
}) => {
  const {
    data: delivery,
    error: deliveryError,
    isError: isDeliveryError,
    isPending: isDeliveryPending,
  } = useQuery(getMessageDeliveryOptions(mailboxId, messageId, enabled));

  if (!enabled || delivery === null) {
    return null;
  }

  const status =
    delivery === undefined
      ? null
      : getAggregateDeliveryStatus(delivery.recipients);
  const summaryLabel =
    status === null ? ACCEPTED_DELIVERY_LABEL : getDeliveryStatusLabel(status);

  return (
    <section className="space-y-3">
      <h3 className="text-body font-semibold text-fg">Delivery</h3>

      {isDeliveryPending ? (
        <p className="text-body text-muted-fg">Loading delivery status…</p>
      ) : null}

      {isDeliveryError ? (
        <p className="text-body text-destructive">
          {deliveryError.message ?? "Could not load delivery status."}
        </p>
      ) : null}

      {delivery === undefined ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={PILL_TONES[getDeliveryStatusTone(status)]}>
              {summaryLabel}
            </Pill>
            <span className="text-body text-muted-fg">
              {getDeliveryStatusDescription(status)}
            </span>
          </div>

          <DeliveryRecipients delivery={delivery} />
        </>
      )}
    </section>
  );
};
