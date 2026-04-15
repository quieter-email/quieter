import { ORPCError, os } from "@orpc/server";
import { auth, ensureUserOrganizationState } from "@quietr/auth";
import { getAuthEmailPreview } from "@quietr/auth/email-placeholder";
import { getAuthUserStatus } from "@quietr/auth/user-status";
import { z } from "zod";
import {
  composeDraftInputSchema,
  composeSendDraftInputSchema,
  splitMailAddressList,
} from "./compose";
import { getRequestHeaders, type OrpcContext } from "./context";
import { orpcErrorMap } from "./errors";
import {
  extractInlineMessageAttachments,
  extractMessageAttachments,
  extractMessageContent,
} from "./gmail-message-content";
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
  listDraftsWithDetails,
  listLabels,
  listMessagesWithDetails,
  markMessageAsRead,
  markMessageAsUnread,
  markThreadAsRead,
  markThreadAsUnread,
  moveMessageToTrash,
  moveThreadToTrash,
  sendDraft,
  sendRawMessage,
  untrashMessage,
  updateDraft,
  updateMessageLabels,
  updateThreadLabels,
  type MailboxCategory,
} from "./gmail-service";
import { listMailMessagesForOrganization, normalizeMailDomain } from "./mail-service";
import {
  disconnectPersonalGmailMailbox,
  getAuthorizedGmailMailbox,
  getGoogleScopeRepairTarget,
  listMailboxesForOrganization,
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

const authEmailInputSchema = z.object({
  email: z.string().trim().email(),
});

const mailboxIdSchema = z.string().trim().min(1);

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;
type ProtectedContext = OrpcContext & {
  activeOrganizationId: string;
  userId: string;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const arrayBufferToBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

const createMimeBoundary = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

const encodeMimeHeaderValue = (value: string) => {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
};

const encodeQuotedPrintable = (value: string) => {
  const bytes = new TextEncoder().encode(value.replaceAll("\r\n", "\n"));
  let output = "";

  for (const byte of bytes) {
    const isPrintable = (byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126);
    if (isPrintable || byte === 9 || byte === 32) {
      output += String.fromCharCode(byte);
    } else if (byte === 10) {
      output += "\r\n";
    } else {
      output += `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }

  return output;
};

const base64WithCrlf = (value: Uint8Array) => {
  const output = bytesToBase64(value);
  return output.replace(/.{1,76}/g, "$&\r\n").trim();
};

const fileToBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

const collectRecipients = (value: string) => splitMailAddressList(value);

const collectReplyReferences = (draft: ComposeDraftInput) => {
  const values = [...(draft.replyContext?.references ?? []), draft.replyContext?.messageHeaderId];
  const seen = new Set<string>();
  const references: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    references.push(normalized);
  }

  return references;
};

const buildMimeMessage = async (draft: ComposeDraftInput) => {
  const headers: string[] = [];
  const toRecipients = collectRecipients(draft.recipients.to);
  const ccRecipients = collectRecipients(draft.recipients.cc);
  const bccRecipients = collectRecipients(draft.recipients.bcc);
  const replyReferences = collectReplyReferences(draft);

  if (toRecipients.length > 0) headers.push(`To: ${toRecipients.join(", ")}`);
  if (ccRecipients.length > 0) headers.push(`Cc: ${ccRecipients.join(", ")}`);
  if (bccRecipients.length > 0) headers.push(`Bcc: ${bccRecipients.join(", ")}`);
  if (draft.subject.trim()) headers.push(`Subject: ${encodeMimeHeaderValue(draft.subject)}`);
  if (draft.replyContext?.messageHeaderId) {
    headers.push(`In-Reply-To: ${draft.replyContext.messageHeaderId}`);
  }
  if (replyReferences.length > 0) {
    headers.push(`References: ${replyReferences.join(" ")}`);
  }
  headers.push("MIME-Version: 1.0");

  const alternativeBoundary = createMimeBoundary("alt");
  const relatedBoundary = createMimeBoundary("rel");
  const mixedBoundary = createMimeBoundary("mix");

  const textPart = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(draft.bodyText || ""),
  ].join("\r\n");

  const inlineImageParts = (
    await Promise.all(
      draft.inlineImages.map(async (inlineImage) => {
        if (!inlineImage.file) {
          return null;
        }

        return [
          `--${relatedBoundary}`,
          `Content-Type: ${inlineImage.mimeType}; name="${inlineImage.name}"`,
          `Content-Disposition: inline; filename="${inlineImage.name}"`,
          "Content-Transfer-Encoding: base64",
          `Content-ID: <${inlineImage.contentId}>`,
          "",
          base64WithCrlf(await fileToBytes(inlineImage.file)),
        ].join("\r\n");
      }),
    )
  ).filter((part): part is string => Boolean(part));

  const htmlBody = draft.bodyHtml || "<p></p>";
  const htmlPart =
    inlineImageParts.length > 0
      ? [
          `--${alternativeBoundary}`,
          `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
          "",
          `--${relatedBoundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: quoted-printable",
          "",
          encodeQuotedPrintable(htmlBody),
          ...inlineImageParts,
          `--${relatedBoundary}--`,
        ].join("\r\n")
      : [
          `--${alternativeBoundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: quoted-printable",
          "",
          encodeQuotedPrintable(htmlBody),
        ].join("\r\n");

  let body = [textPart, htmlPart, `--${alternativeBoundary}--`].join("\r\n");
  let contentType = `multipart/alternative; boundary="${alternativeBoundary}"`;

  const attachments = (
    await Promise.all(
      draft.attachments
        .filter((attachment) => !attachment.isInline)
        .map(async (attachment) => {
          if (!attachment.file) {
            return null;
          }

          return [
            `--${mixedBoundary}`,
            `Content-Type: ${attachment.mimeType}; name="${attachment.name}"`,
            `Content-Disposition: attachment; filename="${attachment.name}"`,
            "Content-Transfer-Encoding: base64",
            "",
            base64WithCrlf(await fileToBytes(attachment.file)),
          ].join("\r\n");
        }),
    )
  ).filter((part): part is string => Boolean(part));

  if (attachments.length > 0) {
    body = [
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}`,
      "",
      body,
      ...attachments,
      `--${mixedBoundary}--`,
    ].join("\r\n");
    contentType = `multipart/mixed; boundary="${mixedBoundary}"`;
  }

  return [...headers, `Content-Type: ${contentType}`, "", body].join("\r\n");
};

const buildPlainTextMessage = ({
  body,
  subject,
  to,
}: {
  body: string;
  subject: string;
  to: string;
}) => {
  const headers = [`To: ${to}`];

  if (subject.trim()) {
    headers.push(`Subject: ${encodeMimeHeaderValue(subject)}`);
  }

  return [
    ...headers,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(body),
  ].join("\r\n");
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

const parseDraftMessage = (draft: Awaited<ReturnType<typeof getDraft>>) => {
  const message = draft.message;
  if (!message) {
    return {
      subject: "",
      bodyHtml: "",
      bodyText: "",
      recipients: {
        to: "",
        cc: "",
        bcc: "",
      },
      messageId: null,
      attachments: [],
      inlineImages: [],
    };
  }

  const content = extractMessageContent(message.payload);
  const headers = message.payload?.headers ?? [];
  const readHeader = (name: string) =>
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  return {
    subject: readHeader("Subject"),
    bodyHtml: content.html ?? "",
    bodyText: content.text ?? "",
    recipients: {
      to: readHeader("To"),
      cc: readHeader("Cc"),
      bcc: readHeader("Bcc"),
    },
    messageId: message.id,
    attachments: extractMessageAttachments(message.payload),
    inlineImages: extractInlineMessageAttachments(message.payload),
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

const getAuthorizedGmailAccess = async (context: ProtectedContext, mailboxId: string) => {
  return await getAuthorizedGmailMailbox({
    activeOrganizationId: context.activeOrganizationId,
    headers: getRequestHeaders(context),
    mailboxId,
  });
};

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

const loadMailAwsService = async () => {
  return await import("./mail-aws-service");
};

export const appRouter = {
  auth: {
    getEmailPreview: publicProcedure
      .route({ method: "GET" })
      .input(authEmailInputSchema)
      .handler(({ input }) => {
        return getAuthEmailPreview(input.email);
      }),
    getUserStatus: publicProcedure
      .route({ method: "GET" })
      .input(authEmailInputSchema)
      .handler(async ({ input }) => {
        return await getAuthUserStatus(input.email);
      }),
  },
  mail: {
    listDomains: protectedProcedure.route({ method: "GET" }).handler(async ({ context }) => {
      const { listMailDomainSetupsForOrganization } = await loadMailAwsService();
      return await listMailDomainSetupsForOrganization(context.activeOrganizationId);
    }),
    getDomainSetup: protectedProcedure
      .route({ method: "GET" })
      .input(
        z.object({
          domainId: z.string().trim().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const { getMailDomainSetup } = await loadMailAwsService();
        return await getMailDomainSetup(input.domainId, context.activeOrganizationId);
      }),
    registerDomain: protectedProcedure
      .input(
        z.object({
          domain: z
            .string()
            .trim()
            .min(1)
            .transform((domain) => normalizeMailDomain(domain)),
          inboundKeyPrefix: z.string().trim().min(1).optional(),
          isActive: z.boolean().optional(),
          s3Bucket: z.string().trim().min(1).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const { registerMailDomain } = await loadMailAwsService();
        return await registerMailDomain({
          domain: input.domain,
          inboundKeyPrefix: input.inboundKeyPrefix,
          isActive: input.isActive,
          organizationId: context.activeOrganizationId,
          s3Bucket: input.s3Bucket,
        });
      }),
    refreshDomain: protectedProcedure
      .input(
        z.object({
          domainId: z.string().trim().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const { getMailDomainSetup } = await loadMailAwsService();
        const setup = await getMailDomainSetup(input.domainId, context.activeOrganizationId);

        if (!setup) {
          throw new ORPCError("NOT_FOUND", {
            message: "Mail domain not found.",
          });
        }

        return setup;
      }),
    sendManaged: protectedProcedure
      .input(
        z
          .object({
            bcc: z.array(z.string().trim().email()).optional(),
            cc: z.array(z.string().trim().email()).optional(),
            from: z.string().trim().email(),
            html: z.string().min(1).optional(),
            replyTo: z.array(z.string().trim().email()).optional(),
            subject: z.string().trim().min(1),
            text: z.string().min(1).optional(),
            to: z.array(z.string().trim().email()).min(1),
          })
          .refine((input) => Boolean(input.html || input.text), {
            message: "Either text or html is required.",
            path: ["text"],
          }),
      )
      .handler(async ({ input }) => {
        const { sendManagedMail } = await loadMailAwsService();
        return await sendManagedMail(input);
      }),
    upsertDomain: protectedProcedure
      .input(
        z.object({
          domain: z
            .string()
            .trim()
            .min(1)
            .transform((domain) => normalizeMailDomain(domain)),
          inboundKeyPrefix: z.string().trim().min(1).optional(),
          isActive: z.boolean().optional(),
          s3Bucket: z.string().trim().min(1).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const { registerMailDomain } = await loadMailAwsService();
        return await registerMailDomain({
          domain: input.domain,
          inboundKeyPrefix: input.inboundKeyPrefix,
          isActive: input.isActive,
          organizationId: context.activeOrganizationId,
          s3Bucket: input.s3Bucket,
        });
      }),
    listStoredMessages: protectedProcedure
      .route({ method: "GET" })
      .input(
        z
          .object({
            limit: z.coerce.number().int().min(1).max(100).optional(),
          })
          .optional(),
      )
      .handler(async ({ context, input }) => {
        return await listMailMessagesForOrganization({
          limit: input?.limit,
          organizationId: context.activeOrganizationId,
        });
      }),
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);

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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);

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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);

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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);

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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
          return await untrashMessage(accessToken, input.messageId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
          const raw = arrayBufferToBase64Url(
            new TextEncoder().encode(await buildMimeMessage(input.draft)),
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
            messageId: response.message?.id ?? parsed.messageId,
            bodyHtml: parsed.bodyHtml,
            bodyText: parsed.bodyText,
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);

          let draftId = input.draft.draftId ?? null;
          if (!draftId) {
            const raw = arrayBufferToBase64Url(
              new TextEncoder().encode(await buildMimeMessage(input.draft)),
            );
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

          return await sendDraft(accessToken, draftId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
        return await callWithRateLimitHandling(context, async () => {
          const { accessToken } = await getAuthorizedGmailAccess(context, input.mailboxId);
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
