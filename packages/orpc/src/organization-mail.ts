import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { parseRawMailMessage } from "@quieter/mail/raw-message";
import { getSendEnvelopeAddress } from "@quieter/mail/send";
import type { SendMessageInput, SendMessageResult } from "@quieter/mail/send";
import { buildSendMimeMessage } from "@quieter/mail/send-mime";

import { hashMailSend, sendPreparedMail } from "./mail-send";
import {
  buildOpenTrackingHtmlTransform,
  resolveOrganizationMailOpenTracking,
} from "./organization-mail-delivery";
import { OrganizationMailSendError } from "./organization-mail-policy";

export { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
export { organizationHasBillingFeature } from "@quieter/billing/entitlements";
export {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "./organization-mail-policy";
export { sendMessageInputSchema } from "@quieter/mail/send";
export type { SendMessageInput, SendMessageResult } from "@quieter/mail/send";

export const sendOrganizationMailMessage = async (input: {
  message: SendMessageInput;
  organizationId: string;
}): Promise<SendMessageResult> => {
  const { message, organizationId } = input;
  const id = randomUUID();
  const sentAt = new Date();
  const messageHeaderId = `<${id}@${getSendEnvelopeAddress(message.from).split("@").at(1)}>`;
  const openTrackingEnabled = await resolveOrganizationMailOpenTracking({
    openTracking: message.openTracking,
    organizationId,
  });
  const built = await buildSendMimeMessage(message, {
    messageId: messageHeaderId,
    sentAt,
    ...buildOpenTrackingHtmlTransform({ messageHeaderId, openTrackingEnabled }),
  });
  const parsed = await parseRawMailMessage(built.raw);
  try {
    const result = await sendPreparedMail({
      id,
      idempotencyKey: message.idempotencyKey ?? id,
      messageHeaderId,
      organizationId,
      raw: built.raw,
      requestHash: hashMailSend(message),
      snapshot: {
        attachments: parsed.attachments.map((attachment, partIndex) => ({
          ...attachment,
          partIndex,
        })),
        bcc: built.bcc,
        bodyHtml: message.html,
        bodyText: message.text ?? "",
        cc: built.cc,
        headers: parsed.headers,
        kind: "api",
        rawSizeBytes: built.rawSizeBytes,
        replyTo: built.replyTo,
        sender: message.from,
        sentAt: sentAt.toISOString(),
        subject: message.subject,
        tags: message.tags,
        to: built.to,
      },
    });
    return {
      idempotent: result.idempotent,
      messageId: result.messageId,
      sent: result.sent,
    };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw new OrganizationMailSendError(error.message, error.status);
    }
    throw error;
  }
};
