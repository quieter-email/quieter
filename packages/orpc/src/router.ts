import { ORPCError, os } from "@orpc/server";
import { auth, ensureUserOrganizationState } from "@quieter/auth";
import { getAuthEmailPreview } from "@quieter/auth/email-placeholder";
import { getAuthUserStatus } from "@quieter/auth/user-status";
import { z } from "zod";
import { getRequestHeaders, type OrpcContext } from "./context";
import { orpcErrorMap } from "./errors";
import {
  createDraft,
  deleteDraft,
  deleteMessagePermanently,
  deleteThreadPermanently,
  extractListUnsubscribeMailto,
  getDraft,
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
  sendDraft as sendGmailDraft,
  sendRawMessage,
  untrashMessage,
  untrashThread,
  updateDraft,
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
import {
  disconnectPersonalGmailMailbox,
  getAuthorizedGmailMailbox,
  getGoogleScopeRepairTarget,
  listMailboxesForOrganization,
  refreshAuthorizedGmailAccessToken,
  setDefaultMailbox,
  syncPersonalGmailMailboxes,
} from "./mailbox-service";

const base = os.errors(orpcErrorMap).$context<OrpcContext>();
const publicProcedure = base;

const mailboxCategorySchema = z.enum([
  "inbox",
  "spam",
  "sent",
  "trash",
  "drafts",
] satisfies readonly MailboxCategory[]);

const historySyncMailboxCategorySchema = z.enum(["inbox", "spam", "sent", "trash"]);
const mailboxIdSchema = z.string().trim().min(1);

type ProtectedContext = OrpcContext & {
  activeOrganizationId: string;
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

  const organizationState = await ensureUserOrganizationState(session.user, {
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    sessionToken: session.session.token,
  });

  return next({
    context: {
      ...context,
      activeOrganizationId: organizationState.activeOrganizationId,
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
  runner: (accessToken: string) => Promise<TValue>,
): Promise<TValue> => {
  const headers = getRequestHeaders(context);
  const { accessToken, mailbox } = await getAuthorizedGmailMailbox({
    activeOrganizationId: context.activeOrganizationId,
    headers,
    mailboxId,
  });

  try {
    return await runner(accessToken);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      return rethrowKnownRateLimit(context, error);
    }

    const refreshedAccessToken = await refreshAuthorizedGmailAccessToken({
      headers,
      providerAccountId: mailbox.providerAccountId,
      userId: mailbox.connectedUserId,
    });

    try {
      return await runner(refreshedAccessToken);
    } catch (retryError) {
      return rethrowKnownRateLimit(context, retryError);
    }
  }
};

export const appRouter = {
  auth: {
    getEmailPreview: publicProcedure
      .route({ method: "GET" })
      .input(
        z.object({
          email: z.string().trim().email(),
        }),
      )
      .handler(({ input }) => {
        return getAuthEmailPreview(input.email);
      }),
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
            activeOrganizationId: context.activeOrganizationId,
            headers: getRequestHeaders(context),
            preferredMailboxId: input.preferredMailboxId ?? null,
            targetAccountId: input.targetAccountId ?? null,
            userId: context.userId,
          });
        });
      }),
    listMailboxesForActiveOrganization: protectedProcedure
      .route({ method: "GET" })
      .handler(async ({ context }) => {
        return await listMailboxesForOrganization({
          activeOrganizationId: context.activeOrganizationId,
          headers: getRequestHeaders(context),
          userId: context.userId,
        });
      }),
    syncPersonalMailboxes: protectedProcedure.handler(async ({ context }) => {
      return await callWithRateLimitHandling(context, async () => {
        return await syncPersonalGmailMailboxes({
          activeOrganizationId: context.activeOrganizationId,
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
          activeOrganizationId: context.activeOrganizationId,
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
          activeOrganizationId: context.activeOrganizationId,
          mailboxId: input.mailboxId,
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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return input.category === "drafts"
            ? await listDraftsWithDetails(accessToken, {
                pageToken: input.pageToken,
                maxResults: input.maxResults,
                query: input.query?.trim() || undefined,
              })
            : await listMessagesWithDetails(accessToken, {
                mailbox: input.category,
                pageToken: input.pageToken,
                maxResults: input.maxResults,
                query: input.query?.trim() || undefined,
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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return await getMailboxSyncDelta(accessToken, {
            mailbox: input.category,
            startHistoryId: input.startHistoryId,
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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return await getThreadWithDetails(accessToken, input.threadId);
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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return await getMessageInspector(accessToken, input.messageId);
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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          return await listLabels(accessToken);
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
    loadDraft: protectedProcedure
      .route({ method: "GET" })
      .input(
        z.object({
          mailboxId: mailboxIdSchema,
          draftId: z.string(),
        }),
      )
      .handler(async ({ context, input }) => {
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          const draft = await getDraft(accessToken, input.draftId);
          return parseDraftMessage(draft);
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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          const message = await getGmailMessageMetadata(accessToken, input.messageId);
          const unsubscribeMailto = extractListUnsubscribeMailto(
            message.payload?.headers?.find(
              (header) => header.name.toLowerCase() === "list-unsubscribe",
            )?.value,
          );

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
        return await callGmail(context, input.mailboxId, async (accessToken) => {
          const attachment = await getMessageAttachment(
            accessToken,
            input.messageId,
            input.attachmentId,
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
