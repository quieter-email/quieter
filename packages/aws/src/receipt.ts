import { Resource } from "sst";

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

const normalizeRecipients = (recipients: string[]) =>
  Array.from(
    new Set(recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean)),
  );

export const handler = async (event: SnsEvent) => {
  for (const record of event.Records ?? []) {
    if (!record.Sns?.Message) {
      continue;
    }

    let notification: SesReceiptNotification;

    try {
      notification = JSON.parse(record.Sns.Message) as SesReceiptNotification;
    } catch {
      continue;
    }

    const providerMessageId = notification.mail?.messageId?.trim() || null;
    const eventBucketName = notification.receipt?.action?.bucketName?.trim() || null;
    const s3Key = notification.receipt?.action?.objectKey?.trim() || null;

    if (
      notification.receipt?.action?.type !== "S3" ||
      !providerMessageId ||
      !s3Key ||
      (eventBucketName && eventBucketName !== Resource.MailBucket.name)
    ) {
      continue;
    }

    console.info("Processed SES receipt notification.", {
      mailFrom: notification.mail?.source?.trim() || null,
      messageIdHeader: notification.mail?.commonHeaders?.messageId?.trim() || null,
      providerMessageId,
      receivedAt: new Date(
        notification.receipt?.timestamp || notification.mail?.timestamp || Date.now(),
      ),
      recipients: normalizeRecipients(
        notification.receipt?.recipients?.length
          ? notification.receipt.recipients
          : (notification.mail?.destination ?? []),
      ),
      s3Bucket: Resource.MailBucket.name,
      s3Key,
      subject: notification.mail?.commonHeaders?.subject?.trim() || null,
    });
  }
};
