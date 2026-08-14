import { ORPCError } from "@orpc/server";
import {
  batchModifyMessages,
  createDraft,
  createLabel,
  deleteDraft,
  deleteLabel,
  extractListUnsubscribeTargets,
  getGmailMessageSender,
  getGmailMessageThreadAssociations,
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
import { reportError } from "@quieter/observability";
import { z } from "zod";

import type {
  learnAiMemoryFromMailAction as LearnAiMemoryFromMailAction,
  learnAiMemoryFromSentMessage as LearnAiMemoryFromSentMessage,
} from "../ai-memory";
import { saveGmailDraft, sendGmailMessage } from "../gmail-compose";
import { assertUserOrganizationMember } from "../mail-domain/service";
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
  deleteManagedDraft,
  getManagedMessageDelivery,
  getManagedMessageInspector,
  getManagedThread,
  listManagedMessages,
  saveManagedDraft,
  sendManagedMailboxMessage,
  setManagedMessageMailboxState,
  setManagedMessageReadState,
  setManagedThreadMailboxState,
  setManagedThreadReadState,
  applyManagedMessageChanges,
} from "../managed-mail/messages/service";
import {
  getOrganizationApiMailInspector,
  getOrganizationApiMailDelivery,
  getOrganizationApiMailThread,
  isOrganizationApiMailboxId,
  listOrganizationApiMailMessages,
  parseOrganizationApiMailboxId,
} from "../organization-api-mail";
import { hasText } from "../text";
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

type MailActionMemoryInput = Parameters<typeof LearnAiMemoryFromMailAction>[0];
type SentMessageMemoryInput = Parameters<
  typeof LearnAiMemoryFromSentMessage
>[0];

const learnAiMemoryFromMailAction = async (input: MailActionMemoryInput) => {
  const aiMemory = await import("../ai-memory");
  return await aiMemory.learnAiMemoryFromMailAction(input);
};

const learnAiMemoryFromSentMessage = async (input: SentMessageMemoryInput) => {
  const aiMemory = await import("../ai-memory");
  return await aiMemory.learnAiMemoryFromSentMessage(input);
};

const logDeferredLearningError = (message: string, error: unknown) => {
  reportError(error, { operation: message });
};

const normalizeOptionalQuery = (query: string | undefined) => {
  const trimmed = query?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
};

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

  const recipients = [
    ...new Set([
      ...splitMailAddressList(decodeURIComponent(url.pathname)),
      ...splitMailAddressList(url.searchParams.get("to") ?? ""),
    ]),
  ];

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
  messageSources?: Record<string, string | null | undefined>;
  providerMessageIds: string[];
  removeLabelIds?: string[];
  userId: string;
}) => {
  try {
    const { recordMailAutoLabelFeedback } =
      await import("../mail-automation/memory");
    await recordMailAutoLabelFeedback(input);
  } catch (error) {
    reportError(error, { operation: "mail:record-auto-label-feedback" });
  }
};

const GMAIL_LABEL_FEEDBACK_SOURCE_CONCURRENCY = 4;

const listGmailLabelFeedbackSources = async (
  accessToken: string,
  messageIds: string[]
) => {
  const { getSenderSource } = await import("../mail-automation/memory");
  const uniqueMessageIds = [...new Set(messageIds)];
  const chunks: string[][] = [];

  for (
    let index = 0;
    index < uniqueMessageIds.length;
    index += GMAIL_LABEL_FEEDBACK_SOURCE_CONCURRENCY
  ) {
    chunks.push(
      uniqueMessageIds.slice(
        index,
        index + GMAIL_LABEL_FEEDBACK_SOURCE_CONCURRENCY
      )
    );
  }

  const nestedEntries = await Promise.all(
    chunks.map(
      async (chunk) =>
        await Promise.all(
          chunk.map(async (messageId) => {
            try {
              return [
                messageId,
                getSenderSource(
                  await getGmailMessageSender(accessToken, messageId)
                ),
              ] as const;
            } catch {
              return [messageId, null] as const;
            }
          })
        )
    )
  );
  const entries = nestedEntries.flat();

  return Object.fromEntries(entries);
};

