import { ORPCError, os } from "@orpc/server";
import { auth } from "@quieter/auth";
import { getAuthUserStatus } from "@quieter/auth/user-status";
import { z } from "zod";
import { getRequestHeaders, type OrpcContext } from "./context";
import { orpcErrorMap } from "./errors";
import {
  createDraft,
  createLabel,
  deleteDraft,
  deleteLabel,
  deleteMessagePermanently,
  deleteThreadPermanently,
  extractListUnsubscribeTargets,
  getGmailMessageMetadata,
  getMailboxSyncDelta,
  getMessageAttachment,
  getMessageInspector,
  getThreadWithDetails,
  isGmailRateLimitedError,
  isGmailServiceError,
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
  type MailboxCategory,
} from "./gmail-service";
import { parseDraftMessage } from "./gmail/compose/draft-parser";
import {
  arrayBufferToBase64Url,
  buildMimeMessage,
  buildPlainTextMessage,
} from "./gmail/compose/mime";
import {
  composeDraftInputSchema,
  composeSendDraftInputSchema,
  splitMailAddressList,
} from "./gmail/compose/schema";
import { checkMailDomainSetup, createMailDomainSetup } from "./mail-domain-service";
import {
  disconnectPersonalGmailMailbox,
  getAuthorizedGmailMailbox,
  getGoogleScopeRepairTarget,
  listMailboxes,
  refreshAuthorizedGmailAccessToken,
  setDefaultMailbox,
  syncPersonalGmailMailboxes,
  updateMailboxSwitcherOrder,
} from "./mailbox-service";

const base = os.errors(orpcErrorMap).$context<OrpcContext>();
const publicProcedure = base;

const mailboxCategorySchema = z.enum([
  "inbox",
  "unread",
  "spam",
  "sent",
  "trash",
  "drafts",
] satisfies readonly MailboxCategory[]);

const historySyncMailboxCategorySchema = z.enum(["inbox", "unread", "spam", "sent", "trash"]);
const mailboxIdSchema = z.string().trim().min(1);
const gmailUserLabelNameSchema = z.string().trim().min(1).max(225);
const mailboxSwitcherOrderSchema = z.object({
  groupIds: z.array(z.string().trim().min(1)),
  mailboxIdsByGroupId: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
});

type ProtectedContext = OrpcContext & {
  userId: string;
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

const protectedProcedure = base.use(async ({ context, errors, next }) => {
  const headers = getRequestHeaders(context);
  const session = await auth.api.getSession({ headers });

  if (!session?.user || !session.session) {
    throw errors.UNAUTHORIZED();
  }

  return next({
    context: {
      ...context,
      userId: session.user.id,
    },
  });
});

const toRetryAfterSeconds = (retryAfterMs?: number) =>
  Math.max(1, Math.ceil((retryAfterMs ?? 1000) / 1000));

const rethrowKnownRateLimit = (context: OrpcContext, error: unknown): never => {
  if (!isGmailRateLimitedError(error)) {
    throw error;
  }

  const retryAfter = toRetryAfterSeconds(error.retryAfterMs);
  context.resHeaders?.set("retry-after", String(retryAfter));

  throw new ORPCError("RATE_LIMITED", {
    data: {
      provider: "gmail",
      retryAfter,
    },
    message: error.message,
    status: 429,
  });
};

const callWithRateLimitHandling = async <TValue>(
  context: OrpcContext,
  callback: () => Promise<TValue>,
): Promise<TValue> => {
  try {
    return await callback();
  } catch (error) {
    return rethrowKnownRateLimit(context, error);
  }
};

const isGmailAuthError = (error: unknown) =>
  isGmailServiceError(error) &&
  error.status === 401 &&
  ((typeof error.googleReason === "string" && error.googleReason.toLowerCase() === "autherror") ||
    (typeof error.googleStatus === "string" &&
      error.googleStatus.toUpperCase() === "UNAUTHENTICATED"));

const callGmail = async <TValue>(
  context: ProtectedContext,
  mailboxId: string,
  runner: (accessToken: string, signal?: AbortSignal) => Promise<TValue>,
): Promise<TValue> => {
  const headers = getRequestHeaders(context);
  const { accessToken, mailbox } = await getAuthorizedGmailMailbox({
    headers,
    mailboxId,
    userId: context.userId,
  });

  try {
    return await runner(accessToken, context.signal);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      return rethrowKnownRateLimit(context, error);
    }

    const refreshedAccessToken = await refreshAuthorizedGmailAccessToken({
      emailAddress: mailbox.emailAddress,
      headers,
      mailboxId: mailbox.id,
      providerAccountId: mailbox.providerAccountId,
      userId: mailbox.connectedUserId,
    });

    try {
      return await runner(refreshedAccessToken, context.signal);
    } catch (retryError) {
      return rethrowKnownRateLimit(context, retryError);
    }
  }
};

