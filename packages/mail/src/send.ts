import { z } from "zod";

import { extractMailAddress } from "./compose/schema";

export const SEND_API_PATH = "/api/v1/send";

export const MAX_SEND_PAYLOAD_BYTES = 25 * 1024 * 1024;

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
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

const hasHeaderInjection = (value: string) => /[\r\n]/u.test(value);

const isSafeHeaderName = (name: string) => HEADER_NAME_PATTERN.test(name);

export const isValidBase64 = (value: string): boolean => {
  const normalized = value.replaceAll(/\s+/gu, "");
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !BASE64_PATTERN.test(normalized)
  ) {
    return false;
  }

  try {
    Buffer.from(normalized, "base64");
    return true;
  } catch {
    return false;
  }
};

const jsonMetadataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const sendHeaderNameSchema = z
  .string()
  .refine(
    (name) =>
      isSafeHeaderName(name) &&
      !STRUCTURAL_HEADER_NAMES.has(name.toLowerCase()),
    {
      message: "Header name is not allowed.",
    }
  );

const sendHeaderValueSchema = z
  .string()
  .refine((value) => !hasHeaderInjection(value), {
    message: "Header values cannot contain line breaks.",
  });

const addressListSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .pipe(
    z.array(z.string().trim().min(1)).min(1, "Add at least one recipient.")
  );

const headerSchema = z.union([
  z.record(sendHeaderNameSchema, sendHeaderValueSchema),
  z.array(
    z.object({
      name: sendHeaderNameSchema,
      value: sendHeaderValueSchema,
    })
  ),
]);

export const sendAttachmentSchema = z.object({
  content: z
    .string()
    .min(1)
    .refine(isValidBase64, "Attachment content must be base64 encoded."),
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
    openTracking: z.boolean().optional(),
    replyTo: addressListSchema.optional(),
    subject: z.string().trim().min(1),
    tags: z.array(sendTagSchema).default([]),
    text: z.string().min(1),
    to: addressListSchema,
  })
  .refine(
    (input) =>
      (input.html !== undefined && input.html.length > 0) ||
      input.attachments.every(
        (attachment) => attachment.disposition !== "inline"
      ),
    {
      message: "Inline attachments require an html body.",
      path: ["attachments"],
    }
  )
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

export const normalizeSendHeaders = (
  headers: SendMessageInput["headers"]
): SendHeader[] => {
  if (!headers) {
    return [];
  }

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

export const getSendEnvelopeAddress = (value: string): string =>
  extractMailAddress(value).trim().toLowerCase();

export const getSendEnvelopeAddressList = (
  values: readonly string[] | undefined
): string[] => [
  ...new Set((values ?? []).map(getSendEnvelopeAddress).filter(Boolean)),
];
