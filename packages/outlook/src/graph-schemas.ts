import { z } from "zod";

const identifier = z.string().min(1).max(4096);
const recipientSchema = z.object({
  emailAddress: z.object({
    address: z
      .string()
      .min(1)
      .regex(/^[^\r\n]+$/u),
    name: z.string().nullish(),
  }),
});

export const outlookFolderSchema = z.object({
  childFolderCount: z.number().int().nonnegative().optional(),
  displayName: z.string(),
  id: identifier,
  isHidden: z.boolean().optional(),
  parentFolderId: identifier.optional(),
  totalItemCount: z.number().int().nonnegative().optional(),
  unreadItemCount: z.number().int().nonnegative().optional(),
});

export const outlookSystemFoldersSchema = z.object({
  archive: identifier,
  drafts: identifier,
  inbox: identifier,
  sent: identifier,
  spam: identifier,
  trash: identifier,
});

export const outlookMessageSchema = z.object({
  bccRecipients: z.array(recipientSchema).optional(),
  body: z
    .object({
      content: z.string(),
      contentType: z.enum(["html", "text"]),
    })
    .optional(),
  bodyPreview: z.string().optional(),
  categories: z.array(z.string()).optional(),
  ccRecipients: z.array(recipientSchema).optional(),
  changeKey: identifier,
  conversationId: identifier,
  createdDateTime: z.iso.datetime({ offset: true }).optional(),
  from: recipientSchema.nullish(),
  hasAttachments: z.boolean().optional(),
  id: identifier,
  importance: z.enum(["low", "normal", "high"]).optional(),
  internetMessageHeaders: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
  internetMessageId: z.string().optional(),
  isDraft: z.boolean(),
  isRead: z.boolean(),
  parentFolderId: identifier,
  receivedDateTime: z.iso.datetime({ offset: true }).optional(),
  replyTo: z.array(recipientSchema).optional(),
  sentDateTime: z.iso.datetime({ offset: true }).optional(),
  subject: z.string().optional(),
  toRecipients: z.array(recipientSchema).optional(),
  webLink: z.string().optional(),
});

export const outlookMessagePatchSchema = outlookMessageSchema
  .partial()
  .required({ id: true });

const attachmentFields = {
  contentType: z.string().nullish(),
  id: identifier,
  isInline: z.boolean().optional(),
  name: z.string(),
  size: z.number().int().nonnegative(),
};

export const outlookAttachmentSchema = z.discriminatedUnion("@odata.type", [
  z.object({
    "@odata.type": z.literal("#microsoft.graph.fileAttachment"),
    ...attachmentFields,
    contentId: z.string().nullish(),
  }),
  z.object({
    "@odata.type": z.literal("#microsoft.graph.itemAttachment"),
    ...attachmentFields,
  }),
  z.object({
    "@odata.type": z.literal("#microsoft.graph.referenceAttachment"),
    ...attachmentFields,
  }),
]);

export type OutlookAttachment = z.infer<typeof outlookAttachmentSchema>;
export type OutlookFolder = z.infer<typeof outlookFolderSchema>;
export type OutlookMessage = z.infer<typeof outlookMessageSchema>;
export type OutlookMessagePatch = z.infer<typeof outlookMessagePatchSchema>;
export type OutlookSystemFolders = z.infer<typeof outlookSystemFoldersSchema>;
