import { z } from "zod";

const EMAIL_ADDRESS_PATTERN =
  /(?<email>[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/iu;
const UNRESOLVED_TEMPLATE_PLACEHOLDER_PATTERN =
  /\{\{quieter:[^{}\n]{1,80}\}\}|data-quieter-template-placeholder=/u;

export const hasUnresolvedTemplatePlaceholders = (value: string): boolean =>
  UNRESOLVED_TEMPLATE_PLACEHOLDER_PATTERN.test(value);

const normalizeMailAddressValue = (value: string | undefined) =>
  value?.replaceAll(/\r?\n\s+/gu, " ").trim() ?? "";

const previewMailAddress = (value: string) => {
  const normalized = normalizeMailAddressValue(value);
  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 45).trimEnd()}...`;
};

export const splitMailAddressList = (value: string | undefined): string[] => {
  const normalized = normalizeMailAddressValue(value);
  if (!normalized) {
    return [];
  }

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;
  let isEscaping = false;

  for (const character of normalized) {
    if (isEscaping) {
      current += character;
      isEscaping = false;
      continue;
    }

    if (inQuotes && character === "\\") {
      current += character;
      isEscaping = true;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      current += character;
      continue;
    }

    if (!inQuotes && character === "<") {
      angleDepth += 1;
      current += character;
      continue;
    }

    if (!inQuotes && character === ">" && angleDepth > 0) {
      angleDepth -= 1;
      current += character;
      continue;
    }

    if (
      !inQuotes &&
      angleDepth === 0 &&
      (character === "," || character === ";" || character === "\n")
    ) {
      const nextPart = current.trim();
      if (nextPart) {
        parts.push(nextPart);
      }
      current = "";
      continue;
    }

    current += character;
  }

  const finalPart = current.trim();
  if (finalPart) {
    parts.push(finalPart);
  }

  return parts;
};

export const extractMailAddress = (value: string): string => {
  const normalized = normalizeMailAddressValue(value);
  if (!normalized) {
    return "";
  }

  const angleMatch = /<(?<address>[^>]+)>/u.exec(normalized);
  const angleAddress = angleMatch?.groups?.address;
  if (angleAddress !== undefined && angleAddress.length > 0) {
    return normalizeMailAddressValue(angleAddress);
  }

  const emailMatch = EMAIL_ADDRESS_PATTERN.exec(normalized);
  const emailAddress = emailMatch?.groups?.email;
  if (emailAddress !== undefined && emailAddress.length > 0) {
    return normalizeMailAddressValue(emailAddress);
  }

  return normalized.replaceAll(/^"+|"+$/gu, "");
};

export const getMailAddressKey = (value: string): string => {
  const address = extractMailAddress(value).trim().toLowerCase();
  if (address) {
    return address;
  }

  return normalizeMailAddressValue(value).toLowerCase();
};

export const findInvalidMailAddresses = (value: string | undefined): string[] =>
  splitMailAddressList(value).filter(
    (entry) =>
      !z
        .email("Enter a valid email address.")
        .safeParse(extractMailAddress(entry)).success
  );

export const formatInvalidMailAddressMessage = (
  invalidEntries: readonly string[]
): string => {
  const preview = invalidEntries
    .slice(0, 2)
    .map((entry) => `"${previewMailAddress(entry)}"`);

  if (invalidEntries.length === 1) {
    return `${preview[0]} is not a valid email address.`;
  }

  const suffix =
    invalidEntries.length > 2 ? ` and ${invalidEntries.length - 2} more` : "";
  return `These addresses are invalid: ${preview.join(", ")}${suffix}.`;
};

export const composeRecipientFieldSchema = z
  .string()
  .superRefine((value, ctx) => {
    const invalidEntries = findInvalidMailAddresses(value);
    if (invalidEntries.length === 0) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message: formatInvalidMailAddressMessage(invalidEntries),
    });
  });

export const composeRecipientFieldsSchema = z.object({
  bcc: composeRecipientFieldSchema,
  cc: composeRecipientFieldSchema,
  to: composeRecipientFieldSchema,
});

export const composeDraftSeededBySchema = z.enum([
  "reply",
  "reply-all",
  "forward",
]);

export const composeDraftAnchorSchema = z.object({
  seededBy: composeDraftSeededBySchema,
  sourceMessageHeaderId: z.string().optional(),
  sourceMessageId: z.string(),
  sourceThreadId: z.string(),
});

export type ComposeDraftSeededBy = z.infer<typeof composeDraftSeededBySchema>;
export type ComposeDraftAnchor = z.infer<typeof composeDraftAnchorSchema>;

export const QUIETER_DRAFT_HEADER_NAMES = {
  seededBy: "X-Quieter-Seeded-By",
  sourceMessageHeaderId: "X-Quieter-Source-Message-Header-Id",
  sourceMessageId: "X-Quieter-Source-Message-Id",
  sourceThreadId: "X-Quieter-Source-Thread-Id",
} as const;

export const composeDraftFormValuesSchema = z.object({
  bcc: composeRecipientFieldSchema,
  bodyHtml: z.string(),
  bodyText: z.string(),
  cc: composeRecipientFieldSchema,
  subject: z.string(),
  to: composeRecipientFieldSchema,
});

const MIME_OWNED_HEADER_NAMES = new Set([
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

const composeHeaderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u)
    .refine((name) => !MIME_OWNED_HEADER_NAMES.has(name.toLowerCase()), {
      message: "Header name is reserved for the MIME message.",
    }),
  value: z
    .string()
    .trim()
    .max(998)
    .refine(
      (value) => !/[\r\n]/u.test(value),
      "Header values cannot contain line breaks."
    ),
});

export const composeSendFormValuesSchema =
  composeDraftFormValuesSchema.superRefine((value, ctx) => {
    if (splitMailAddressList(value.to).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Add at least one recipient in To.",
        path: ["to"],
      });
    }

    if (
      hasUnresolvedTemplatePlaceholders(value.bodyHtml) ||
      hasUnresolvedTemplatePlaceholders(value.bodyText)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Fill every template placeholder before sending.",
        path: ["bodyHtml"],
      });
    }
  });

const composeAttachmentSchema = z.object({
  contentId: z.string().nullable().optional(),
  file: z.file().optional(),
  fileName: z.string().optional(),
  gmailAttachmentId: z.string().optional(),
  id: z.string(),
  isInline: z.boolean(),
  mimeType: z.string(),
  name: z.string(),
  size: z.number(),
});

const composeInlineImageSchema = z.object({
  contentId: z.string(),
  file: z.file().optional(),
  gmailAttachmentId: z.string().optional(),
  id: z.string(),
  isInline: z.boolean().optional(),
  mimeType: z.string(),
  name: z.string(),
  size: z.number(),
});

export const composeDraftInputSchema = z.object({
  attachments: z.array(composeAttachmentSchema),
  bodyHtml: z.string(),
  bodyText: z.string(),
  draftAnchor: composeDraftAnchorSchema.nullable().optional(),
  draftId: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  headers: z.array(composeHeaderSchema).max(32).optional(),
  inlineImages: z.array(composeInlineImageSchema),
  lastSavedAt: z.number().nullable().optional(),
  localId: z.string(),
  messageId: z.string().nullable().optional(),
  recipients: composeRecipientFieldsSchema,
  replyContext: z
    .object({
      messageHeaderId: z.string().optional(),
      references: z.array(z.string()).default([]),
      threadId: z.string(),
    })
    .nullable()
    .optional(),
  saveStatus: z.string(),
  subject: z.string(),
  updatedAt: z.number(),
});

export const composeMessageInputSchema = composeDraftInputSchema.superRefine(
  (value, ctx) => {
    if (splitMailAddressList(value.recipients.to).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Add at least one recipient in To.",
        path: ["recipients", "to"],
      });
    }

    if (
      hasUnresolvedTemplatePlaceholders(value.bodyHtml) ||
      hasUnresolvedTemplatePlaceholders(value.bodyText)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Fill every template placeholder before sending.",
        path: ["bodyHtml"],
      });
    }
  }
);

export const composeSendDraftInputSchema = composeMessageInputSchema;
