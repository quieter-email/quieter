import type { RouterOutputs } from "@quieter/orpc";

export type MessageDeliveryResult = NonNullable<
  RouterOutputs["mail"]["getMessageDelivery"]
>;
export type MessageDeliveryRecipient =
  MessageDeliveryResult["recipients"][number];
export type MessageDeliveryEvent = MessageDeliveryResult["events"][number];
export type MessageDeliveryStatus = MessageDeliveryRecipient["status"];

/**
 * Worst outcome first: a single complaint or bounce matters more than the
 * remaining recipients looking healthy.
 */
const DELIVERY_STATUS_SEVERITY: MessageDeliveryStatus[] = [
  "complained",
  "bounced",
  "rejected",
  "unsubscribed",
  "delayed",
  "delivered",
  "opened",
  "sent",
  "queued",
];

const DELIVERY_STATUS_LABELS: Record<MessageDeliveryStatus, string> = {
  bounced: "Couldn't deliver",
  complained: "Reported as spam",
  delayed: "Delayed",
  delivered: "Delivered",
  opened: "Opened",
  queued: "Queued",
  rejected: "Rejected",
  sent: "Sending",
  unsubscribed: "Unsubscribed",
};

const DELIVERY_STATUS_DESCRIPTIONS: Record<MessageDeliveryStatus, string> = {
  bounced: "The receiving mail server refused this message.",
  complained: "The recipient marked this message as spam.",
  delayed: "Delivery is taking longer than usual. We keep retrying.",
  delivered: "The receiving mail server accepted this message.",
  opened:
    "The recipient's mail program reported opening this message. Opens are approximate and can be missed or faked by automatic tools.",
  queued: "The message is waiting to be handed to the mail system.",
  rejected: "This message was rejected before it left our system.",
  sent: "Handed to the receiving mail server.",
  unsubscribed: "The recipient asked to stop getting mail from this team.",
};

export const ACCEPTED_DELIVERY_LABEL = "Accepted";

const ACCEPTED_DELIVERY_DESCRIPTION =
  "The message was accepted for sending. Delivery updates appear here.";

export const getDeliveryStatusLabel = (status: MessageDeliveryStatus) =>
  DELIVERY_STATUS_LABELS[status];

export const getDeliveryStatusDescription = (
  status: MessageDeliveryStatus | null
) =>
  status === null
    ? ACCEPTED_DELIVERY_DESCRIPTION
    : DELIVERY_STATUS_DESCRIPTIONS[status];

/**
 * `null` means no recipient events have arrived yet, which reads as "Accepted".
 */
export const getAggregateDeliveryStatus = (
  recipients: readonly MessageDeliveryRecipient[]
): MessageDeliveryStatus | null => {
  for (const status of DELIVERY_STATUS_SEVERITY) {
    if (recipients.some((recipient) => recipient.status === status)) {
      return status;
    }
  }
  return null;
};

export const getAggregateDeliveryLabel = (
  recipients: readonly MessageDeliveryRecipient[]
) => {
  const status = getAggregateDeliveryStatus(recipients);
  return status === null
    ? ACCEPTED_DELIVERY_LABEL
    : getDeliveryStatusLabel(status);
};

export type DeliveryStatusTone = "neutral" | "positive" | "warning" | "danger";

export const getDeliveryStatusTone = (
  status: MessageDeliveryStatus | null
): DeliveryStatusTone => {
  if (status === null || status === "sent" || status === "queued") {
    return "neutral";
  }
  if (status === "delivered" || status === "opened") {
    return "positive";
  }
  if (status === "delayed") {
    return "warning";
  }
  return "danger";
};

export const isDeliveryStatusUnsettled = (
  status: MessageDeliveryStatus | null
) => status === null || status === "sent" || status === "queued";

/**
 * Delivery events only describe what the receiving mail server did, so the
 * timeline stays sorted by when the provider observed them.
 */
export const getRecipientDeliveryEvents = (
  events: readonly MessageDeliveryEvent[],
  recipient: string
) =>
  events
    .filter((event) => event.recipient === recipient)
    .toSorted(
      (first, second) =>
        second.occurredAt.getTime() - first.occurredAt.getTime()
    );

export const hasDeliveryDiagnostics = (event: MessageDeliveryEvent) =>
  (event.diagnosticCode?.trim() ?? "") !== "" ||
  (event.providerStatus?.trim() ?? "") !== "" ||
  (event.reason?.trim() ?? "") !== "";

export const summarizeDeliveryRecipients = (
  recipients: readonly MessageDeliveryRecipient[]
) => {
  if (recipients.length === 0) {
    return "No recipient updates yet";
  }
  if (recipients.length === 1) {
    return recipients[0].recipient;
  }
  return `${recipients.length} recipients`;
};
