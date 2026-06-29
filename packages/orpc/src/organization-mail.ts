import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { ORPCError } from "@orpc/server";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import {
  assertCanConsumeOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
  recordOrganizationMailUsage,
  withOrganizationMailUsageLock,
} from "@quieter/billing/organization-mail-usage";
import { db, organizationMailSendIdempotency } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import {
  buildSendMimeMessage,
  getSendEnvelopeAddress,
  sendMessageInputSchema,
  type SendMessageInput,
  type SendMessageResult,
} from "@quieter/mail/send";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { recordOutboundManagedMessageForSender } from "./managed-mail/messages/service";
import {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "./organization-mail-policy";

export { ORGANIZATION_API_KEY_CONFIG_ID };
export { assertOrganizationOwnsVerifiedSenderDomain, OrganizationMailSendError };
export { sendMessageInputSchema };
export type { SendMessageInput, SendMessageResult };

const getAwsRegion = () => {
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;

  if (!region) {
    throw new OrganizationMailSendError("Mail sending is temporarily unavailable.", 500);
  }

  return region;
};

let sesv2Client: SESv2Client | null = null;

const getSesv2Client = async (): Promise<SESv2Client> => {
  const { SESv2Client } = await import("@aws-sdk/client-sesv2");
  sesv2Client ??= new SESv2Client({ region: getAwsRegion() });
  return sesv2Client;
};

const stableJsonStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }

  return `{${Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`)
    .join(",")}}`;
};

const createRequestHash = (message: SendMessageInput) =>
  createHash("sha256").update(stableJsonStringify(message)).digest("hex");

const getIdempotentResult = async (input: {
  idempotencyKey: string;
  organizationId: string;
  requestHash: string;
}): Promise<SendMessageResult | null> => {
  const [existing] = await db
    .select({
      requestHash: organizationMailSendIdempotency.requestHash,
      response: organizationMailSendIdempotency.response,
    })
    .from(organizationMailSendIdempotency)
    .where(
      and(
        eq(organizationMailSendIdempotency.organizationId, input.organizationId),
        eq(organizationMailSendIdempotency.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing) return null;

  if (existing.requestHash !== input.requestHash) {
    throw new OrganizationMailSendError(
      "Idempotency key was already used with a different message.",
      409,
    );
  }

  return {
    ...existing.response,
    idempotent: true,
  };
};

const persistIdempotentResult = async (input: {
  idempotencyKey: string;
  organizationId: string;
  requestHash: string;
  response: SendMessageResult;
}) => {
  const now = new Date();
  await db
    .insert(organizationMailSendIdempotency)
    .values({
      createdAt: now,
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      requestHash: input.requestHash,
      response: {
        messageId: input.response.messageId,
        sent: true,
      },
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        organizationMailSendIdempotency.organizationId,
        organizationMailSendIdempotency.idempotencyKey,
      ],
    });
};

export const sendOrganizationMailMessage = async (input: {
  message: SendMessageInput;
  organizationId: string;
}): Promise<SendMessageResult> => {
  const idempotencyKey = input.message.idempotencyKey;
  const requestHash = idempotencyKey ? createRequestHash(input.message) : null;

  return await withOrganizationMailUsageLock(input.organizationId, async () => {
    if (idempotencyKey && requestHash) {
      const idempotentResult = await getIdempotentResult({
        idempotencyKey,
        organizationId: input.organizationId,
        requestHash,
      });

      if (idempotentResult) return idempotentResult;
    }

    const sentAt = new Date();
    const builtMessage = buildSendMimeMessage(input.message, { sentAt });
    const usageEstimate = estimateOutboundOrganizationMailUsage({
      attachmentSizeBytes: builtMessage.attachmentSizeBytes,
      bcc: builtMessage.bcc,
      cc: builtMessage.cc,
      html: input.message.html,
      subject: input.message.subject,
      text: input.message.text,
      to: builtMessage.to,
    });

    try {
      await assertCanConsumeOrganizationMailUsage({
        estimate: usageEstimate,
        organizationId: input.organizationId,
      });
    } catch (error) {
      if (error instanceof ORPCError) {
        throw new OrganizationMailSendError(error.message, error.status ?? 403);
      }

      throw error;
    }

    await assertOrganizationOwnsVerifiedSenderDomain({
      organizationId: input.organizationId,
      sender: input.message.from,
    });

    const { SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const client = await getSesv2Client();
    const response = await client.send(
      new SendEmailCommand({
        Content: {
          Raw: {
            Data: new TextEncoder().encode(builtMessage.raw),
          },
        },
        Destination: {
          BccAddresses: builtMessage.bcc,
          CcAddresses: builtMessage.cc,
          ToAddresses: builtMessage.to,
        },
        EmailTags: input.message.tags.map((tag) => ({
          Name: tag.name,
          Value: tag.value,
        })),
        FromEmailAddress: builtMessage.fromAddress,
        ReplyToAddresses: builtMessage.replyTo,
      }),
    );
    const result = {
      messageId: response.MessageId ?? null,
      sent: true,
    } satisfies SendMessageResult;

    if (response.MessageId) {
      await Promise.all([
        recordOutboundManagedMessageForSender({
          attachments: builtMessage.attachments,
          bcc: builtMessage.bcc,
          bodyHtml: input.message.html,
          bodyText: input.message.text,
          cc: builtMessage.cc,
          headers: builtMessage.headers,
          messageHeaderId: builtMessage.messageHeaderId,
          organizationId: input.organizationId,
          providerMessageId: response.MessageId,
          rawSizeBytes: builtMessage.rawSizeBytes,
          replyTo: builtMessage.replyTo,
          sender: input.message.from,
          senderAddress: getSendEnvelopeAddress(input.message.from),
          sentAt,
          subject: input.message.subject,
          to: builtMessage.to,
        }),
        recordOrganizationMailUsage({
          ...usageEstimate,
          metadata: {
            sender: builtMessage.fromAddress,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
          organizationId: input.organizationId,
          providerMessageId: response.MessageId,
        }).catch((error) => {
          console.error("Failed to record team mail usage after send.", {
            error,
            organizationId: input.organizationId,
            providerMessageId: response.MessageId,
          });
        }),
      ]);
    }

    if (idempotencyKey && requestHash) {
      await persistIdempotentResult({
        idempotencyKey,
        organizationId: input.organizationId,
        requestHash,
        response: result,
      });
    }

    return result;
  });
};
