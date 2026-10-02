import {
  composeDraftInputSchema,
  composeMessageInputSchema,
  composeSendDraftInputSchema,
} from "@quieter/mail/compose/schema";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import { z } from "zod";

export const mailInputSchemas = {
  applyChanges: z.object({
    command: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("set-read"), read: z.boolean() }),
      z.object({
        destination: z.enum(["archive", "inbox", "spam", "trash"]),
        kind: z.literal("move"),
      }),
      z.object({ kind: z.literal("delete-permanently") }),
      z.object({
        addIds: z.array(z.string()),
        kind: z.literal("set-labels"),
        removeIds: z.array(z.string()),
      }),
    ]),
    mailboxId: z.string().trim().min(1),
    targets: z
      .array(
        z.object({
          messageIds: z.array(z.string().trim().min(1)).min(1).max(1000),
          threadId: z.string().trim().min(1),
        })
      )
      .min(1)
      .max(1000)
      .superRefine((targets, context) => {
        if (
          targets.reduce(
            (count, target) => count + target.messageIds.length,
            0
          ) > 1000
        ) {
          context.addIssue({
            code: "custom",
            message: "A mail command can include at most 1,000 messages.",
          });
        }
      }),
  }),
  createLabel: z.object({
    color: mailboxLabelColorSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    mailboxId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(225),
  }),
  deleteDraft: z.object({
    draftId: z.string(),
    mailboxId: z.string().trim().min(1),
  }),
  deleteLabel: z.object({
    labelId: z.string().trim().min(1),
    mailboxId: z.string().trim().min(1),
  }),
  getAttachment: z.object({
    attachmentId: z.string(),
    fileName: z.string().min(1),
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
    mimeType: z.string().min(1),
  }),
  getMessageDelivery: z.object({
    mailboxId: z.string().trim().min(1),
    messageId: z.string().trim().min(1),
  }),
  getMessageInspector: z.object({
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
  }),
  getThread: z.object({
    mailboxId: z.string().trim().min(1),
    threadId: z.string(),
  }),
  listLabels: z.object({
    mailboxId: z.string().trim().min(1),
  }),
  listMessageDeliveryStatuses: z.object({
    mailboxId: z.string().trim().min(1),
    messageIds: z.array(z.string().trim().min(1)).max(100),
  }),
  listThreads: z.object({
    category: mailCategorySchema,
    mailboxId: z.string().trim().min(1),
    maxResults: z.number().int().positive().max(100).optional(),
    pageToken: z.string().optional(),
    query: z.string().optional(),
  }),
  markMessageAsRead: z.object({
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
  }),
  markMessageAsUnread: z.object({
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
  }),
  markThreadAsRead: z.object({
    mailboxId: z.string().trim().min(1),
    threadId: z.string(),
  }),
  markThreadAsUnread: z.object({
    mailboxId: z.string().trim().min(1),
    threadId: z.string(),
  }),
  moveMessageToTrash: z.object({
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
  }),
  moveThreadToTrash: z.object({
    mailboxId: z.string().trim().min(1),
    threadId: z.string(),
  }),
  saveDraft: z.object({
    draft: composeDraftInputSchema,
    mailboxId: z.string().trim().min(1),
  }),
  sendDraft: z.object({
    draft: composeSendDraftInputSchema,
    mailboxId: z.string().trim().min(1),
  }),
  sendMessage: z.object({
    mailboxId: z.string().trim().min(1),
    message: composeMessageInputSchema,
  }),
  syncMailbox: z.object({
    category: z.enum(["inbox", "unread", "archive", "spam", "sent", "trash"]),
    mailboxId: z.string().trim().min(1),
    startHistoryId: z.string().min(1),
  }),
  unsubscribeFromMessage: z.object({
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
  }),
  untrashMessage: z.object({
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
  }),
  untrashThread: z.object({
    mailboxId: z.string().trim().min(1),
    threadId: z.string(),
  }),
  updateLabel: z.object({
    color: mailboxLabelColorSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    labelId: z.string().trim().min(1),
    mailboxId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(225),
    position: z.number().int().nonnegative().optional(),
    visible: z.boolean().optional(),
  }),
  updateLabelDetails: z.object({
    description: z.string().trim().max(2000).nullable(),
    inclusionCriteria: z.string().trim().max(4000).nullable(),
    labelId: z.string().trim().min(1),
    mailboxId: z.string().trim().min(1),
  }),
  updateMessageLabels: z.object({
    addLabelIds: z.array(z.string()).optional(),
    mailboxId: z.string().trim().min(1),
    messageId: z.string(),
    removeLabelIds: z.array(z.string()).optional(),
  }),
  updateThreadLabels: z.object({
    addLabelIds: z.array(z.string()).optional(),
    mailboxId: z.string().trim().min(1),
    removeLabelIds: z.array(z.string()).optional(),
    threadId: z.string(),
  }),
};
export type MailInputs = {
  [Key in keyof typeof mailInputSchemas]: z.infer<
    (typeof mailInputSchemas)[Key]
  >;
};
