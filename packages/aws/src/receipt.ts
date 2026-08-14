import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { recordInboundOrganizationMailUsage } from "@quieter/billing/organization-mail-usage";
import { serverEnv } from "@quieter/env/server";
import { recordInboundManagedMessage } from "@quieter/orpc/managed-mail/ingestion";
import { Resource } from "sst";

import { deleteMailObjectUnlessTracked } from "./mail-object-retention";
import {
  getCanonicalRawMailBucket,
  getCanonicalRawMailProvider,
  putRawMailObject,
} from "./raw-mail-object";
import { reportAwsError, withSentry } from "./sentry";

type SnsRecord = {
  Sns?: {
    Message?: string;
  };
};

type SnsEvent = {
  Records?: SnsRecord[];
};

type SesReceiptNotification = {
  mail?: {
    commonHeaders?: {
      messageId?: string;
      subject?: string;
    };
    destination?: string[];
    messageId?: string;
    source?: string;
    timestamp?: string;
  };
  receipt?: {
    action?: {
      bucketName?: string;
      objectKey?: string;
      type?: string;
    };
    recipients?: string[];
    timestamp?: string;
  };
};

const normalizeRecipients = (recipients: string[]) => [
  ...new Set(
    recipients
      .map((recipient) => recipient.trim().toLowerCase())
      .filter((recipient) => recipient.length > 0)
  ),
];

let s3Client: S3Client | null = null;

const getS3Client = () => {
  s3Client ??= new S3Client({
    region: serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION,
  });

  return s3Client;
};

const parseNotification = (message: string): SesReceiptNotification | null => {
  try {
    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const getTrimmedString = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
};

const shouldSkipNotification = (
  notification: SesReceiptNotification,
  providerMessageId: string | null,
  eventBucketName: string | null,
  s3Key: string | null
) =>
  notification.receipt?.action?.type !== "S3" ||
  providerMessageId === null ||
  s3Key === null ||
  (eventBucketName !== null && eventBucketName !== Resource.MailBucket.name);

const getReceiptRecipients = (notification: SesReceiptNotification) => {
  const receiptRecipients = notification.receipt?.recipients;
  if (receiptRecipients !== undefined && receiptRecipients.length > 0) {
    return receiptRecipients;
  }

  return notification.mail?.destination ?? [];
};

const getReceivedAt = (notification: SesReceiptNotification) => {
  const receiptTimestamp = notification.receipt?.timestamp;
  const mailTimestamp = notification.mail?.timestamp;
  const timestamp =
    receiptTimestamp !== undefined && receiptTimestamp.length > 0
      ? receiptTimestamp
      : mailTimestamp;
  return new Date(
    timestamp !== undefined && timestamp.length > 0 ? timestamp : Date.now()
  );
};

const uploadCanonicalRawObject = async (
  rawObjectProvider: ReturnType<typeof getCanonicalRawMailProvider>,
  rawObjectBucket: string,
  s3Key: string,
  rawMessage: Buffer
) => {
  if (rawObjectProvider !== "r2") {
    return;
  }

  await putRawMailObject(
    {
      bucket: rawObjectBucket,
      key: s3Key,
      provider: rawObjectProvider,
    },
    {
      Body: rawMessage,
      ContentLength: rawMessage.byteLength,
      ContentType: "message/rfc822",
    }
  );
};

const deleteR2ObjectIfNeeded = async (
  rawObjectProvider: ReturnType<typeof getCanonicalRawMailProvider>,
  rawObjectBucket: string,
  s3Key: string
) => {
  if (rawObjectProvider !== "r2") {
    return;
  }

  await deleteMailObjectUnlessTracked({
    bucket: rawObjectBucket,
    key: s3Key,
    provider: "r2",
  });
};

const processReceiptRecord = async (record: SnsRecord) => {
  const message = record.Sns?.Message;
  if (message === undefined || message.length === 0) {
    return;
  }

  const notification = parseNotification(message);
  if (notification === null) {
    return;
  }

  const providerMessageId = getTrimmedString(notification.mail?.messageId);
  const eventBucketName = getTrimmedString(
    notification.receipt?.action?.bucketName
  );
  const s3Key = getTrimmedString(notification.receipt?.action?.objectKey);

  if (
    shouldSkipNotification(
      notification,
      providerMessageId,
      eventBucketName,
      s3Key
    )
  ) {
    return;
  }

  if (providerMessageId === null || s3Key === null) {
    return;
  }

  const resolvedProviderMessageId = providerMessageId;
  const resolvedS3Key = s3Key;

  const recipients = normalizeRecipients(getReceiptRecipients(notification));
  const headObject = await getS3Client().send(
    new HeadObjectCommand({
      Bucket: Resource.MailBucket.name,
      Key: resolvedS3Key,
    })
  );
  const messageSizeBytes = headObject.ContentLength ?? 0;
  const object = await getS3Client().send(
    new GetObjectCommand({
      Bucket: Resource.MailBucket.name,
      Key: resolvedS3Key,
    })
  );
  if (object.Body === undefined) {
    throw new Error("The stored inbound message body is missing.");
  }
  const rawMessage = Buffer.from(await object.Body.transformToByteArray());
  const receivedAt = getReceivedAt(notification);
  const rawObjectProvider = getCanonicalRawMailProvider();
  const rawObjectBucket = getCanonicalRawMailBucket(Resource.MailBucket.name);

  await uploadCanonicalRawObject(
    rawObjectProvider,
    rawObjectBucket,
    resolvedS3Key,
    rawMessage
  );

  let mailboxIds: string[];
  try {
    mailboxIds = await recordInboundManagedMessage({
      providerMessageId: resolvedProviderMessageId,
      rawMessage,
      rawObjectBucket,
      rawObjectKey: resolvedS3Key,
      rawObjectProvider,
      rawSizeBytes: messageSizeBytes,
      receivedAt,
      recipients,
      s3Bucket:
        rawObjectProvider === "s3" ? Resource.MailBucket.name : undefined,
      s3Key: rawObjectProvider === "s3" ? resolvedS3Key : undefined,
    });
  } catch (error) {
    await deleteR2ObjectIfNeeded(
      rawObjectProvider,
      rawObjectBucket,
      resolvedS3Key
    );
    throw error;
  }

  await deleteR2ObjectIfNeeded(
    rawObjectProvider,
    rawObjectBucket,
    resolvedS3Key
  );
  await deleteMailObjectUnlessTracked({
    bucket: Resource.MailBucket.name,
    key: resolvedS3Key,
  });
  if (mailboxIds.length > 0) {
    await recordInboundOrganizationMailUsage({
      messageSizeBytes,
      providerMessageId: resolvedProviderMessageId,
      recipients,
    });
  }
};

export const handler = withSentry(
  "MailReceiptProcessor",
  async (event: SnsEvent) => {
    await Promise.all(
      (event.Records ?? []).map(async (record) => {
        try {
          await processReceiptRecord(record);
        } catch (error) {
          await reportAwsError(error, "MailReceiptProcessorRecord");
          throw error;
        }
      })
    );
  }
);
