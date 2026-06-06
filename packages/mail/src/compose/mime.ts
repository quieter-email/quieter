import { z } from "zod";
import {
  composeDraftInputSchema,
  QUIETER_DRAFT_HEADER_NAMES,
  splitMailAddressList,
} from "./schema";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

export const arrayBufferToBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

const createMimeBoundary = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

const encodeMimeHeaderValue = (value: string) => {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
};

const encodeQuotedPrintable = (value: string) => {
  const bytes = new TextEncoder().encode(value.replaceAll("\r\n", "\n"));
  let output = "";

  for (const byte of bytes) {
    const isPrintable = (byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126);
    if (isPrintable || byte === 9 || byte === 32) {
      output += String.fromCharCode(byte);
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
  return output.replace(/.{1,76}/g, "$&\r\n").trim();
};

const fileToBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

const collectRecipients = (value: string) => splitMailAddressList(value);

const collectReplyReferences = (draft: ComposeDraftInput) => {
  const values = [...(draft.replyContext?.references ?? []), draft.replyContext?.messageHeaderId];
  const seen = new Set<string>();
  const references: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    references.push(normalized);
  }

  return references;
};

const addQuieterDraftHeaders = (headers: string[], draft: ComposeDraftInput) => {
  if (!draft.draftAnchor) {
    return;
  }

  headers.push(
    `${QUIETER_DRAFT_HEADER_NAMES.sourceMessageId}: ${draft.draftAnchor.sourceMessageId}`,
  );
  headers.push(`${QUIETER_DRAFT_HEADER_NAMES.sourceThreadId}: ${draft.draftAnchor.sourceThreadId}`);
  headers.push(`${QUIETER_DRAFT_HEADER_NAMES.seededBy}: ${draft.draftAnchor.seededBy}`);

  if (draft.draftAnchor.sourceMessageHeaderId?.trim()) {
    headers.push(
      `${QUIETER_DRAFT_HEADER_NAMES.sourceMessageHeaderId}: ${draft.draftAnchor.sourceMessageHeaderId.trim()}`,
    );
  }
};

export const buildMimeMessage = async (
  draft: ComposeDraftInput,
  options?: { includeQuieterDraftHeaders?: boolean },
) => {
  const headers: string[] = [];
  const toRecipients = collectRecipients(draft.recipients.to);
  const ccRecipients = collectRecipients(draft.recipients.cc);
  const bccRecipients = collectRecipients(draft.recipients.bcc);
  const replyReferences = collectReplyReferences(draft);

  if (toRecipients.length > 0) headers.push(`To: ${toRecipients.join(", ")}`);
  if (ccRecipients.length > 0) headers.push(`Cc: ${ccRecipients.join(", ")}`);
  if (bccRecipients.length > 0) headers.push(`Bcc: ${bccRecipients.join(", ")}`);
  if (draft.subject.trim()) headers.push(`Subject: ${encodeMimeHeaderValue(draft.subject)}`);
  if (draft.replyContext?.messageHeaderId) {
    headers.push(`In-Reply-To: ${draft.replyContext.messageHeaderId}`);
  }
  if (replyReferences.length > 0) {
    headers.push(`References: ${replyReferences.join(" ")}`);
  }
  if (options?.includeQuieterDraftHeaders) {
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

  const inlineImageParts = (
    await Promise.all(
      draft.inlineImages.map(async (inlineImage) => {
        if (!inlineImage.file) {
          return null;
        }

        return [
          `--${relatedBoundary}`,
          `Content-Type: ${inlineImage.mimeType}; name="${inlineImage.name}"`,
          `Content-Disposition: inline; filename="${inlineImage.name}"`,
          "Content-Transfer-Encoding: base64",
          `Content-ID: <${inlineImage.contentId}>`,
          "",
          base64WithCrlf(await fileToBytes(inlineImage.file)),
        ].join("\r\n");
      }),
    )
  ).filter((part): part is string => !!part);

  const htmlBody = draft.bodyHtml || "<p></p>";
  const htmlPart =
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

  let body = [textPart, htmlPart, `--${alternativeBoundary}--`].join("\r\n");
  let contentType = `multipart/alternative; boundary="${alternativeBoundary}"`;

  const attachments = (
    await Promise.all(
      draft.attachments
        .filter((attachment) => !attachment.isInline)
        .map(async (attachment) => {
          if (!attachment.file) {
            return null;
          }

          return [
            `--${mixedBoundary}`,
            `Content-Type: ${attachment.mimeType}; name="${attachment.name}"`,
            `Content-Disposition: attachment; filename="${attachment.name}"`,
            "Content-Transfer-Encoding: base64",
            "",
            base64WithCrlf(await fileToBytes(attachment.file)),
          ].join("\r\n");
        }),
    )
  ).filter((part): part is string => !!part);

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
}) => {
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
