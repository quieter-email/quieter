import { ORPCError } from "@orpc/server";
import {
  createDraft,
  createLabel,
  deleteDraft,
  deleteLabel,
  extractListUnsubscribeTargets,
  getGmailMessageMetadata,
  getMailboxSyncDelta,
  getMessageAttachment,
  getMessageInspector,
  getThreadWithDetails,
  listDraftsWithDetails,
  listLabels,
  listMessagesWithDetails,
  markMessageAsRead,
  markMessageAsUnread,
  markThreadAsRead,
  markThreadAsUnread,
  moveMessageToTrash,
  moveThreadToTrash,
  refreshMailboxMessages,
  sendDraft as sendGmailDraft,
  sendRawMessage,
  untrashMessage,
  untrashThread,
  updateLabel,
  updateMessageLabels,
  updateThreadLabels,
} from "@quieter/gmail";
import {
  arrayBufferToBase64Url,
  buildMimeMessage,
  buildPlainTextMessage,
} from "@quieter/mail/compose/mime";
import {
  composeDraftInputSchema,
  composeMessageInputSchema,
  composeSendDraftInputSchema,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import { z } from "zod";
import { saveGmailDraft, sendGmailMessage } from "../gmail-compose";
import {
  deleteSyncedGmailLabel,
  saveGmailLabelDetails,
  syncGmailLabels,
  upsertSyncedGmailLabel,
} from "../gmail-labels";
import { recordMailAutoLabelFeedback } from "../mail-automation/memory";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  createManagedLabel,
  deleteManagedLabel,
  listManagedLabels,
  updateManagedLabel,
  updateManagedThreadLabels,
  updateSingleManagedMessageLabels,
} from "../managed-mail/labels/service";
import {
  getManagedMessageInspector,
  getManagedThread,
  listManagedMessages,
  refreshManagedMessages,
  sendManagedMailboxMessage,
  setManagedMessageMailboxState,
  setManagedMessageReadState,
  setManagedThreadMailboxState,
  setManagedThreadReadState,
} from "../managed-mail/messages/service";
import {
  getOrganizationApiMailInspector,
  getOrganizationApiMailThread,
  isOrganizationApiMailboxId,
  listOrganizationApiMailMessages,
} from "../organization-api-mail";
import {
  callGmail,
  historySyncMailboxCategorySchema,
  gmailUserLabelNameSchema,
  mailboxCategorySchema,
  mailboxIdSchema,
  protectedProcedure,
} from "./base";
import { mailboxProcedures } from "./mail/mailboxes";
import { managedOrganizationMailRouter } from "./mail/managed-organization";

const parseListUnsubscribeMailto = (value: string) => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not expose a valid unsubscribe address.",
    });
  }

  if (url.protocol !== "mailto:") {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not expose a valid unsubscribe address.",
    });
  }

  const recipients = Array.from(
    new Set([
      ...splitMailAddressList(decodeURIComponent(url.pathname)),
      ...splitMailAddressList(url.searchParams.get("to") ?? ""),
    ]),
  );

  if (recipients.length === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not expose a valid unsubscribe address.",
    });
  }

  return {
    body: url.searchParams.get("body") ?? "",
    subject: url.searchParams.get("subject") ?? "",
    to: recipients.join(", "),
  };
};

const recordLabelFeedback = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  providerMessageIds: string[];
  removeLabelIds?: string[];
  userId: string;
}) => {
  try {
    await recordMailAutoLabelFeedback(input);
  } catch (error) {
    console.error("Could not record mail auto-label feedback.", error);
  }
};

