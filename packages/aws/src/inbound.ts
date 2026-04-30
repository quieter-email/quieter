import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import { z } from "zod";
import {
  getBearerToken,
  parseEventJson,
  toJson,
  type LambdaFunctionUrlEvent,
  type LambdaFunctionUrlResponse,
} from "./function-url";

const inboundPayloadSchema = z
  .object({
    mailFrom: z.string().trim().min(1).nullish(),
    messageIdHeader: z.string().trim().min(1).nullish(),
    providerMessageId: z.string().trim().min(1).nullish(),
    rawMime: z.string().min(1).optional(),
    rawMimeBase64: z.string().min(1).optional(),
    receivedAt: z.coerce.date().optional(),
    recipients: z.array(z.string().trim().min(3)).min(1),
    subject: z.string().trim().min(1).nullish(),
  })
  .refine((input) => !!(input.rawMime || input.rawMimeBase64), {
    message: "Either rawMime or rawMimeBase64 is required.",
    path: ["rawMime"],
  });

let s3Client: S3Client | null = null;

const getS3Client = () => {
  s3Client ??= new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  });

  return s3Client;
};

const getMailObjectKey = (receivedAt: Date) =>
  `mail/inbound/${String(receivedAt.getUTCFullYear())}/${String(
    receivedAt.getUTCMonth() + 1,
  ).padStart(
    2,
    "0",
  )}/${String(receivedAt.getUTCDate()).padStart(2, "0")}/${crypto.randomUUID()}.eml`;

export const handler = async (
  event: LambdaFunctionUrlEvent,
): Promise<LambdaFunctionUrlResponse> => {
  try {
    const method = event.requestContext?.http?.method?.toUpperCase();

    if (method !== "POST") {
      return toJson(
        {
          error: "Method not allowed",
        },
        405,
      );
    }

    const bearerToken = getBearerToken(event.headers);

    if (!bearerToken || bearerToken !== Resource.MailIngestToken.value) {
      return toJson(
        {
          error: "Unauthorized",
        },
        401,
      );
    }

    const parsed = inboundPayloadSchema.safeParse(parseEventJson(event));

    if (!parsed.success) {
      return toJson(
        {
          error: "Invalid inbound payload",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    await getS3Client().send(
      new PutObjectCommand({
        Body: parsed.data.rawMimeBase64
          ? Buffer.from(parsed.data.rawMimeBase64, "base64")
          : Buffer.from(parsed.data.rawMime ?? "", "utf8"),
        Bucket: Resource.MailBucket.name,
        ContentType: "message/rfc822",
        Key: getMailObjectKey(parsed.data.receivedAt ?? new Date()),
      }),
    );

    return toJson(
      {
        providerMessageId: parsed.data.providerMessageId?.trim() || null,
        recipients: Array.from(
          new Set(
            parsed.data.recipients
              .map((recipient) => recipient.trim().toLowerCase())
              .filter(Boolean),
          ),
        ),
        s3Bucket: Resource.MailBucket.name,
        s3Key: getMailObjectKey(parsed.data.receivedAt ?? new Date()),
        stored: true,
      },
      201,
    );
  } catch (error) {
    console.error(error);

    return toJson(
      {
        error: "Could not ingest the mail message.",
      },
      500,
    );
  }
};
