import { z } from "zod";
import { extractMailAddress } from "./compose/schema";

export const SEND_API_PATH = "/api/v1/send";

export const MAX_SEND_PAYLOAD_BYTES = 25 * 1024 * 1024;

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const STRUCTURAL_HEADER_NAMES = new Set([
  "bcc",
  "cc",
  "content-transfer-encoding",
  "content-type",
  "date",
  "from",
  "in-reply-to",
  "message-id",
  "mime-version",
  "references",
  "reply-to",
  "subject",
  "to",
]);

const jsonMetadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const sendHeaderNameSchema = z
  .string()
  .refine((name) => isSafeHeaderName(name) && !STRUCTURAL_HEADER_NAMES.has(name.toLowerCase()), {
    message: "Header name is not allowed.",
  });

const sendHeaderValueSchema = z.string().refine((value) => !hasHeaderInjection(value), {
  message: "Header values cannot contain line breaks.",
});

const addressListSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .pipe(z.array(z.string().trim().min(1)).min(1, "Add at least one recipient."));

const headerSchema = z.union([
  z.record(sendHeaderNameSchema, sendHeaderValueSchema),
  z.array(
    z.object({
      name: sendHeaderNameSchema,
      value: sendHeaderValueSchema,
    }),
  ),
]);

export const sendAttachmentSchema = z.object({
  content: z.string().min(1).refine(isValidBase64, "Attachment content must be base64 encoded."),
  contentId: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !hasHeaderInjection(value), {
      message: "Attachment content IDs cannot contain line breaks.",
    })
    .optional(),
  contentType: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !hasHeaderInjection(value), {
      message: "Attachment content types cannot contain line breaks.",
    })
    .default("application/octet-stream"),
  disposition: z.enum(["attachment", "inline"]).default("attachment"),
  filename: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !hasHeaderInjection(value), {
      message: "Attachment filenames cannot contain line breaks.",
    }),
});

export const sendTagSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string().trim(),
});

export const sendMessageInputSchema = z
  .object({
    attachments: z.array(sendAttachmentSchema).default([]),
    bcc: addressListSchema.optional(),
    cc: addressListSchema.optional(),
    from: z.string().trim().min(1),
    headers: headerSchema.optional(),
    html: z.string().min(1).optional(),
    idempotencyKey: z.string().trim().min(1).max(255).optional(),
    metadata: z.record(z.string(), jsonMetadataValueSchema).optional(),
    replyTo: addressListSchema.optional(),
    subject: z.string().trim().min(1),
    tags: z.array(sendTagSchema).default([]),
    text: z.string().min(1),
    to: addressListSchema,
  })
  .superRefine((input, ctx) => {
    const addressFields = [
      ["from", [input.from]],
      ["to", input.to],
      ["cc", input.cc ?? []],
      ["bcc", input.bcc ?? []],
      ["replyTo", input.replyTo ?? []],
    ] as const;

    for (const [field, values] of addressFields) {
      for (const value of values) {
        const address = extractMailAddress(value);
        if (!z.email().safeParse(address).success) {
          ctx.addIssue({
            code: "custom",
            message: "Enter a valid email address.",
            path: [field],
          });
        }
      }
    }
  });

export const sendMessageResultSchema = z.object({
  idempotent: z.boolean().optional(),
  messageId: z.string().nullable(),
  sent: z.literal(true),
});

export type SendAttachmentInput = z.infer<typeof sendAttachmentSchema>;
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;
export type SendTagInput = z.infer<typeof sendTagSchema>;

export type SendHeader = {
  name: string;
  value: string;
};

