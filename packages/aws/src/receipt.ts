import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { recordInboundOrganizationMailUsage } from "@quieter/billing/organization-mail-usage";
import { serverEnv } from "@quieter/env/server";
import { recordInboundManagedMessage } from "@quieter/orpc/managed-mail/ingestion";
import { Resource } from "sst";
import { deleteMailObjectUnlessTracked } from "./mail-object-retention";

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

let s3Client: S3Client | null = null;

const getS3Client = () => {
  s3Client ??= new S3Client({
    region: serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION,
  });

  return s3Client;
};

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

    const recipients = normalizeRecipients(
      notification.receipt?.recipients?.length
        ? notification.receipt.recipients
        : (notification.mail?.destination ?? []),
    );
    try {
      const headObject = await getS3Client().send(
        new HeadObjectCommand({
          Bucket: Resource.MailBucket.name,
          Key: s3Key,
        }),
      );
      const messageSizeBytes = headObject.ContentLength ?? 0;
      const object = await getS3Client().send(
        new GetObjectCommand({
          Bucket: Resource.MailBucket.name,
          Key: s3Key,
        }),
      );
      if (!object.Body) {
        throw new Error("The stored inbound message body is missing.");
      }
      const rawMessage = Buffer.from(await object.Body.transformToByteArray());
      const receivedAt = new Date(
        notification.receipt?.timestamp || notification.mail?.timestamp || Date.now(),
      );

      const mailboxIds = await recordInboundManagedMessage({
        providerMessageId,
        rawMessage,
        rawSizeBytes: messageSizeBytes,
        receivedAt,
        recipients,
        s3Bucket: Resource.MailBucket.name,
        s3Key,
      });
      const stored = await deleteMailObjectUnlessTracked({
        bucket: Resource.MailBucket.name,
        key: s3Key,
        s3Client: getS3Client(),
      });
      await recordInboundOrganizationMailUsage({
        messageSizeBytes,
        providerMessageId,
        recipients,
      });

      console.info("Processed SES receipt notification.", {
        mailFrom: notification.mail?.source?.trim() || null,
        mailboxIds,
        messageIdHeader: notification.mail?.commonHeaders?.messageId?.trim() || null,
        providerMessageId,
        receivedAt,
        recipients,
        s3Bucket: Resource.MailBucket.name,
        s3Key,
        stored,
        subject: notification.mail?.commonHeaders?.subject?.trim() || null,
      });
    } catch (error) {
      console.error("Failed to process SES receipt record.", {
        error,
        providerMessageId,
        recipients,
        s3Key,
      });
      throw error;
    }
  }
};
