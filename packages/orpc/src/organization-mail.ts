import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { ORPCError } from "@orpc/server";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import {
  assertCanConsumeOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
  recordOrganizationMailUsage,
  withOrganizationMailUsageLock,
} from "@quieter/billing/organization-mail-usage";
import { serverEnv } from "@quieter/env/server";
import { z } from "zod";
import { recordOutboundManagedMessageForSender } from "./managed-mail/messages/service";
import {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "./organization-mail-policy";

export { ORGANIZATION_API_KEY_CONFIG_ID };
export { assertOrganizationOwnsVerifiedSenderDomain, OrganizationMailSendError };

export const organizationMailMessageSchema = z
  .object({
    bcc: z.array(z.email().trim()).optional(),
    cc: z.array(z.email().trim()).optional(),
    html: z.string().min(1).optional(),
    replyTo: z.array(z.email().trim()).optional(),
    sender: z.email().trim(),
    subject: z.string().trim().min(1),
    text: z.string().min(1).optional(),
    to: z.array(z.email().trim()).min(1),
  })
  .refine((input) => !!(input.html || input.text), {
    message: "Either text or html is required.",
    path: ["text"],
  });

export type OrganizationMailMessageInput = z.infer<typeof organizationMailMessageSchema>;

const normalizeAddresses = (addresses: string[] | undefined) =>
  Array.from(
    new Set((addresses ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean)),
  );

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

export const sendOrganizationMailMessage = async (input: {
  message: OrganizationMailMessageInput;
  organizationId: string;
}) => {
  const usageEstimate = estimateOutboundOrganizationMailUsage(input.message);

  return await withOrganizationMailUsageLock(input.organizationId, async () => {
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
      sender: input.message.sender,
    });

    const { SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const client = await getSesv2Client();
    const response = await client.send(
      new SendEmailCommand({
        Content: {
          Simple: {
            Body: {
              ...(input.message.html
                ? {
                    Html: {
                      Charset: "UTF-8",
                      Data: input.message.html,
                    },
                  }
                : {}),
              ...(input.message.text
                ? {
                    Text: {
                      Charset: "UTF-8",
                      Data: input.message.text,
                    },
                  }
                : {}),
            },
            Subject: {
              Charset: "UTF-8",
              Data: input.message.subject,
            },
          },
        },
        Destination: {
          BccAddresses: normalizeAddresses(input.message.bcc),
          CcAddresses: normalizeAddresses(input.message.cc),
          ToAddresses: normalizeAddresses(input.message.to),
        },
        FromEmailAddress: input.message.sender.trim().toLowerCase(),
        ReplyToAddresses: normalizeAddresses(input.message.replyTo),
      }),
    );

    if (response.MessageId) {
      await Promise.all([
        recordOutboundManagedMessageForSender({
          bcc: normalizeAddresses(input.message.bcc),
          bodyHtml: input.message.html,
          bodyText: input.message.text,
          cc: normalizeAddresses(input.message.cc),
          organizationId: input.organizationId,
          providerMessageId: response.MessageId,
          replyTo: normalizeAddresses(input.message.replyTo),
          sender: input.message.sender.trim().toLowerCase(),
          subject: input.message.subject,
          to: normalizeAddresses(input.message.to),
        }),
        recordOrganizationMailUsage({
          ...usageEstimate,
          metadata: {
            sender: input.message.sender.trim().toLowerCase(),
          },
          organizationId: input.organizationId,
          providerMessageId: response.MessageId,
        }).catch((error) => {
          console.error("Failed to record organization mail usage after send.", {
            error,
            organizationId: input.organizationId,
            providerMessageId: response.MessageId,
          });
        }),
      ]);
    }

    return {
      messageId: response.MessageId ?? null,
      sent: true,
    };
  });
};