export type BuiltSendMimeMessage = {
  attachmentSizeBytes: number;
  attachments: Array<{
    contentId?: string | null;
    fileName: string;
    inline: boolean;
    mimeType: string;
    size: number;
  }>;
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

export const normalizeSendHeaders = (headers: SendMessageInput["headers"]): SendHeader[] => {
  if (!headers) return [];

  if (Array.isArray(headers)) {
    return headers.map((header) => ({
      name: header.name.trim(),
      value: header.value.trim(),
    }));
  }

  return Object.entries(headers).map(([name, value]) => ({
    name: name.trim(),
    value: value.trim(),
  }));
};

export const getSendEnvelopeAddress = (value: string) =>
  extractMailAddress(value).trim().toLowerCase();

export const getSendEnvelopeAddressList = (values: readonly string[] | undefined) =>
  Array.from(new Set((values ?? []).map(getSendEnvelopeAddress).filter(Boolean)));

export function isValidBase64(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    return false;
  }

  try {
    Buffer.from(normalized, "base64");
    return true;
  } catch {
    return false;
  }
}

export const buildSendMimeMessage = (
  message: SendMessageInput,
  options?: {
    messageId?: string;
    sentAt?: Date;
  },
): BuiltSendMimeMessage => {
  const sentAt = options?.sentAt ?? new Date();
  const fromAddress = getSendEnvelopeAddress(message.from);
  const domain = fromAddress.split("@").at(1) || "quieter.email";
  const messageHeaderId = options?.messageId ?? `<${crypto.randomUUID()}@${domain}>`;
  const to = getSendEnvelopeAddressList(message.to);
  const cc = getSendEnvelopeAddressList(message.cc);
  const bcc = getSendEnvelopeAddressList(message.bcc);
  const replyTo = getSendEnvelopeAddressList(message.replyTo);
  const headers = normalizeSendHeaders(message.headers);
  const attachmentRecords = message.attachments.map((attachment) => {
    const bytes = decodeBase64Bytes(attachment.content);
    return {
      bytes,
      contentId: attachment.contentId ?? null,
      fileName: attachment.filename,
      inline: attachment.disposition === "inline",
      mimeType: attachment.contentType,
      size: bytes.byteLength,
    };
  });
  const headerLines = [
    `From: ${encodeMimeHeaderValue(message.from)}`,
    `To: ${message.to.map(encodeMimeHeaderValue).join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.map(encodeMimeHeaderValue).join(", ")}`] : []),
    ...(message.replyTo?.length
      ? [`Reply-To: ${message.replyTo.map(encodeMimeHeaderValue).join(", ")}`]
      : []),
    `Subject: ${encodeMimeHeaderValue(message.subject)}`,
    `Message-ID: ${messageHeaderId}`,
    `Date: ${sentAt.toUTCString()}`,
    ...headers.map((header) => `${header.name}: ${encodeMimeHeaderValue(header.value)}`),
    "MIME-Version: 1.0",
  ];
  const inlineAttachments = attachmentRecords.filter((attachment) => attachment.inline);
  const regularAttachments = attachmentRecords.filter((attachment) => !attachment.inline);
  const body = buildBodyParts({
    html: message.html,
    inlineAttachments,
    regularAttachments,
    text: message.text,
  });
  const raw = [
    ...headerLines,
    `Content-Type: ${body.contentType}`,
    ...getNestedTransferEncodingHeader(body.contentType),
    "",
    body.content,
  ].join("\r\n");

  return {
    attachmentSizeBytes: attachmentRecords.reduce(
      (total, attachment) => total + attachment.size,
      0,
    ),
    attachments: attachmentRecords.map(({ bytes: _bytes, ...attachment }) => attachment),
    bcc,
    cc,
    fromAddress,
    headers,
    messageHeaderId,
    raw,
    rawSizeBytes: new TextEncoder().encode(raw).byteLength,
    replyTo,
    to,
  };
};

