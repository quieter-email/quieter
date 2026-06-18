import PostalMime, { type Address, type Email } from "postal-mime";

export type ParsedRawMailMessage = {
  attachments: Array<{
    contentId?: string;
    fileName: string;
    inline: boolean;
    mimeType: string;
    size: number;
  }>;
  bcc?: string;
  bodyHtml?: string;
  bodyText?: string;
  cc?: string;
  date?: Date;
  from: string;
  headers: Array<{ name: string; value: string }>;
  inReplyTo?: string;
  messageHeaderId?: string;
  references?: string;
  replyTo?: string;
  snippet?: string;
  subject?: string;
  to?: string;
};

const formatMailbox = (mailbox: { address: string; name: string }) => {
  const name = mailbox.name.trim();
  if (!name) return mailbox.address;
  return `"${name.replaceAll('"', '\\"')}" <${mailbox.address}>`;
};

const flattenAddress = (address: Address): string[] =>
  address.group ? address.group.map(formatMailbox) : [formatMailbox(address)];

const formatAddresses = (addresses: Address[] | undefined) => {
  const value = addresses?.flatMap(flattenAddress).join(", ").trim();
  return value || undefined;
};

const formatAddress = (address: Address | undefined) => {
  if (!address) return undefined;
  return flattenAddress(address).join(", ") || undefined;
};

const normalizeBody = (value: string | undefined) => value?.trim() || undefined;

const createSnippet = (email: Email) => {
  const source =
    email.text ??
    email.html
      ?.replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replaceAll(/<[^>]+>/g, " ");
  const normalized = source?.replaceAll(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
};

export const parseRawMailMessage = async (
  rawMessage: string | ArrayBuffer | Uint8Array | Buffer,
): Promise<ParsedRawMailMessage> => {
  const email = await PostalMime.parse(rawMessage);
  const from = formatAddress(email.from) ?? formatAddress(email.sender);

  if (!from) {
    throw new Error("Mail message does not contain a sender.");
  }

  const parsedDate = email.date ? new Date(email.date) : undefined;

  return {
    attachments: email.attachments.map((attachment, index) => ({
      contentId: attachment.contentId?.trim() || undefined,
      fileName: attachment.filename?.trim() || `attachment-${index + 1}`,
      inline: attachment.disposition === "inline",
      mimeType: attachment.mimeType || "application/octet-stream",
      size:
        typeof attachment.content === "string"
          ? new TextEncoder().encode(attachment.content).byteLength
          : attachment.content.byteLength,
    })),
    bcc: formatAddresses(email.bcc),
    bodyHtml: normalizeBody(email.html),
    bodyText: normalizeBody(email.text),
    cc: formatAddresses(email.cc),
    date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined,
    from,
    headers: email.headers.map((header) => ({
      name: header.originalKey,
      value: header.value,
    })),
    inReplyTo: email.inReplyTo?.trim() || undefined,
    messageHeaderId: email.messageId?.trim() || undefined,
    references: email.references?.trim() || undefined,
    replyTo: formatAddresses(email.replyTo),
    snippet: createSnippet(email),
    subject: email.subject?.trim() || undefined,
    to: formatAddresses(email.to),
  };
};
