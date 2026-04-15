import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  createMailMessage,
  findMailDomainByRecipients,
  findMailMessageByProviderMessageId,
} from "@quietr/orpc/mail-service";

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

let s3Client: S3Client | null = null;

const getS3Client = () => {
  s3Client ??= new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  });

  return s3Client;
};

const parseNotification = (value: string): SesReceiptNotification | null => {
  try {
    return JSON.parse(value) as SesReceiptNotification;
  } catch {
    return null;
  }
};

const normalizeRecipients = (recipients: string[]) =>
  Array.from(
    new Set(recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean)),
  );

const getRawSizeBytes = async (bucket: string, key: string) => {
  const response = await getS3Client().send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  return Number(response.ContentLength ?? 0);
};

const processNotification = async (notification: SesReceiptNotification) => {
  const providerMessageId = notification.mail?.messageId?.trim() || null;
  const s3Bucket = notification.receipt?.action?.bucketName?.trim() || null;
  const s3Key = notification.receipt?.action?.objectKey?.trim() || null;

  if (notification.receipt?.action?.type !== "S3" || !providerMessageId || !s3Bucket || !s3Key) {
    return;
  }

  const recipients = normalizeRecipients(
    notification.receipt?.recipients?.length
      ? notification.receipt.recipients
      : (notification.mail?.destination ?? []),
  );

  const mailDomain = await findMailDomainByRecipients(recipients);

  if (!mailDomain) {
    return;
  }

  const existingMessage = await findMailMessageByProviderMessageId({
    mailDomainId: mailDomain.id,
    providerMessageId,
  });

  if (existingMessage) {
    return;
  }

  const receivedAt = new Date(
    notification.receipt?.timestamp || notification.mail?.timestamp || Date.now(),
  );

  await createMailMessage({
    mailDomainId: mailDomain.id,
    mailFrom: notification.mail?.source?.trim() || null,
    messageIdHeader: notification.mail?.commonHeaders?.messageId?.trim() || null,
    organizationId: mailDomain.organizationId,
    providerMessageId,
    rawSizeBytes: await getRawSizeBytes(s3Bucket, s3Key),
    receivedAt,
    recipients,
    s3Bucket,
    s3Key,
    subject: notification.mail?.commonHeaders?.subject?.trim() || null,
  });
};

export const handler = async (event: SnsEvent) => {
  for (const record of event.Records ?? []) {
    const notification = record.Sns?.Message ? parseNotification(record.Sns.Message) : null;

    if (!notification) {
      continue;
    }

    await processNotification(notification);
  }
};