export const mailRouter = {
  ...mailboxProcedures,
  ...managedOrganizationMailRouter,
  listMessages: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        category: mailboxCategorySchema,
        pageToken: z.string().optional(),
        maxResults: z.number().int().positive().max(100).optional(),
        query: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (isOrganizationApiMailboxId(input.mailboxId)) {
        return await listOrganizationApiMailMessages({
          ...input,
          userId: context.userId,
        });
      }

      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await listManagedMessages({
          ...input,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return input.category === "drafts"
          ? await listDraftsWithDetails(accessToken, {
              pageToken: input.pageToken,
              maxResults: input.maxResults,
              query: input.query?.trim() || undefined,
              signal,
            })
          : await listMessagesWithDetails(accessToken, {
              mailbox: input.category,
              pageToken: input.pageToken,
              maxResults: input.maxResults,
              query: input.query?.trim() || undefined,
              signal,
            });
      });
    }),

  getMailboxSyncDelta: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        category: historySyncMailboxCategorySchema,
        startHistoryId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      if (isOrganizationApiMailboxId(input.mailboxId)) {
        return {
          hasChanges: true,
          refreshFirstPage: true,
          removedMessageIds: [],
          requiresFullRefresh: true,
          updatedMessages: [],
        };
      }

      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return {
          hasChanges: true,
          refreshFirstPage: true,
          removedMessageIds: [],
          requiresFullRefresh: true,
          updatedMessages: [],
        };
      }

      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await getMailboxSyncDelta(accessToken, {
          mailbox: input.category,
          signal,
          startHistoryId: input.startHistoryId,
        });
      });
    }),

  refreshMessages: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        category: historySyncMailboxCategorySchema,
        messageIds: z.array(z.string().trim().min(1)).min(1).max(25),
      }),
    )
    .handler(async ({ context, input }) => {
      if (isOrganizationApiMailboxId(input.mailboxId)) {
        return { removedMessageIds: [], updatedMessages: [] };
      }

      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await refreshManagedMessages({
          mailboxId: input.mailboxId,
          messageIds: input.messageIds,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await refreshMailboxMessages(accessToken, {
          mailbox: input.category,
          messageIds: input.messageIds,
          signal,
        });
      });
    }),

  getThread: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (isOrganizationApiMailboxId(input.mailboxId)) {
        return await getOrganizationApiMailThread({
          ...input,
          userId: context.userId,
        });
      }

      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await getManagedThread({
          ...input,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await getThreadWithDetails(accessToken, input.threadId, signal);
      });
    }),

  getMessageInspector: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (isOrganizationApiMailboxId(input.mailboxId)) {
        return await getOrganizationApiMailInspector({
          ...input,
          userId: context.userId,
        });
      }

      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await getManagedMessageInspector({
          ...input,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await getMessageInspector(accessToken, input.messageId, signal);
      });
    }),

  listLabels: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await listManagedLabels({
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        const labels = await syncGmailLabels(
          input.mailboxId,
          await listLabels(accessToken, signal),
        );
        return labels.map((label, position) => ({
          ...label,
          color: null,
          position,
          provider: "gmail" as const,
          visible: true,
        }));
      });
    }),

  createLabel: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        name: gmailUserLabelNameSchema,
        color: mailboxLabelColorSchema.optional(),
        description: z.string().trim().max(2_000).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await createManagedLabel({
          color: input.color ?? "gray",
          description: input.description,
          mailboxId: input.mailboxId,
          name: input.name,
          userId: context.userId,
        });
      }
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        const label = await upsertSyncedGmailLabel(
          input.mailboxId,
          await createLabel(accessToken, input.name, signal),
        );
        return {
          ...label,
          color: null,
          position: 0,
          provider: "gmail" as const,
          visible: true,
        };
      });
    }),

  updateLabel: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        labelId: z.string().trim().min(1),
        name: gmailUserLabelNameSchema,
        color: mailboxLabelColorSchema.optional(),
        description: z.string().trim().max(2_000).nullable().optional(),
        position: z.number().int().nonnegative().optional(),
        visible: z.boolean().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await updateManagedLabel({
          color: input.color,
          description: input.description,
          labelId: input.labelId,
          mailboxId: input.mailboxId,
          name: input.name,
          position: input.position,
          userId: context.userId,
          visible: input.visible,
        });
      }
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        const label = await upsertSyncedGmailLabel(
          input.mailboxId,
          await updateLabel(accessToken, input.labelId, input.name, signal),
        );
        return {
          ...label,
          color: null,
          position: 0,
          provider: "gmail" as const,
          visible: true,
        };
      });
    }),

  updateLabelDetails: protectedProcedure
    .input(
      z.object({
        description: z.string().trim().max(2_000).nullable(),
        inclusionCriteria: z.string().trim().max(4_000).nullable(),
        labelId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await updateManagedLabel({
          description: input.description,
          labelId: input.labelId,
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
      }
      const updatedLabel = await saveGmailLabelDetails(input);
      if (!updatedLabel) {
        throw new ORPCError("NOT_FOUND", { message: "Label not found." });
      }
      return updatedLabel;
    }),

  deleteLabel: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        labelId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await deleteManagedLabel({
          labelId: input.labelId,
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
      }
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        const result = await deleteLabel(accessToken, input.labelId, signal);
        await deleteSyncedGmailLabel(input.mailboxId, input.labelId);
        return result;
      });
    }),

  markMessageAsRead: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedMessageReadState({
          ...input,
          read: true,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await markMessageAsRead(accessToken, input.messageId);
      });
    }),

  markMessageAsUnread: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedMessageReadState({
          ...input,
          read: false,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await markMessageAsUnread(accessToken, input.messageId);
      });
    }),

  markThreadAsRead: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedThreadReadState({
          ...input,
          read: true,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await markThreadAsRead(accessToken, input.threadId);
      });
    }),

  markThreadAsUnread: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedThreadReadState({
          ...input,
          read: false,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await markThreadAsUnread(accessToken, input.threadId);
      });
    }),

  updateThreadLabels: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        const result = await updateManagedThreadLabels({
          ...input,
          userId: context.userId,
        });
        void recordLabelFeedback({
          addLabelIds: input.addLabelIds,
          mailboxId: input.mailboxId,
          providerMessageIds: result.messages.map((message) => message.id),
          removeLabelIds: input.removeLabelIds,
          userId: context.userId,
        });
        return result;
      }
      return await callGmail(context, input.mailboxId, async (accessToken) => {
        const result = await updateThreadLabels(accessToken, input.threadId, {
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        });
        void recordLabelFeedback({
          addLabelIds: input.addLabelIds,
          mailboxId: input.mailboxId,
          providerMessageIds: result.messages.map((message) => message.id),
          removeLabelIds: input.removeLabelIds,
          userId: context.userId,
        });
        return result;
      });
    }),

  updateMessageLabels: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        const result = await updateSingleManagedMessageLabels({
          ...input,
          userId: context.userId,
        });
        void recordLabelFeedback({
          addLabelIds: input.addLabelIds,
          mailboxId: input.mailboxId,
          providerMessageIds: [result.id],
          removeLabelIds: input.removeLabelIds,
          userId: context.userId,
        });
        return result;
      }
      return await callGmail(context, input.mailboxId, async (accessToken) => {
        const result = await updateMessageLabels(accessToken, input.messageId, {
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        });
        void recordLabelFeedback({
          addLabelIds: input.addLabelIds,
          mailboxId: input.mailboxId,
          providerMessageIds: [result.id],
          removeLabelIds: input.removeLabelIds,
          userId: context.userId,
        });
        return result;
      });
    }),

  moveMessageToTrash: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedMessageMailboxState({
          ...input,
          state: "trash",
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await moveMessageToTrash(accessToken, input.messageId);
      });
    }),

  untrashMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedMessageMailboxState({
          ...input,
          state: "active",
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await untrashMessage(accessToken, input.messageId);
      });
    }),

  untrashThread: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedThreadMailboxState({
          ...input,
          state: "active",
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await untrashThread(accessToken, input.threadId);
      });
    }),

  moveThreadToTrash: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await setManagedThreadMailboxState({
          ...input,
          state: "trash",
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await moveThreadToTrash(accessToken, input.threadId);
      });
    }),

  saveDraft: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        draft: composeDraftInputSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await saveGmailDraft(accessToken, input.draft, context.signal);
      });
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        message: composeMessageInputSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await sendManagedMailboxMessage({
          ...input,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await sendGmailMessage(accessToken, input.message, context.signal);
      });
    }),

  sendDraft: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        draft: composeSendDraftInputSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken) => {
        const raw = arrayBufferToBase64Url(
          new TextEncoder().encode(await buildMimeMessage(input.draft)),
        );
        let draftId = input.draft.draftId ?? null;
        if (!draftId) {
          const savedDraft = await createDraft(
            accessToken,
            raw,
            input.draft.replyContext?.threadId,
          );
          draftId = savedDraft.id;
        }

        if (!draftId) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Draft could not be saved before send.",
          });
        }

        return await sendGmailDraft(accessToken, draftId, raw, input.draft.replyContext?.threadId);
      });
    }),

  deleteDraft: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        draftId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken) => {
        await deleteDraft(accessToken, input.draftId);
        return { deleted: true };
      });
    }),

  unsubscribeFromMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        const message = await getGmailMessageMetadata(accessToken, input.messageId, signal);
        const unsubscribeMailto = extractListUnsubscribeTargets(
          message.payload?.headers?.find(
            (header) => header.name.toLowerCase() === "list-unsubscribe",
          )?.value,
        ).mailto;

        if (!unsubscribeMailto) {
          throw new ORPCError("BAD_REQUEST", {
            message: "This message does not expose a valid unsubscribe address.",
          });
        }

        const raw = arrayBufferToBase64Url(
          new TextEncoder().encode(
            buildPlainTextMessage(parseListUnsubscribeMailto(unsubscribeMailto)),
          ),
        );

        await sendRawMessage(accessToken, raw);

        return { sent: true };
      });
    }),

  getAttachment: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
        attachmentId: z.string(),
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        const attachment = await getMessageAttachment(
          accessToken,
          input.messageId,
          input.attachmentId,
          signal,
        );
        const bytes = attachment.data
          ? Uint8Array.from(
              atob(attachment.data.replaceAll("-", "+").replaceAll("_", "/")),
              (char) => char.charCodeAt(0),
            )
          : new Uint8Array();

        return {
          attachmentId: attachment.attachmentId ?? input.attachmentId,
          file: new File([bytes], input.fileName, {
            lastModified: Date.now(),
            type: input.mimeType,
          }),
          size: attachment.size ?? bytes.byteLength,
        };
      });
    }),
};
