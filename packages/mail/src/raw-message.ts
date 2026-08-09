import PostalMime from "postal-mime";
import type { Address, Email } from "postal-mime";

export type ParsedRawMailMessage = {
  attachments: {
    contentId?: string;
    fileName: string;
    inline: boolean;
    mimeType: string;
    size: number;
  }[];
  bcc?: string;
  bodyHtml?: string;
  bodyText?: string;
  cc?: string;
  date?: Date;
  from: string;
  headers: { name: string; value: string }[];
  inReplyTo?: string;
  messageHeaderId?: string;
  references?: string;
  replyTo?: string;
  snippet?: string;
  subject?: string;
  to?: string;
};

export type ParsedRawMailAttachment = {
  content: Uint8Array;
  contentId?: string;
  fileName: string;
  inline: boolean;
  mimeType: string;
};

const toOptionalTrimmed = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
};

const formatMailbox = (mailbox: { address: string; name: string }) => {
  const name = mailbox.name.trim();
  if (name.length === 0) {
    return mailbox.address;
  }
  return `"${name.replaceAll('"', '\\"')}" <${mailbox.address}>`;
};

const flattenAddress = (address: Address): string[] =>
  address.group ? address.group.map(formatMailbox) : [formatMailbox(address)];

const formatAddresses = (addresses: Address[] | undefined) => {
  const value =
    addresses === undefined
      ? ""
      : addresses.flatMap(flattenAddress).join(", ").trim();
  return value.length > 0 ? value : undefined;
};

const formatAddress = (address: Address | undefined): string | undefined => {
  if (address === undefined) {
    return undefined;
  }

  const value = flattenAddress(address).join(", ").trim();
  return value.length > 0 ? value : undefined;
};

const normalizeBody = (value: string | undefined) => toOptionalTrimmed(value);

const createSnippet = (email: Email) => {
  const source =
    email.text ??
    email.html
      ?.replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replaceAll(/<[^>]+>/gu, " ");
  const normalized = source?.replaceAll(/\s+/gu, " ").trim();
  return normalized !== undefined && normalized.length > 0
    ? normalized.slice(0, 240)
    : undefined;
};

export const parseRawMailMessage = async (
  rawMessage: string | ArrayBuffer | Uint8Array | Buffer
): Promise<ParsedRawMailMessage> => {
  const email = await PostalMime.parse(rawMessage);
  const from = formatAddress(email.from) ?? formatAddress(email.sender);

  if (from === undefined) {
    throw new Error("Mail message does not contain a sender.");
  }

  const parsedDate =
    email.date !== undefined && email.date.length > 0
      ? new Date(email.date)
      : undefined;

  return {
    attachments: email.attachments.map((attachment, index) => ({
      contentId: toOptionalTrimmed(attachment.contentId),
      fileName:
        toOptionalTrimmed(attachment.filename ?? undefined) ??
        `attachment-${index + 1}`,
      inline: attachment.disposition === "inline",
      mimeType:
        toOptionalTrimmed(attachment.mimeType) ?? "application/octet-stream",
      size:
        typeof attachment.content === "string"
          ? new TextEncoder().encode(attachment.content).byteLength
          : attachment.content.byteLength,
    })),
    bcc: formatAddresses(email.bcc),
    bodyHtml: normalizeBody(email.html),
    bodyText: normalizeBody(email.text),
    cc: formatAddresses(email.cc),
    date:
      parsedDate !== undefined && !Number.isNaN(parsedDate.getTime())
        ? parsedDate
        : undefined,
    from,
    headers: email.headers.map((header) => ({
      name: header.originalKey,
      value: header.value,
    })),
    inReplyTo: toOptionalTrimmed(email.inReplyTo),
    messageHeaderId: toOptionalTrimmed(email.messageId),
    references: toOptionalTrimmed(email.references),
    replyTo: formatAddresses(email.replyTo),
    snippet: createSnippet(email),
    subject: toOptionalTrimmed(email.subject),
    to: formatAddresses(email.to),
  };
};

export const parseRawMailAttachments = async (
  rawMessage: string | ArrayBuffer | Uint8Array | Buffer
): Promise<ParsedRawMailAttachment[]> => {
  const email = await PostalMime.parse(rawMessage);
  return email.attachments.map((attachment, index) => ({
    content:
      typeof attachment.content === "string"
        ? new TextEncoder().encode(attachment.content)
        : new Uint8Array(attachment.content),
    contentId: toOptionalTrimmed(attachment.contentId),
    fileName:
      toOptionalTrimmed(attachment.filename ?? undefined) ??
      `attachment-${index + 1}`,
    inline: attachment.disposition === "inline",
    mimeType:
      toOptionalTrimmed(attachment.mimeType) ?? "application/octet-stream",
  }));
};
