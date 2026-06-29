import type {
  EmailAddress,
  EmailAttachment,
  EmailMessage,
  EmailProvider,
  EmailProviderContext,
} from "@opencoredev/email-sdk";
import {
  Quieter,
  type QuieterAttachment,
  type QuieterOptions,
  type QuieterSendInput,
} from "./index";

export type QuieterEmailSdkProviderOptions = QuieterOptions & {
  name?: string;
};

export const quieter = (options: QuieterEmailSdkProviderOptions): EmailProvider<Quieter> => {
  const client = new Quieter(options);
  const name = options.name ?? "quieter";

  return {
    name,
    raw: client,
    send: async (message: EmailMessage, context: EmailProviderContext) => {
      const result = await client.send(toQuieterMessage(message, context), {
        idempotencyKey: context.idempotencyKey,
        signal: context.signal,
      });

      return {
        id: result.messageId ?? undefined,
        messageId: result.messageId ?? undefined,
        provider: name,
        raw: result,
      };
    },
  };
};

const toQuieterMessage = (
  message: EmailMessage,
  context: EmailProviderContext,
): QuieterSendInput => {
  const base = {
    attachments: message.attachments?.map(toQuieterAttachment),
    bcc: message.bcc ? toAddressList(message.bcc) : undefined,
    cc: message.cc ? toAddressList(message.cc) : undefined,
    from: toAddress(message.from),
    headers: message.headers,
    idempotencyKey: message.idempotencyKey ?? context.idempotencyKey,
    metadata: normalizeMetadata(message.metadata),
    replyTo: message.replyTo ? toAddressList(message.replyTo) : undefined,
    subject: message.subject,
    tags: message.tags,
    to: toAddressList(message.to),
  };

  if (message.html) return { ...base, html: message.html, text: message.text };
  if (message.text) return { ...base, text: message.text };

  throw new Error("Quieter email-sdk adapter requires html or text content.");
};

const toAddressList = (value: EmailAddress | EmailAddress[]) =>
  (Array.isArray(value) ? value : [value]).map(toAddress);

const toAddress = (value: EmailAddress) =>
  typeof value === "string" ? value : value.name ? `${value.name} <${value.email}>` : value.email;

const toQuieterAttachment = (attachment: EmailAttachment): QuieterAttachment => {
  if (attachment.path) {
    throw new Error("Quieter email-sdk adapter does not support attachment paths.");
  }

  if (attachment.content == null) {
    throw new Error("Quieter email-sdk adapter requires attachment content.");
  }

  return {
    content: attachment.content,
    contentEncoding: attachment.contentEncoding,
    contentId: attachment.contentId,
    contentType: attachment.contentType,
    disposition: attachment.disposition,
    filename: attachment.filename,
  };
};

const normalizeMetadata = (metadata: EmailMessage["metadata"]) => {
  if (!metadata) return undefined;

  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        ["boolean", "number", "string"].includes(typeof entry[1]) || entry[1] === null,
    ),
  );
};
