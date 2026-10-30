import MailComposer from "nodemailer/lib/mail-composer";

import { serializeOtpToken } from "./otp-token";
import {
  getSendEnvelopeAddress,
  getSendEnvelopeAddressList,
  normalizeSendHeaders,
  sendAttachmentListResourcesSchema,
} from "./send";
import type { SendHeader, SendMessageInput } from "./send";

type BuiltSendMimeMessage = {
  attachmentSizeBytes: number;
  attachments: {
    contentId?: string | null;
    fileName: string;
    inline: boolean;
    mimeType: string;
    size: number;
  }[];
  bcc: string[];
  cc: string[];
  fromAddress: string;
  headers: SendHeader[];
  messageHeaderId: string;
  raw: string;
  rawSizeBytes: number;
  replyTo: string[];
  to: string[];
};

export const buildSendMimeMessage = async (
  message: SendMessageInput,
  options?: {
    htmlTransform?: (html: string) => string;
    messageId?: string;
    sentAt?: Date;
  }
): Promise<BuiltSendMimeMessage> => {
  sendAttachmentListResourcesSchema.parse(message.attachments);
  const fromAddress = getSendEnvelopeAddress(message.from);
  const domain = fromAddress.split("@").at(1) ?? "quieter.email";
  const messageHeaderId =
    options?.messageId ?? `<${crypto.randomUUID()}@${domain}>`;
  const headers = normalizeSendHeaders(message.headers);
  if (message.otpToken) {
    headers.push({
      name: "OTP-Token",
      value: serializeOtpToken(message.otpToken),
    });
  }
  const attachments = message.attachments.map((attachment) => ({
    bytes: Buffer.from(attachment.content, "base64"),
    contentId: attachment.contentId ?? null,
    fileName: attachment.filename,
    inline: attachment.disposition === "inline",
    mimeType: attachment.contentType,
  }));
  const raw = await new MailComposer({
    attachments: attachments.map((attachment) => ({
      cid: attachment.contentId ?? undefined,
      content: attachment.bytes,
      contentDisposition: attachment.inline ? "inline" : "attachment",
      contentType: attachment.mimeType,
      filename: attachment.fileName,
    })),
    cc: message.cc,
    date: options?.sentAt ?? new Date(),
    disableFileAccess: true,
    disableUrlAccess: true,
    from: message.from,
    headers: headers.map(({ name, value }) => ({
      key: name,
      value:
        name.toLowerCase() === "otp-token"
          ? { foldLines: true, prepared: true, value }
          : value,
    })),
    html:
      options?.htmlTransform && message.html !== undefined
        ? options.htmlTransform(message.html)
        : message.html,
    messageId: messageHeaderId,
    newline: "\r\n",
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    to: message.to,
  })
    .compile()
    .build();
  return {
    attachmentSizeBytes: attachments.reduce(
      (total, attachment) => total + attachment.bytes.byteLength,
      0
    ),
    attachments: attachments.map(({ bytes, ...attachment }) => ({
      ...attachment,
      size: bytes.byteLength,
    })),
    bcc: getSendEnvelopeAddressList(message.bcc),
    cc: getSendEnvelopeAddressList(message.cc),
    fromAddress,
    headers,
    messageHeaderId,
    raw: raw.toString("utf-8"),
    rawSizeBytes: raw.byteLength,
    replyTo: getSendEnvelopeAddressList(message.replyTo),
    to: getSendEnvelopeAddressList(message.to),
  };
};
