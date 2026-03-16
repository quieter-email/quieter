import { auth } from "@quietr/auth";
import { getAuthEmailPreview } from "@quietr/auth/email-placeholder";
import { getAuthUserStatus } from "@quietr/auth/user-status";
import { TRPCError, initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "./context";
import { extractMessageContent } from "./gmail-message-content";
import {
  createDraft,
  deleteDraft,
  deleteMessagePermanently,
  getDraft,
  getMessageAttachment,
  getMailboxSyncDelta,
  getThreadWithDetails,
  listLabels,
  listMessagesWithDetails,
  markMessageAsRead,
  markMessageAsUnread,
  markThreadAsRead,
  markThreadAsUnread,
  moveMessageToTrash,
  sendDraft,
  updateDraft,
  updateMessageLabels,
  type MailboxCategory,
} from "./gmail-service";

const t = initTRPC.context<TrpcContext>().create();
const publicProcedure = t.procedure;

const mailboxCategorySchema = z.enum([
  "inbox",
  "spam",
  "sent",
  "trash",
] satisfies readonly MailboxCategory[]);

const authEmailInputSchema = z.object({
  email: z.string().trim().email(),
});

const composeDraftInputSchema = z.object({
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
  recipients: z.object({
    to: z.string(),
    cc: z.string(),
    bcc: z.string(),
  }),
  subject: z.string(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  attachments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      size: z.number(),
      mimeType: z.string(),
      isInline: z.boolean(),
      contentId: z.string().nullable().optional(),
      fileName: z.string().optional(),
      bytes: z.array(z.number().int().min(0).max(255)).optional(),
    }),
  ),
  inlineImages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      mimeType: z.string(),
      size: z.number(),
      contentId: z.string(),
      bytes: z.array(z.number().int().min(0).max(255)).optional(),
      isInline: z.boolean().optional(),
    }),
  ),
  saveStatus: z.string(),
  errorMessage: z.string().nullable().optional(),
  lastSavedAt: z.number().nullable().optional(),
  updatedAt: z.number(),
});

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;

const arrayBufferToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

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
  let output = btoa(String.fromCharCode(...value));
  output = output.replace(/.{1,76}/g, "$&\r\n").trim();
  return output;
};