const buildBodyParts = (input: {
  html?: string;
  inlineAttachments: Array<{
    bytes: Uint8Array;
    contentId: string | null;
    fileName: string;
    mimeType: string;
  }>;
  regularAttachments: Array<{
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }>;
  text?: string;
}) => {
  const mixedBoundary = createMimeBoundary("mix");
  const alternativeBoundary = createMimeBoundary("alt");
  const relatedBoundary = createMimeBoundary("rel");
  const primaryBody = (() => {
    if (input.text && input.html) {
      const htmlPart = buildHtmlPart(input.html, input.inlineAttachments, relatedBoundary);
      return {
        content: [
          `--${alternativeBoundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: quoted-printable",
          "",
          encodeQuotedPrintable(input.text),
          `--${alternativeBoundary}`,
          `Content-Type: ${htmlPart.contentType}`,
          ...getNestedTransferEncodingHeader(htmlPart.contentType),
          "",
          htmlPart.content,
          `--${alternativeBoundary}--`,
        ].join("\r\n"),
        contentType: `multipart/alternative; boundary="${alternativeBoundary}"`,
      };
    }

    if (input.html) {
      return buildHtmlPart(input.html, input.inlineAttachments, relatedBoundary);
    }

    return {
      content: encodeQuotedPrintable(input.text ?? ""),
      contentType: 'text/plain; charset="UTF-8"',
    };
  })();

  if (input.regularAttachments.length === 0) {
    return primaryBody;
  }

  return {
    content: [
      `--${mixedBoundary}`,
      `Content-Type: ${primaryBody.contentType}`,
      ...getNestedTransferEncodingHeader(primaryBody.contentType),
      "",
      primaryBody.content,
      ...input.regularAttachments.map((attachment) =>
        buildAttachmentPart(mixedBoundary, attachment),
      ),
      `--${mixedBoundary}--`,
    ].join("\r\n"),
    contentType: `multipart/mixed; boundary="${mixedBoundary}"`,
  };
};

const buildHtmlPart = (
  html: string,
  inlineAttachments: Array<{
    bytes: Uint8Array;
    contentId: string | null;
    fileName: string;
    mimeType: string;
  }>,
  relatedBoundary: string,
) => {
  if (inlineAttachments.length === 0) {
    return {
      content: encodeQuotedPrintable(html),
      contentType: 'text/html; charset="UTF-8"',
    };
  }

  return {
    content: [
      `--${relatedBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(html),
      ...inlineAttachments.map((attachment) =>
        buildAttachmentPart(relatedBoundary, { ...attachment, inline: true }),
      ),
      `--${relatedBoundary}--`,
    ].join("\r\n"),
    contentType: `multipart/related; boundary="${relatedBoundary}"`,
  };
};

const buildAttachmentPart = (
  boundary: string,
  attachment: {
    bytes: Uint8Array;
    contentId?: string | null;
    fileName: string;
    inline?: boolean;
    mimeType: string;
  },
) =>
  [
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${escapeMimeParameter(attachment.fileName)}"`,
    `Content-Disposition: ${attachment.inline ? "inline" : "attachment"}; filename="${escapeMimeParameter(
      attachment.fileName,
    )}"`,
    "Content-Transfer-Encoding: base64",
    ...(attachment.contentId
      ? [`Content-ID: <${attachment.contentId.replaceAll(/[<>]/g, "")}>`]
      : []),
    "",
    base64WithCrlf(attachment.bytes),
  ].join("\r\n");

const getNestedTransferEncodingHeader = (contentType: string) =>
  contentType.startsWith("multipart/") ? [] : ["Content-Transfer-Encoding: quoted-printable"];

const createMimeBoundary = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

const bytesToBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const decodeBase64Bytes = (value: string) =>
  new Uint8Array(Buffer.from(value.replace(/\s+/g, ""), "base64"));

const base64WithCrlf = (value: Uint8Array) =>
  bytesToBase64(value)
    .replace(/.{1,76}/g, "$&\r\n")
    .trim();

const encodeMimeHeaderValue = (value: string) => {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
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

const escapeMimeParameter = (value: string) => value.replaceAll(/["\r\n]/g, "_");

const hasHeaderInjection = (value: string) => /[\r\n]/.test(value);

const isSafeHeaderName = (name: string) => HEADER_NAME_PATTERN.test(name);
