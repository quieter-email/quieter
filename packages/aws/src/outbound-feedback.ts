import { withRequestDatabaseClient } from "@quieter/database/client";
import type { OrganizationMailDeliveryEventType } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { recordOrganizationMailFeedback } from "@quieter/orpc/organization-mail-delivery";
import type {
  OrganizationMailFeedback,
  OrganizationMailFeedbackRecipient,
} from "@quieter/orpc/organization-mail-delivery";

import { reportAwsError } from "./sentry";

type JsonObject = Record<string, unknown>;

type SqsRecord = {
  body: string;
  messageId: string;
};

type SqsEvent = {
  Records: SqsRecord[];
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getObject = (value: unknown, name: string): JsonObject | null => {
  if (!isObject(value)) {
    return null;
  }
  const entry = value[name];
  return isObject(entry) ? entry : null;
};

const getString = (value: unknown, name: string): string | null => {
  if (!isObject(value)) {
    return null;
  }
  const entry = value[name];
  return typeof entry === "string" && entry.trim() !== "" ? entry.trim() : null;
};

const getStringArray = (value: unknown, name: string): string[] => {
  if (!isObject(value) || !Array.isArray(value[name])) {
    return [];
  }
  return value[name].filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== ""
  );
};

const parseJsonObject = (value: string, label: string): JsonObject => {
  const parsed: unknown = JSON.parse(value);
  if (!isObject(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
};

const parseOccurredAt = (value: string | null) => {
  if (value === null) {
    throw new Error("SES feedback event timestamp is missing.");
  }
  const occurredAt = new Date(value);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new TypeError("SES feedback event timestamp is invalid.");
  }
  return occurredAt;
};

const getDestinationRecipients = (mail: JsonObject) =>
  getStringArray(mail, "destination").map((emailAddress) => ({ emailAddress }));

const getRecipientObjects = (
  container: JsonObject,
  name: string
): OrganizationMailFeedbackRecipient[] => {
  const values = container[name];
  if (!Array.isArray(values)) {
    return [];
  }

  return values.flatMap((value) => {
    if (typeof value === "string" && value.trim() !== "") {
      return [{ emailAddress: value }];
    }
    const emailAddress = getString(value, "emailAddress");
    if (emailAddress === null) {
      return [];
    }
    return [
      {
        diagnosticCode: getString(value, "diagnosticCode") ?? undefined,
        emailAddress,
        providerStatus: getString(value, "status") ?? undefined,
        reason: getString(value, "action") ?? undefined,
      },
    ];
  });
};

const requireRecipients = (recipients: OrganizationMailFeedbackRecipient[]) => {
  if (recipients.length === 0) {
    throw new Error("SES feedback event recipients are missing.");
  }
  return recipients;
};

const parseEventDetails = (input: {
  eventType: string;
  mail: JsonObject;
  notification: JsonObject;
  snsMessageId: string;
}): Pick<
  OrganizationMailFeedback,
  | "eventType"
  | "occurredAt"
  | "permanentFailure"
  | "recipients"
  | "sourceEventId"
> | null => {
  const normalizedEventType = input.eventType
    .replaceAll("_", "")
    .replaceAll("-", "")
    .toUpperCase();

  if (normalizedEventType === "SEND") {
    return {
      eventType: "sent",
      occurredAt: parseOccurredAt(getString(input.mail, "timestamp")),
      recipients: requireRecipients(getDestinationRecipients(input.mail)),
      sourceEventId: input.snsMessageId,
    };
  }

  const mappings: Record<
    string,
    {
      containerName: string;
      eventType: OrganizationMailDeliveryEventType;
      recipientName?: string;
    }
  > = {
    BOUNCE: {
      containerName: "bounce",
      eventType: "bounced",
      recipientName: "bouncedRecipients",
    },
    COMPLAINT: {
      containerName: "complaint",
      eventType: "complained",
      recipientName: "complainedRecipients",
    },
    DELIVERY: {
      containerName: "delivery",
      eventType: "delivered",
      recipientName: "recipients",
    },
    DELIVERYDELAY: {
      containerName: "deliveryDelay",
      eventType: "delayed",
      recipientName: "delayedRecipients",
    },
    REJECT: { containerName: "reject", eventType: "rejected" },
  };
  const mapping = mappings[normalizedEventType];
  if (mapping === undefined) {
    return null;
  }

  const container = getObject(input.notification, mapping.containerName);
  if (container === null) {
    throw new Error(`SES ${normalizedEventType} feedback details are missing.`);
  }
  const reason =
    getString(container, "reason") ??
    getString(container, "complaintFeedbackType") ??
    getString(container, "delayType");
  const recipients = (
    mapping.recipientName === undefined
      ? getDestinationRecipients(input.mail).map((recipient) => ({
          ...recipient,
          reason: reason ?? undefined,
        }))
      : getRecipientObjects(container, mapping.recipientName)
  ).map((recipient) => ({
    ...recipient,
    reason: recipient.reason ?? reason ?? undefined,
  }));
  const permanentFailure =
    normalizedEventType === "BOUNCE" &&
    getString(container, "bounceType")?.toUpperCase() === "PERMANENT";

  return {
    eventType:
      normalizedEventType === "BOUNCE" && !permanentFailure
        ? "delayed"
        : mapping.eventType,
    occurredAt: parseOccurredAt(
      getString(container, "timestamp") ?? getString(input.mail, "timestamp")
    ),
    permanentFailure,
    recipients: requireRecipients(recipients),
    sourceEventId: getString(container, "feedbackId") ?? input.snsMessageId,
  };
};

export const parseSesFeedbackQueueMessage = (
  body: string,
  expectedTopicArn?: string
): OrganizationMailFeedback | null => {
  const envelope = parseJsonObject(body, "SNS envelope");
  const topicArn = getString(envelope, "TopicArn");
  if (expectedTopicArn !== undefined && topicArn !== expectedTopicArn) {
    throw new Error("SES feedback message came from an unexpected SNS topic.");
  }
  const message = getString(envelope, "Message");
  const snsMessageId = getString(envelope, "MessageId");
  if (message === null || snsMessageId === null) {
    throw new Error("SNS feedback envelope is incomplete.");
  }

  const notification = parseJsonObject(message, "SES feedback message");
  const eventType =
    getString(notification, "eventType") ??
    getString(notification, "notificationType");
  const mail = getObject(notification, "mail");
  const providerMessageId = getString(mail, "messageId");
  if (eventType === null || mail === null || providerMessageId === null) {
    throw new Error("SES feedback message is incomplete.");
  }

  const details = parseEventDetails({
    eventType,
    mail,
    notification,
    snsMessageId,
  });
  if (details === null) {
    return null;
  }

  return {
    ...details,
    provider: "ses",
    providerMessageId,
  };
};

const processRecord = async (record: SqsRecord) => {
  const feedback = parseSesFeedbackQueueMessage(
    record.body,
    serverEnv.SES_FEEDBACK_TOPIC_ARN
  );
  if (feedback === null) {
    return;
  }
  await withRequestDatabaseClient(async () => {
    await recordOrganizationMailFeedback(feedback);
  });
};

export const handler = async (event: SqsEvent) => {
  const results = await Promise.all(
    event.Records.map(async (record) => {
      try {
        await processRecord(record);
        return null;
      } catch (error) {
        await reportAwsError(error, "MailOutboundFeedbackProcessor");
        return record.messageId;
      }
    })
  );

  return {
    batchItemFailures: results.flatMap((messageId) =>
      messageId === null ? [] : [{ itemIdentifier: messageId }]
    ),
  };
};