const collectRecipients = (value: string) =>
  value
    .split(/[\n,;]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

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

const buildMimeMessage = (draft: ComposeDraftInput) => {
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

  const inlineImageParts = draft.inlineImages.flatMap((inlineImage) => {
    if (!inlineImage.bytes?.length) return [];

    return [
      `--${relatedBoundary}`,
      `Content-Type: ${inlineImage.mimeType}; name="${inlineImage.name}"`,
      `Content-Disposition: inline; filename="${inlineImage.name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${inlineImage.contentId}>`,
      "",
      base64WithCrlf(new Uint8Array(inlineImage.bytes)),
    ];
  });

  const htmlBody = draft.bodyHtml || "<p></p>";
  const htmlPart = inlineImageParts.length
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

  const attachments = draft.attachments.filter(
    (attachment) => !attachment.isInline && attachment.bytes?.length,
  );
  if (attachments.length > 0) {
    const attachmentParts = attachments.flatMap((attachment) => [
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.name}"`,
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64WithCrlf(new Uint8Array(attachment.bytes ?? [])),
    ]);

    body = [
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}`,
      "",
      body,
      ...attachmentParts,
      `--${mixedBoundary}--`,
    ].join("\r\n");
    contentType = `multipart/mixed; boundary="${mixedBoundary}"`;
  }

  return [...headers, `Content-Type: ${contentType}`, "", body].join("\r\n");
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
  };
};

const getGoogleAccessToken = async (ctx: TrpcContext) => {
  const response = await auth.api.getAccessToken({
    body: {
      providerId: "google",
    },
    headers: ctx.req.headers,
  });

  const accessToken = response?.accessToken;
  if (!accessToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Google account is not linked or Gmail access has not been granted.",
    });
  }

  return accessToken;
};

const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = await auth.api.getSession({ headers: ctx.req.headers });
  const userId = session?.user?.id;

  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      userId,
    },
  });
});

export const appRouter = t.router({
  auth: t.router({
    getEmailPreview: publicProcedure.input(authEmailInputSchema).query(({ input }) => {
      return getAuthEmailPreview(input.email);
    }),
    getUserStatus: publicProcedure.input(authEmailInputSchema).query(async ({ input }) => {
      return await getAuthUserStatus(input.email);
    }),
  }),
  gmail: t.router({
    listMessages: protectedProcedure
      .input(
        z.object({
          category: mailboxCategorySchema,
          pageToken: z.string().optional(),
          maxResults: z.number().int().positive().max(100).optional(),
          query: z.string().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        const result = await listMessagesWithDetails(accessToken, {
          mailbox: input.category,
          pageToken: input.pageToken,
          maxResults: input.maxResults,
          query: input.query?.trim() || undefined,
        });
        return result;
      }),
    getMailboxSyncDelta: protectedProcedure
      .input(
        z.object({
          category: mailboxCategorySchema,
          startHistoryId: z.string().min(1),
        }),
      )
      .query(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await getMailboxSyncDelta(accessToken, {
          mailbox: input.category,
          startHistoryId: input.startHistoryId,
        });
      }),
    getThread: protectedProcedure
      .input(z.object({ threadId: z.string() }))
      .query(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await getThreadWithDetails(accessToken, input.threadId);
      }),
    listLabels: protectedProcedure.query(async ({ ctx }) => {
      const accessToken = await getGoogleAccessToken(ctx);
      return await listLabels(accessToken);
    }),
    markMessageAsRead: protectedProcedure
      .input(z.object({ messageId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await markMessageAsRead(accessToken, input.messageId);
      }),
    markMessageAsUnread: protectedProcedure
      .input(z.object({ messageId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await markMessageAsUnread(accessToken, input.messageId);
      }),
    markThreadAsRead: protectedProcedure
      .input(z.object({ threadId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await markThreadAsRead(accessToken, input.threadId);
      }),
    markThreadAsUnread: protectedProcedure
      .input(z.object({ threadId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await markThreadAsUnread(accessToken, input.threadId);
      }),
    updateMessageLabels: protectedProcedure
      .input(
        z.object({
          messageId: z.string(),
          addLabelIds: z.array(z.string()).optional(),
          removeLabelIds: z.array(z.string()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await updateMessageLabels(accessToken, input.messageId, {
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        });
      }),
    moveMessageToTrash: protectedProcedure
      .input(z.object({ messageId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await moveMessageToTrash(accessToken, input.messageId);
      }),
    deleteMessagePermanently: protectedProcedure
      .input(z.object({ messageId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        return await deleteMessagePermanently(accessToken, input.messageId);
      }),
    loadDraft: protectedProcedure
      .input(z.object({ draftId: z.string() }))
      .query(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        const draft = await getDraft(accessToken, input.draftId);
        return parseDraftMessage(draft);
      }),
    saveDraft: protectedProcedure
      .input(z.object({ draft: composeDraftInputSchema }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        const raw = arrayBufferToBase64Url(new TextEncoder().encode(buildMimeMessage(input.draft)));
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
      }),
    sendDraft: protectedProcedure
      .input(z.object({ draft: composeDraftInputSchema }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);

        let draftId = input.draft.draftId ?? null;
        if (!draftId) {
          const raw = arrayBufferToBase64Url(
            new TextEncoder().encode(buildMimeMessage(input.draft)),
          );
          const savedDraft = await createDraft(
            accessToken,
            raw,
            input.draft.replyContext?.threadId,
          );
          draftId = savedDraft.id;
        }

        if (!draftId) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Draft could not be saved before send.",
          });
        }

        return await sendDraft(accessToken, draftId);
      }),
    deleteDraft: protectedProcedure
      .input(z.object({ draftId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        await deleteDraft(accessToken, input.draftId);
        return { deleted: true };
      }),
    getAttachment: protectedProcedure
      .input(
        z.object({
          messageId: z.string(),
          attachmentId: z.string(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        const attachment = await getMessageAttachment(
          accessToken,
          input.messageId,
          input.attachmentId,
        );
        const bytes = attachment.data
          ? Array.from(
              Uint8Array.from(
                atob(attachment.data.replaceAll("-", "+").replaceAll("_", "/")),
                (char) => char.charCodeAt(0),
              ),
            )
          : [];

        return {
          attachmentId: attachment.attachmentId ?? input.attachmentId,
          size: attachment.size ?? 0,
          data: attachment.data ?? null,
          bytes,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
