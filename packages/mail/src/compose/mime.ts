import type { z } from "zod";

import type { composeDraftInputSchema } from "./schema";
import { QUIETER_DRAFT_HEADER_NAMES, splitMailAddressList } from "./schema";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary);
};

export const arrayBufferToBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll(/=+$/gu, "");

const createMimeBoundary = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

const encodeMimeHeaderValue = (value: string) => {
  if (/^[\u0020-\u007E]*$/u.test(value)) {
    return value;
  }

  const encoder = new TextEncoder();
  const encodedWords: string[] = [];
  let chunk: number[] = [];
  for (const character of value) {
    const bytes = encoder.encode(character);
    if (chunk.length > 0 && chunk.length + bytes.length > 36) {
      encodedWords.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length > 0) {
    encodedWords.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
  }
  return encodedWords.join(" ");
};

const escapeMimeParameter = (value: string) =>
  value.replaceAll(/["\\\r\n]/gu, "_");

const normalizeMimeType = (value: string) =>
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(value)
    ? value
    : "application/octet-stream";

const foldMimeHeader = (name: string, value: string) => {
  const fieldName = `${name}:`;
  if (!value) {
    return fieldName;
  }
  if (`${fieldName} ${value}`.length <= 78) {
    return `${fieldName} ${value}`;
  }

  const folded: string[] = [];
  let prefix = `${fieldName} `;
  let remaining = value;
  while (remaining.length > 0) {
    if (prefix.length >= 78) {
      folded.push(prefix.trimEnd());
      prefix = " ";
      continue;
    }

    const available = 78 - prefix.length;
    if (remaining.length <= available) {
      folded.push(`${prefix}${remaining}`);
      break;
    }

    const preferredBreak = remaining.lastIndexOf(" ", available);
    if (preferredBreak <= 0 && prefix !== " " && remaining.startsWith("=?")) {
      folded.push(prefix.trimEnd());
      prefix = " ";
      continue;
    }
    const breakAt = preferredBreak > 0 ? preferredBreak : available;
    folded.push(`${prefix}${remaining.slice(0, breakAt)}`);
    remaining = remaining.slice(breakAt).trimStart();
    prefix = " ";
  }

  return folded.join("\r\n");
};

const encodeQuotedPrintable = (value: string) => {
  const bytes = new TextEncoder().encode(value.replaceAll("\r\n", "\n"));
  let output = "";

  for (const byte of bytes) {
    const isPrintable =
      (byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126);
    if (isPrintable || byte === 9 || byte === 32) {
      output += String.fromCodePoint(byte);
    } else if (byte === 10) {
      output += "\r\n";
    } else {
      output += `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }

  return output;
};

const base64WithCrlf = (value: Uint8Array) => {
  const output = bytesToBase64(value);
  return output.replaceAll(/.{1,76}/gu, "$&\r\n").trim();
};

const fileToBytes = async (file: File) =>
  new Uint8Array(await file.arrayBuffer());

const collectRecipients = (value: string) => splitMailAddressList(value);

const collectReplyReferences = (draft: ComposeDraftInput) => {
  const values = [
    ...(draft.replyContext?.references ?? []),
    draft.replyContext?.messageHeaderId,
  ];
  const seen = new Set<string>();
  const references: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (
      normalized === undefined ||
      normalized.length === 0 ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    references.push(normalized);
  }

  return references;
};

const addQuieterDraftHeaders = (
  headers: string[],
  draft: ComposeDraftInput
) => {
  if (!draft.draftAnchor) {
    return;
  }

  headers.push(
    `${QUIETER_DRAFT_HEADER_NAMES.sourceMessageId}: ${draft.draftAnchor.sourceMessageId}`,
    `${QUIETER_DRAFT_HEADER_NAMES.sourceThreadId}: ${draft.draftAnchor.sourceThreadId}`,
    `${QUIETER_DRAFT_HEADER_NAMES.seededBy}: ${draft.draftAnchor.seededBy}`
  );

  const sourceMessageHeaderId = draft.draftAnchor.sourceMessageHeaderId?.trim();
  if ((sourceMessageHeaderId ?? "") !== "") {
    headers.push(
      `${QUIETER_DRAFT_HEADER_NAMES.sourceMessageHeaderId}: ${sourceMessageHeaderId}`
    );
  }
};

const appendRecipientHeaders = (
  headers: string[],
  draft: ComposeDraftInput,
  options?: {
    from?: string;
    omitBccHeader?: boolean;
  }
) => {
  const toRecipients = collectRecipients(draft.recipients.to);
  const ccRecipients = collectRecipients(draft.recipients.cc);
  const bccRecipients = collectRecipients(draft.recipients.bcc);

  const from = options?.from?.trim();
  if ((from ?? "") !== "") {
    headers.push(`From: ${from}`);
  }
  if (toRecipients.length > 0) {
    headers.push(`To: ${toRecipients.join(", ")}`);
  }
  if (ccRecipients.length > 0) {
    headers.push(`Cc: ${ccRecipients.join(", ")}`);
  }
  if (bccRecipients.length > 0 && options?.omitBccHeader !== true) {
    headers.push(`Bcc: ${bccRecipients.join(", ")}`);
  }
};

const appendMetadataHeaders = (
  headers: string[],
  draft: ComposeDraftInput,
  options?: {
    messageId?: string;
    sentAt?: Date;
  }
) => {
  const replyReferences = collectReplyReferences(draft);

  if (draft.subject.trim()) {
    headers.push(`Subject: ${encodeMimeHeaderValue(draft.subject)}`);
  }
  const messageId = options?.messageId?.trim();
  if ((messageId ?? "") !== "") {
    headers.push(`Message-ID: ${messageId}`);
  }
  if (options?.sentAt !== undefined) {
    headers.push(`Date: ${options.sentAt.toUTCString()}`);
  }
  const inReplyTo = draft.replyContext?.messageHeaderId;
  if ((inReplyTo ?? "") !== "") {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (replyReferences.length > 0) {
    headers.push(`References: ${replyReferences.join(" ")}`);
  }
  for (const header of draft.headers ?? []) {
    headers.push(
      foldMimeHeader(
        header.name.trim(),
        encodeMimeHeaderValue(header.value.trim())
      )
    );
  }
};

const buildInlineImagePart = async (
  inlineImage: ComposeDraftInput["inlineImages"][number],
  relatedBoundary: string
): Promise<string | null> => {
  if (inlineImage.file === undefined || inlineImage.file === null) {
    return null;
  }

  const fileBytes = await fileToBytes(inlineImage.file);
  return [
    `--${relatedBoundary}`,
    `Content-Type: ${normalizeMimeType(inlineImage.mimeType)}; name="${escapeMimeParameter(
      inlineImage.name
    )}"`,
    `Content-Disposition: inline; filename="${escapeMimeParameter(inlineImage.name)}"`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${inlineImage.contentId.replaceAll(/[<>\r\n]/gu, "")}>`,
    "",
    base64WithCrlf(fileBytes),
  ].join("\r\n");
};

const buildAttachmentPart = async (
  attachment: ComposeDraftInput["attachments"][number],
  mixedBoundary: string
): Promise<string | null> => {
  if (attachment.file === undefined || attachment.file === null) {
    return null;
  }

  const fileBytes = await fileToBytes(attachment.file);
  return [
    `--${mixedBoundary}`,
    `Content-Type: ${normalizeMimeType(attachment.mimeType)}; name="${escapeMimeParameter(
      attachment.name
    )}"`,
    `Content-Disposition: attachment; filename="${escapeMimeParameter(attachment.name)}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64WithCrlf(fileBytes),
  ].join("\r\n");
};

const buildHtmlAlternativePart = (
  htmlBody: string,
  inlineImageParts: string[],
  alternativeBoundary: string,
  relatedBoundary: string
) =>
  inlineImageParts.length > 0
    ? [
        `--${alternativeBoundary}`,
        `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
        "",
        `--${relatedBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: quoted-printable",
        "",
        encodeQuotedPrintable(htmlBody),
        ...inlineImageParts,
        `--${relatedBoundary}--`,
      ].join("\r\n")
    : [
        `--${alternativeBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: quoted-printable",
        "",
        encodeQuotedPrintable(htmlBody),
      ].join("\r\n");

export const buildMimeMessage = async (
  draft: ComposeDraftInput,
  options?: {
    from?: string;
    htmlTransform?: (html: string) => string;
    includeQuieterDraftHeaders?: boolean;
    messageId?: string;
    omitBccHeader?: boolean;
    sentAt?: Date;
  }
): Promise<string> => {
  const headers: string[] = [];

  appendRecipientHeaders(headers, draft, options);
  appendMetadataHeaders(headers, draft, options);
  if (options?.includeQuieterDraftHeaders === true) {
    addQuieterDraftHeaders(headers, draft);
  }
  headers.push("MIME-Version: 1.0");

  const alternativeBoundary = createMimeBoundary("alt");
  const relatedBoundary = createMimeBoundary("rel");
  const mixedBoundary = createMimeBoundary("mix");

  const textPart = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(draft.bodyText || ""),
  ].join("\r\n");

  const inlineImageResults = await Promise.all(
    draft.inlineImages.map(
      async (inlineImage) =>
        await buildInlineImagePart(inlineImage, relatedBoundary)
    )
  );
  const inlineImageParts = inlineImageResults.filter(
    (part): part is string => part !== null
  );

  const htmlBody =
    options?.htmlTransform !== undefined && draft.bodyHtml !== ""
      ? options.htmlTransform(draft.bodyHtml || "<p></p>")
      : draft.bodyHtml || "<p></p>";
  const htmlPart = buildHtmlAlternativePart(
    htmlBody,
    inlineImageParts,
    alternativeBoundary,
    relatedBoundary
  );

  let body = [textPart, htmlPart, `--${alternativeBoundary}--`].join("\r\n");
  let contentType = `multipart/alternative; boundary="${alternativeBoundary}"`;

  const attachmentResults = await Promise.all(
    draft.attachments
      .filter((attachment) => !attachment.isInline)
      .map(
        async (attachment) =>
          await buildAttachmentPart(attachment, mixedBoundary)
      )
  );
  const attachments = attachmentResults.filter(
    (part): part is string => part !== null
  );

  if (attachments.length > 0) {
    body = [
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}`,
      "",
      body,
      ...attachments,
      `--${mixedBoundary}--`,
    ].join("\r\n");
    contentType = `multipart/mixed; boundary="${mixedBoundary}"`;
  }

  return [...headers, `Content-Type: ${contentType}`, "", body].join("\r\n");
};

export const buildPlainTextMessage = ({
  body,
  subject,
  to,
}: {
  body: string;
  subject: string;
  to: string;
}): string => {
  const headers = [`To: ${to}`];

  if (subject.trim()) {
    headers.push(`Subject: ${encodeMimeHeaderValue(subject)}`);
  }

  return [
    ...headers,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(body),
  ].join("\r\n");
};