export const appRouter = {
  auth: {
    getUserStatus: publicProcedure
      .route({ method: "GET" })
      .input(
        z.object({
          email: z.string().trim().email(),
        }),
      )
      .handler(async ({ input }) => {
        return await getAuthUserStatus(input.email);
      }),
  },
  mailDomains: {
    createSetup: protectedProcedure
      .input(
        z.object({
          domain: z.string().trim().min(1),
          organizationId: z.string().trim().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        return await createMailDomainSetup({
          domain: input.domain,
          organizationId: input.organizationId,
          userId: context.userId,
        });
      }),
    checkSetup: protectedProcedure
      .input(
        z.object({
          domain: z.string().trim().min(1),
          organizationId: z.string().trim().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        return await checkMailDomainSetup({
          domain: input.domain,
          organizationId: input.organizationId,
          userId: context.userId,
        });
      }),
  },
  mail: {
    getGoogleScopeRepairTarget: protectedProcedure
      .route({ method: "GET" })
      .input(
        z.object({
          preferredMailboxId: mailboxIdSchema.nullish(),
          targetAccountId: z.string().trim().min(1).nullish(),
        }),
      )
      .handler(async ({ context, input }) => {
        return await callWithRateLimitHandling(context, async () => {
          return await getGoogleScopeRepairTarget({
            headers: getRequestHeaders(context),
            preferredMailboxId: input.preferredMailboxId ?? null,
            targetAccountId: input.targetAccountId ?? null,
            userId: context.userId,
          });
        });
      }),
    listMailboxes: protectedProcedure.route({ method: "GET" }).handler(async ({ context }) => {
      return await listMailboxes({
        headers: getRequestHeaders(context),
        userId: context.userId,
      });
    }),
    syncPersonalMailboxes: protectedProcedure.handler(async ({ context }) => {
      return await callWithRateLimitHandling(context, async () => {
        return await syncPersonalGmailMailboxes({
          headers: getRequestHeaders(context),
          userId: context.userId,
        });
      });
    }),
    disconnectMailbox: protectedProcedure
      .input(
        z.object({
          mailboxId: mailboxIdSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        return await disconnectPersonalGmailMailbox({
          headers: getRequestHeaders(context),
          mailboxId: input.mailboxId,
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
        return await setDefaultMailbox({
          headers: getRequestHeaders(context),
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
      }),
    updateMailboxSwitcherOrder: protectedProcedure
      .input(mailboxSwitcherOrderSchema)
      .handler(async ({ context, input }) => {
        return await updateMailboxSwitcherOrder({
          headers: getRequestHeaders(context),
          order: input,
          userId: context.userId,
        });
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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return await moveThreadToTrash(accessToken, input.threadId);
        });
      }),
    deleteMessagePermanently: protectedProcedure
      .input(
        z.object({
          mailboxId: mailboxIdSchema,
          messageId: z.string(),
        }),
      )
      .handler(async ({ context, input }) => {
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return await deleteMessagePermanently(accessToken, input.messageId);
        });
      }),
    deleteThreadPermanently: protectedProcedure
      .input(
        z.object({
          mailboxId: mailboxIdSchema,
          threadId: z.string(),
        }),
      )
      .handler(async ({ context, input }) => {
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return await deleteThreadPermanently(accessToken, input.threadId);
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

          const parsed = parseDraftMessage(response);
          return {
            draftId: response.id,
            draftAnchor: parsed.draftAnchor,
            messageId: response.message?.id ?? parsed.messageId,
            bodyHtml: parsed.bodyHtml,
            bodyText: parsed.bodyText,
            replyContext: parsed.replyContext,
            subject: parsed.subject,
            recipients: parsed.recipients,
          };
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

          return await sendGmailDraft(
            accessToken,
            draftId,
            raw,
            input.draft.replyContext?.threadId,
          );
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
  },
};

export type AppRouter = typeof appRouter;
