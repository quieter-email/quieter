import { ORPCError } from "@orpc/server";
import { db, user } from "@quieter/database";
import {
  createDraft,
  createLabel,
  deleteDraft,
  deleteLabel,
  extractListUnsubscribeTargets,
  getDraft,
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
  updateDraft,
  updateLabel,
  updateMessageLabels,
  updateThreadLabels,
} from "@quieter/gmail";
import { parseDraftMessage } from "@quieter/gmail/compose";
import {
  arrayBufferToBase64Url,
  buildMimeMessage,
  buildPlainTextMessage,
} from "@quieter/mail/compose";
import {
  composeDraftInputSchema,
  composeMessageInputSchema,
  composeSendDraftInputSchema,
  splitMailAddressList,
} from "@quieter/mail/compose";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  applyMailboxSwitcherOrder,
  canonicalizeMailboxSwitcherOrder,
  createManagedMailbox,
  disconnectGmailMailbox,
  getUserMailboxPreferences,
  listAccessibleMailboxState,
  moveGmailMailbox,
  removeManagedMailboxGrant,
  resolveDefaultMailboxId,
  setManagedMailboxGrant,
  startGmailOAuth,
  assertAccessibleMailbox,
  type MailboxListItem,
} from "../mailbox";
import {
  deleteManagedMessage,
  deleteManagedThread,
  getManagedMessageInspector,
  getManagedThread,
  listManagedMessages,
  refreshManagedMessages,
  sendManagedMailboxMessage,
  setManagedMessageReadState,
  setManagedThreadReadState,
} from "../managed-mail";
import {
  callGmail,
  historySyncMailboxCategorySchema,
  gmailUserLabelNameSchema,
  mailboxCategorySchema,
  mailboxIdSchema,
  mailboxSwitcherOrderSchema,
  protectedProcedure,
} from "./base";

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

export const mailRouter = {
  listMailboxes: protectedProcedure.route({ method: "GET" }).handler(async ({ context }) => {
    const [mailboxPreferences, mailboxState] = await Promise.all([
      getUserMailboxPreferences(context.userId),
      listAccessibleMailboxState({ userId: context.userId }),
    ]);
    const { groups } = mailboxState;
    const orderedGroups = applyMailboxSwitcherOrder(
      groups,
      mailboxPreferences.mailboxSwitcherOrder,
    );
    const allMailboxes: MailboxListItem[] = orderedGroups.flatMap((group) => group.mailboxes);

    return {
      defaultMailboxId: resolveDefaultMailboxId(allMailboxes, mailboxPreferences.defaultMailboxId),
      groups: orderedGroups,
    };
  }),

  startGmailConnection: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema.optional(),
        organizationId: z.string().trim().min(1).nullable().optional(),
        returnTo: z.string().trim().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await startGmailOAuth({
        mailboxId: input.mailboxId,
        organizationId: input.organizationId,
        returnTo: input.returnTo,
        userId: context.userId,
      });
    }),

  disconnectMailbox: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      return await disconnectGmailMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
    }),

  moveGmailMailbox: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        organizationId: z.string().trim().min(1).nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await moveGmailMailbox({
        mailboxId: input.mailboxId,
        organizationId: input.organizationId,
        userId: context.userId,
      });
    }),

  createManagedMailbox: protectedProcedure
    .input(
      z.object({
        displayName: z.string().trim().max(120).nullable().optional(),
        emailAddress: z.string().trim().email(),
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return await createManagedMailbox({
        ...input,
        userId: context.userId,
      });
    }),

  setManagedMailboxGrant: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        role: z.enum(["reader", "responder", "manager"]),
        userId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return await setManagedMailboxGrant({
        mailboxId: input.mailboxId,
        role: input.role,
        targetUserId: input.userId,
        userId: context.userId,
      });
    }),

  removeManagedMailboxGrant: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        userId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return await removeManagedMailboxGrant({
        mailboxId: input.mailboxId,
        targetUserId: input.userId,
        userId: context.userId,
      });
    }),

  setDefaultMailbox: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema.nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.mailboxId) {
        const mailboxState = await listAccessibleMailboxState({ userId: context.userId });
        if (
          !mailboxState.groups.some((group) =>
            group.mailboxes.some((record) => record.id === input.mailboxId),
          )
        ) {
          throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
        }
      }

      await db
        .update(user)
        .set({ defaultMailboxId: input.mailboxId, updatedAt: new Date() })
        .where(eq(user.id, context.userId));

      return { defaultMailboxId: input.mailboxId };
    }),

  updateMailboxSwitcherOrder: protectedProcedure
    .input(mailboxSwitcherOrderSchema)
    .handler(async ({ context, input }) => {
      const mailboxState = await listAccessibleMailboxState({
        userId: context.userId,
      });
      const canonicalOrder = canonicalizeMailboxSwitcherOrder(mailboxState.groups, input);

      await db
        .update(user)
        .set({ mailboxSwitcherOrder: canonicalOrder, updatedAt: new Date() })
        .where(eq(user.id, context.userId));

      return { mailboxSwitcherOrder: canonicalOrder };
    }),

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
        return [];
      }

      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await listLabels(accessToken, signal);
      });
    }),

  createLabel: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        name: gmailUserLabelNameSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await createLabel(accessToken, input.name, signal);
      });
    }),

  updateLabel: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        labelId: z.string().trim().min(1),
        name: gmailUserLabelNameSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await updateLabel(accessToken, input.labelId, input.name, signal);
      });
    }),

  deleteLabel: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        labelId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return await callGmail(context, input.mailboxId, async (accessToken, signal) => {
        return await deleteLabel(accessToken, input.labelId, signal);
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
      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await updateThreadLabels(accessToken, input.threadId, {
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        });
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
      return await callGmail(context, input.mailboxId, async (accessToken) => {
        return await updateMessageLabels(accessToken, input.messageId, {
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        });
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
        return await deleteManagedMessage({
          ...input,
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
        return await deleteManagedThread({
          ...input,
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
        const raw = arrayBufferToBase64Url(
          new TextEncoder().encode(
            await buildMimeMessage(input.draft, { includeQuieterDraftHeaders: true }),
          ),
        );
        const response = input.draft.draftId
          ? await updateDraft(
              accessToken,
              input.draft.draftId,
              raw,
              input.draft.replyContext?.threadId,
            )
          : await createDraft(accessToken, raw, input.draft.replyContext?.threadId);

        const savedDraft = await getDraft(accessToken, response.id);
        const parsed = parseDraftMessage(savedDraft);
        return {
          draftId: savedDraft.id,
          draftAnchor: parsed.draftAnchor ?? input.draft.draftAnchor ?? null,
          messageId: savedDraft.message?.id ?? response.message?.id ?? parsed.messageId,
          bodyHtml: parsed.bodyHtml || input.draft.bodyHtml,
          bodyText: parsed.bodyText || input.draft.bodyText,
          replyContext: parsed.replyContext ?? input.draft.replyContext ?? null,
          subject: parsed.subject || input.draft.subject,
          recipients: {
            to: parsed.recipients.to || input.draft.recipients.to,
            cc: parsed.recipients.cc || input.draft.recipients.cc,
            bcc: parsed.recipients.bcc || input.draft.recipients.bcc,
          },
        };
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
        const raw = arrayBufferToBase64Url(
          new TextEncoder().encode(await buildMimeMessage(input.message)),
        );
        return await sendRawMessage(accessToken, raw, input.message.replyContext?.threadId);
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