const recordGmailLabelFeedback = async (input: {
  accessToken: string;
  addLabelIds?: string[];
  mailboxId: string;
  providerMessageIds: string[];
  removeLabelIds?: string[];
  userId: string;
}) => {
  const { accessToken, ...feedback } = input;
  await recordLabelFeedback({
    ...feedback,
    messageSources: await listGmailLabelFeedbackSources(
      accessToken,
      input.providerMessageIds
    ),
  });
};

export const mailRouter = {
  ...mailboxProcedures,
  ...managedOrganizationMailRouter,
  applyChanges: protectedProcedure
    .input(
      z.object({
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
        mailboxId: mailboxIdSchema,
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
      })
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        const result = await applyManagedMessageChanges({
          ...input,
          userId: context.userId,
        });
        if (input.command.kind === "move") {
          await learnAiMemoryFromMailAction({
            action: `move:${input.command.destination}`,
            mailboxId: input.mailboxId,
            targetCount: input.targets.length,
            userId: context.userId,
          }).catch((error: unknown) => {
            logDeferredLearningError("Could not record mailbox action.", error);
          });
        }
        return {
          syncToken:
            result.revision === null ? undefined : String(result.revision),
          targets: result.targets,
        };
      }

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) => {
          const requestedMessageIds = [
            ...new Set(input.targets.flatMap((target) => target.messageIds)),
          ];
          const associations = await getGmailMessageThreadAssociations(
            accessToken,
            requestedMessageIds,
            signal
          );
          const threadIdByMessageId = new Map(
            associations.map((association) => [
              association.id,
              association.threadId,
            ])
          );
          const validTargets = input.targets.filter((target) =>
            target.messageIds.every(
              (messageId) =>
                threadIdByMessageId.get(messageId) === target.threadId
            )
          );
          const messageIds = [
            ...new Set(validTargets.flatMap((target) => target.messageIds)),
          ];
          const targetResults = input.targets.map((target) => ({
            status: validTargets.includes(target) ? "applied" : "failed",
            threadId: target.threadId,
          }));
          if (messageIds.length === 0) {
            return { targets: targetResults };
          }
          if (input.command.kind === "delete-permanently") {
            throw new ORPCError("BAD_REQUEST", {
              message: "Permanent bulk deletion is unavailable.",
            });
          }
          if (input.command.kind === "set-read") {
            await batchModifyMessages(
              accessToken,
              messageIds,
              input.command.read
                ? { removeLabelIds: ["UNREAD"] }
                : { addLabelIds: ["UNREAD"] },
              signal
            );
          } else if (input.command.kind === "set-labels") {
            await batchModifyMessages(
              accessToken,
              messageIds,
              {
                addLabelIds: input.command.addIds,
                removeLabelIds: input.command.removeIds,
              },
              signal
            );
          } else if (input.command.destination === "trash") {
            await Promise.all(
              messageIds.map(
                async (messageId) =>
                  await moveMessageToTrash(accessToken, messageId, signal)
              )
            );
          } else if (input.command.destination === "inbox") {
            await Promise.all(
              messageIds.map(
                async (messageId) =>
                  await untrashMessage(accessToken, messageId, signal)
              )
            );
            await batchModifyMessages(
              accessToken,
              messageIds,
              { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
              signal
            );
          } else {
            await batchModifyMessages(
              accessToken,
              messageIds,
              input.command.destination === "archive"
                ? { removeLabelIds: ["INBOX"] }
                : { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
              signal
            );
          }
          if (input.command.kind === "move") {
            await learnAiMemoryFromMailAction({
              action: `move:${input.command.destination}`,
              mailboxId: input.mailboxId,
              targetCount: validTargets.length,
              userId: context.userId,
            }).catch((error: unknown) => {
              logDeferredLearningError(
                "Could not record mailbox action.",
                error
              );
            });
          }
          return {
            targets: targetResults,
          };
        }
      );
    }),
  createLabel: protectedProcedure
    .input(
      z.object({
        color: mailboxLabelColorSchema.optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        mailboxId: mailboxIdSchema,
        name: gmailUserLabelNameSchema,
      })
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
      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) => {
          const { upsertSyncedGmailLabel } = await import("../gmail-labels");
          const label = await upsertSyncedGmailLabel(
            input.mailboxId,
            await createLabel(accessToken, input.name, signal),
            input.color
          );
          return {
            ...label,
            color: label.color,
            position: 0,
            provider: "gmail" as const,
            visible: true,
          };
        }
      );
    }),
  deleteDraft: protectedProcedure
    .input(
      z.object({
        draftId: z.string(),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await deleteManagedDraft({
          ...input,
          userId: context.userId,
        });
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        await deleteDraft(accessToken, input.draftId);
        return { deleted: true };
      });
    }),
  deleteLabel: protectedProcedure
    .input(
      z.object({
        labelId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      })
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
      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) => {
          const result = await deleteLabel(accessToken, input.labelId, signal);
          const { deleteSyncedGmailLabel } = await import("../gmail-labels");
          await deleteSyncedGmailLabel(input.mailboxId, input.labelId);
          return result;
        }
      );
    }),
  getAttachment: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        attachmentId: z.string(),
        fileName: z.string().min(1),
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
        mimeType: z.string().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await callGmail(
          context,
          input.mailboxId,
          async (accessToken, signal) => {
            const attachment = await getMessageAttachment(
              accessToken,
              input.messageId,
              input.attachmentId,
              signal
            );
            const attachmentData = attachment.data;
            const bytes = hasText(attachmentData)
              ? Uint8Array.from(
                  atob(
                    attachmentData.replaceAll("-", "+").replaceAll("_", "/")
                  ),
                  (char) => char.codePointAt(0) ?? 0
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
          }
        )
    ),
  getMessageDelivery: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      if (isOrganizationApiMailboxId(input.mailboxId)) {
        return await getOrganizationApiMailDelivery({
          ...input,
          userId: context.userId,
        });
      }

      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider !== "managed") {
        return null;
      }
      return await getManagedMessageDelivery({
        ...input,
        userId: context.userId,
      });
    }),
  getMessageInspector: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) =>
          await getMessageInspector(accessToken, input.messageId, signal)
      );
    }),
  getThread: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) =>
          await getThreadWithDetails(accessToken, input.threadId, signal)
      );
    }),
  listLabels: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) => {
          const { syncGmailLabels } = await import("../gmail-labels");
          const labels = await syncGmailLabels(
            input.mailboxId,
            await listLabels(accessToken, signal)
          );
          return labels.map((label, position) => ({
            ...label,
            color: label.color,
            position,
            provider: "gmail" as const,
            visible: true,
          }));
        }
      );
    }),
  listThreads: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        category: mailboxCategorySchema,
        mailboxId: mailboxIdSchema,
        maxResults: z.number().int().positive().max(100).optional(),
        pageToken: z.string().optional(),
        query: z.string().optional(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) =>
          input.category === "drafts"
            ? await listDraftsWithDetails(accessToken, {
                maxResults: input.maxResults,
                pageToken: input.pageToken,
                query: normalizeOptionalQuery(input.query),
                signal,
              })
            : await listMessagesWithDetails(accessToken, {
                mailbox: input.category,
                maxResults: input.maxResults,
                pageToken: input.pageToken,
                query: normalizeOptionalQuery(input.query),
                signal,
              })
      );
    }),
  markMessageAsRead: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await markMessageAsRead(accessToken, input.messageId)
      );
    }),
  markMessageAsUnread: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await markMessageAsUnread(accessToken, input.messageId)
      );
    }),
  markThreadAsRead: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await markThreadAsRead(accessToken, input.threadId)
      );
    }),
  markThreadAsUnread: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await markThreadAsUnread(accessToken, input.threadId)
      );
    }),
  moveMessageToTrash: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await moveMessageToTrash(accessToken, input.messageId)
      );
    }),
  moveThreadToTrash: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await moveThreadToTrash(accessToken, input.threadId)
      );
    }),
  saveDraft: protectedProcedure
    .input(
      z.object({
        draft: composeDraftInputSchema,
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        return await saveManagedDraft({
          ...input,
          userId: context.userId,
        });
      }

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await saveGmailDraft(accessToken, input.draft, context.signal)
      );
    }),
  sendDraft: protectedProcedure
    .input(
      z.object({
        draft: composeSendDraftInputSchema,
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await callGmail(context, input.mailboxId, async (accessToken) => {
          const raw = arrayBufferToBase64Url(
            new TextEncoder().encode(await buildMimeMessage(input.draft))
          );
          let draftId = input.draft.draftId ?? null;
          if (draftId === null || draftId.length === 0) {
            const savedDraft = await createDraft(
              accessToken,
              raw,
              input.draft.replyContext?.threadId
            );
            draftId = savedDraft.id;
          }

          if (draftId === null || draftId.length === 0) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Draft could not be saved before send.",
            });
          }

          const sent = await sendGmailDraft(
            accessToken,
            draftId,
            raw,
            input.draft.replyContext?.threadId
          );
          await learnAiMemoryFromSentMessage({
            bodyText: input.draft.bodyText,
            isReply: !!input.draft.replyContext,
            mailboxId: input.mailboxId,
            recipients: [
              input.draft.recipients.to,
              input.draft.recipients.cc,
              input.draft.recipients.bcc,
            ].join(","),
            userId: context.userId,
          }).catch((error: unknown) => {
            logDeferredLearningError(
              "Could not record sent-message learning.",
              error
            );
          });
          return sent;
        })
    ),
  sendMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        message: composeMessageInputSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (selectedMailbox.provider === "managed") {
        const sent = await sendManagedMailboxMessage({
          ...input,
          userId: context.userId,
        });
        await learnAiMemoryFromSentMessage({
          bodyText: input.message.bodyText,
          isReply: !!input.message.replyContext,
          mailboxId: input.mailboxId,
          recipients: [
            input.message.recipients.to,
            input.message.recipients.cc,
            input.message.recipients.bcc,
          ].join(","),
          userId: context.userId,
        }).catch((error: unknown) => {
          logDeferredLearningError(
            "Could not record sent-message learning.",
            error
          );
        });
        return sent;
      }

      return await callGmail(context, input.mailboxId, async (accessToken) => {
        const sent = await sendGmailMessage(
          accessToken,
          input.message,
          context.signal
        );
        await learnAiMemoryFromSentMessage({
          bodyText: input.message.bodyText,
          isReply: !!input.message.replyContext,
          mailboxId: input.mailboxId,
          recipients: [
            input.message.recipients.to,
            input.message.recipients.cc,
            input.message.recipients.bcc,
          ].join(","),
          userId: context.userId,
        }).catch((error: unknown) => {
          logDeferredLearningError(
            "Could not record sent-message learning.",
            error
          );
        });
        return sent;
      });
    }),
  syncMailbox: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        category: historySyncMailboxCategorySchema,
        mailboxId: mailboxIdSchema,
        startHistoryId: z.string().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      if (isOrganizationApiMailboxId(input.mailboxId)) {
        const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
        if (organizationId === null || organizationId.length === 0) {
          throw new ORPCError("NOT_FOUND", {
            message: "API mailbox not found.",
          });
        }
        await assertUserOrganizationMember({
          organizationId,
          userId: context.userId,
        });
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
        const historyId = String(selectedMailbox.contentRevision);
        const hasChanges = historyId !== input.startHistoryId;
        return {
          hasChanges,
          historyId,
          refreshFirstPage: hasChanges,
          removedMessageIds: [],
          requiresFullRefresh: hasChanges,
          updatedMessages: [],
        };
      }

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) =>
          await getMailboxSyncDelta(accessToken, {
            mailbox: input.category,
            signal,
            startHistoryId: input.startHistoryId,
          })
      );
    }),
  unsubscribeFromMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await callGmail(
          context,
          input.mailboxId,
          async (accessToken, signal) => {
            const message = await getGmailMessageMetadata(
              accessToken,
              input.messageId,
              signal
            );
            const unsubscribeMailto = extractListUnsubscribeTargets(
              message.payload?.headers?.find(
                (header) => header.name.toLowerCase() === "list-unsubscribe"
              )?.value
            ).mailto;

            if (
              unsubscribeMailto === undefined ||
              unsubscribeMailto.length === 0
            ) {
              throw new ORPCError("BAD_REQUEST", {
                message:
                  "This message does not expose a valid unsubscribe address.",
              });
            }

            const raw = arrayBufferToBase64Url(
              new TextEncoder().encode(
                buildPlainTextMessage(
                  parseListUnsubscribeMailto(unsubscribeMailto)
                )
              )
            );

            await sendRawMessage(accessToken, raw);

            return { sent: true };
          }
        )
    ),
  untrashMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await untrashMessage(accessToken, input.messageId)
      );
    }),
  untrashThread: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        threadId: z.string(),
      })
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

      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) => await untrashThread(accessToken, input.threadId)
      );
    }),
  updateLabel: protectedProcedure
    .input(
      z.object({
        color: mailboxLabelColorSchema.optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        labelId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
        name: gmailUserLabelNameSchema,
        position: z.number().int().nonnegative().optional(),
        visible: z.boolean().optional(),
      })
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
      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) => {
          const { upsertSyncedGmailLabel } = await import("../gmail-labels");
          const label = await upsertSyncedGmailLabel(
            input.mailboxId,
            await updateLabel(accessToken, input.labelId, input.name, signal),
            input.color
          );
          return {
            ...label,
            color: label.color,
            position: 0,
            provider: "gmail" as const,
            visible: true,
          };
        }
      );
    }),
  updateLabelDetails: protectedProcedure
    .input(
      z.object({
        description: z.string().trim().max(2000).nullable(),
        inclusionCriteria: z.string().trim().max(4000).nullable(),
        labelId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      })
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
      const { saveGmailLabelDetails } = await import("../gmail-labels");
      const updatedLabel = await saveGmailLabelDetails(input);
      if (updatedLabel === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Label not found." });
      }
      return updatedLabel;
    }),
  updateMessageLabels: protectedProcedure
    .input(
      z.object({
        addLabelIds: z.array(z.string()).optional(),
        mailboxId: mailboxIdSchema,
        messageId: z.string(),
        removeLabelIds: z.array(z.string()).optional(),
      })
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
        void recordGmailLabelFeedback({
          accessToken,
          addLabelIds: input.addLabelIds,
          mailboxId: input.mailboxId,
          providerMessageIds: [result.id],
          removeLabelIds: input.removeLabelIds,
          userId: context.userId,
        });
        return result;
      });
    }),
  updateThreadLabels: protectedProcedure
    .input(
      z.object({
        addLabelIds: z.array(z.string()).optional(),
        mailboxId: mailboxIdSchema,
        removeLabelIds: z.array(z.string()).optional(),
        threadId: z.string(),
      })
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
        void recordGmailLabelFeedback({
          accessToken,
          addLabelIds: input.addLabelIds,
          mailboxId: input.mailboxId,
          providerMessageIds: result.messages.map((message) => message.id),
          removeLabelIds: input.removeLabelIds,
          userId: context.userId,
        });
        return result;
      });
    }),
};
