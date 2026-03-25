import { z } from "zod";

const EMAIL_ADDRESS_PATTERN = /([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;

const normalizeMailAddressValue = (value: string | undefined) =>
  value?.replaceAll(/\r?\n\s+/g, " ").trim() ?? "";

const emailAddressSchema = z.string().email("Enter a valid email address.");

const previewMailAddress = (value: string) => {
  const normalized = normalizeMailAddressValue(value);
  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 45).trimEnd()}...`;
};

export const splitMailAddressList = (value: string | undefined): string[] => {
  const normalized = normalizeMailAddressValue(value);
  if (!normalized) return [];

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

  const angleMatch = normalized.match(/<([^>]+)>/);
  if (angleMatch?.[1]) {
    return normalizeMailAddressValue(angleMatch[1]);
  }

  const emailMatch = normalized.match(EMAIL_ADDRESS_PATTERN);
  if (emailMatch?.[1]) {
    return normalizeMailAddressValue(emailMatch[1]);
  }

  return normalized.replace(/^"+|"+$/g, "");
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
    (entry) => !emailAddressSchema.safeParse(extractMailAddress(entry)).success,
  );

export const formatInvalidMailAddressMessage = (invalidEntries: readonly string[]): string => {
  const preview = invalidEntries.slice(0, 2).map((entry) => `"${previewMailAddress(entry)}"`);

  if (invalidEntries.length === 1) {
    return `${preview[0]} is not a valid email address.`;
  }

  const suffix = invalidEntries.length > 2 ? ` and ${invalidEntries.length - 2} more` : "";
  return `These addresses are invalid: ${preview.join(", ")}${suffix}.`;
};

export const composeRecipientFieldSchema = z.string().superRefine((value, ctx) => {
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
  to: composeRecipientFieldSchema,
  cc: composeRecipientFieldSchema,
  bcc: composeRecipientFieldSchema,
});

export const composeDraftFormValuesSchema = z.object({
  to: composeRecipientFieldSchema,
  cc: composeRecipientFieldSchema,
  bcc: composeRecipientFieldSchema,
  subject: z.string(),
  bodyHtml: z.string(),
  bodyText: z.string(),
});

export const composeSendFormValuesSchema = composeDraftFormValuesSchema.superRefine(
  (value, ctx) => {
    if (splitMailAddressList(value.to).length > 0) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message: "Add at least one recipient in To.",
      path: ["to"],
    });
  },
);

const composeAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string(),
  isInline: z.boolean(),
  contentId: z.string().nullable().optional(),
  fileName: z.string().optional(),
  file: z.file().optional(),
  gmailAttachmentId: z.string().optional(),
});

const composeInlineImageSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  contentId: z.string(),
  file: z.file().optional(),
  gmailAttachmentId: z.string().optional(),
  isInline: z.boolean().optional(),
});

export const composeDraftInputSchema = z.object({
  localId: z.string(),
  draftId: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  replyContext: z
    .object({
      threadId: z.string(),
      messageHeaderId: z.string().optional(),
      references: z.array(z.string()).default([]),
    })
    .nullable()
    .optional(),
  recipients: composeRecipientFieldsSchema,
  subject: z.string(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  attachments: z.array(composeAttachmentSchema),
  inlineImages: z.array(composeInlineImageSchema),
  saveStatus: z.string(),
  errorMessage: z.string().nullable().optional(),
  lastSavedAt: z.number().nullable().optional(),
  updatedAt: z.number(),
});

export const composeSendDraftInputSchema = composeDraftInputSchema.superRefine((value, ctx) => {
  if (splitMailAddressList(value.recipients.to).length > 0) {
    return;
  }

  ctx.addIssue({
    code: "custom",
    message: "Add at least one recipient in To.",
    path: ["recipients", "to"],
  });
});
