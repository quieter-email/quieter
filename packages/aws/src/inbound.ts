import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  buildMailObjectKey,
  createMailMessage,
  findMailDomainByRecipients,
  findMailMessageByProviderMessageId,
} from "@quietr/orpc/mail-service";
import { z } from "zod";
import {
  getBearerToken,
  parseEventJson,
  readConfiguredEnv,
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
  .refine((input) => Boolean(input.rawMime || input.rawMimeBase64), {
    message: "Either rawMime or rawMimeBase64 is required.",
    path: ["rawMime"],
  });

const getInboundToken = () => {
  const token = readConfiguredEnv(
    "MAIL_INGEST_TOKEN",
    "EMAIL_INGEST_TOKEN",
    "MANAGED_MAIL_INGEST_TOKEN",
  );

  if (!token) {
    throw new Error("MAIL_INGEST_TOKEN environment variable is missing.");
  }

  return token;
};

let s3Client: S3Client | null = null;

const getS3Client = () => {
  s3Client ??= new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  });

  return s3Client;
};

const toNormalizedRecipients = (recipients: string[]) =>
  Array.from(
    new Set(recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean)),
  );

const getRawMimeBytes = (input: z.infer<typeof inboundPayloadSchema>) =>
  input.rawMimeBase64
    ? Buffer.from(input.rawMimeBase64, "base64")
    : Buffer.from(input.rawMime ?? "", "utf8");

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

    if (!bearerToken || bearerToken !== getInboundToken()) {
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

    const recipients = toNormalizedRecipients(parsed.data.recipients);
    const mailDomain = await findMailDomainByRecipients(recipients);

    if (!mailDomain) {
      return toJson(
        {
          error: "No active mail domain matched the recipients.",
        },
        404,
      );
    }

    const providerMessageId = parsed.data.providerMessageId?.trim() || null;
    if (providerMessageId) {
      const existingMessage = await findMailMessageByProviderMessageId({
        mailDomainId: mailDomain.id,
        providerMessageId,
      });

      if (existingMessage) {
        return toJson({
          duplicate: true,
          messageId: existingMessage.id,
          s3Bucket: existingMessage.s3Bucket,
          s3Key: existingMessage.s3Key,
          stored: false,
        });
      }
    }

    const receivedAt = parsed.data.receivedAt ?? new Date();
    const rawMimeBytes = getRawMimeBytes(parsed.data);
    const s3Key = buildMailObjectKey(mailDomain, receivedAt);

    await getS3Client().send(
      new PutObjectCommand({
        Body: rawMimeBytes,
        Bucket: mailDomain.s3Bucket,
        ContentType: "message/rfc822",
        Key: s3Key,
      }),
    );

    const storedMessage = await createMailMessage({
      mailDomainId: mailDomain.id,
      mailFrom: parsed.data.mailFrom ?? null,
      messageIdHeader: parsed.data.messageIdHeader ?? null,
      organizationId: mailDomain.organizationId,
      providerMessageId,
      rawSizeBytes: rawMimeBytes.byteLength,
      receivedAt,
      recipients,
      s3Bucket: mailDomain.s3Bucket,
      s3Key,
      subject: parsed.data.subject ?? null,
    });

    return toJson(
      {
        domain: mailDomain.domain,
        messageId: storedMessage.id,
        s3Bucket: storedMessage.s3Bucket,
        s3Key: storedMessage.s3Key,
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
