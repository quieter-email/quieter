import { auth } from "@quietr/auth";
import { gmailMailboxState, gmailMessageCache } from "@quietr/database/schema";
import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { TrpcContext } from "./context";
import { extractMessageContent } from "./gmail-message-content";
import {
  createDraft,
  deleteDraft,
  deleteMessagePermanently,
  getDraft,
  getMessageAttachment,
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

const mailboxCategorySchema = z.enum([
  "inbox",
  "sent",
  "trash",
] satisfies readonly MailboxCategory[]);

const messageCacheSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  snippet: z.string().optional(),
  subject: z.string().optional(),
  from: z.string().optional(),
  date: z.string().optional(),
  internalDate: z.string().optional(),
});

const composeDraftInputSchema = z.object({
  localId: z.string(),
  draftId: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
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

const normalizeMessageIds = (messageIds: string[]): string[] =>
  Array.from(
    new Set(
      messageIds.map((messageId) => messageId.trim()).filter((messageId) => messageId.length > 0),
    ),
  );

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
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const buildMimeMessage = (draft: ComposeDraftInput) => {
  const headers: string[] = [];
  const toRecipients = collectRecipients(draft.recipients.to);
  const ccRecipients = collectRecipients(draft.recipients.cc);
  const bccRecipients = collectRecipients(draft.recipients.bcc);

  if (toRecipients.length > 0) headers.push(`To: ${toRecipients.join(", ")}`);
  if (ccRecipients.length > 0) headers.push(`Cc: ${ccRecipients.join(", ")}`);
  if (bccRecipients.length > 0) headers.push(`Bcc: ${bccRecipients.join(", ")}`);
  if (draft.subject.trim()) headers.push(`Subject: ${encodeMimeHeaderValue(draft.subject)}`);
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

const upsertMailboxState = async (
  ctx: TrpcContext & { userId: string },
  values: { lastSyncAt?: Date | null; lastError?: string | null },
) => {
  const now = new Date();

  await ctx.db
    .insert(gmailMailboxState)
    .values({
      userId: ctx.userId,
      lastSyncAt: values.lastSyncAt ?? null,
      lastError: values.lastError ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: gmailMailboxState.userId,
      set: {
        lastSyncAt: values.lastSyncAt ?? null,
        lastError: values.lastError ?? null,
        updatedAt: now,
      },
    });
};

const persistFetchedMessages = async (
  ctx: TrpcContext & { userId: string },
  messages: z.infer<typeof messageCacheSchema>[],
) => {
  if (messages.length === 0) return;

  const now = new Date();
  await ctx.db
    .insert(gmailMessageCache)
    .values(
      messages.map((message) => ({
        id: `${ctx.userId}:${message.id}`,
        userId: ctx.userId,
        messageId: message.id,
        threadId: message.threadId,
        snippet: message.snippet ?? null,
        subject: message.subject ?? null,
        from: message.from ?? null,
        date: message.date ?? null,
        internalDateMs: message.internalDate ? Number(message.internalDate) : null,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [gmailMessageCache.userId, gmailMessageCache.messageId],
      set: {
        threadId: sql`excluded."threadId"`,
        snippet: sql`excluded."snippet"`,
        subject: sql`excluded."subject"`,
        from: sql`excluded."from"`,
        date: sql`excluded."date"`,
        internalDateMs: sql`excluded."internalDateMs"`,
        updatedAt: now,
      },
    });

  await upsertMailboxState(ctx, { lastSyncAt: now, lastError: null });
};

export const appRouter = t.router({
  gmail: t.router({
    getCachedMessages: protectedProcedure
      .input(
        z.object({
          messageIds: z.array(z.string()).max(500),
        }),
      )
      .query(async ({ ctx, input }) => {
        const messageIds = normalizeMessageIds(input.messageIds);
        if (messageIds.length === 0) return [];

        const rows = await ctx.db
          .select({
            messageId: gmailMessageCache.messageId,
            threadId: gmailMessageCache.threadId,
            snippet: gmailMessageCache.snippet,
            subject: gmailMessageCache.subject,
            from: gmailMessageCache.from,
            date: gmailMessageCache.date,
            internalDateMs: gmailMessageCache.internalDateMs,
          })
          .from(gmailMessageCache)
          .where(
            and(
              eq(gmailMessageCache.userId, ctx.userId),
              inArray(gmailMessageCache.messageId, messageIds),
            ),
          );

        const rowsByMessageId = new Map(rows.map((row) => [row.messageId, row]));

        return messageIds
          .map((messageId) => rowsByMessageId.get(messageId))
          .filter((row): row is (typeof rows)[number] => Boolean(row))
          .map((row) => ({
            id: row.messageId,
            threadId: row.threadId,
            snippet: row.snippet ?? undefined,
            subject: row.subject ?? undefined,
            from: row.from ?? undefined,
            date: row.date ?? undefined,
            internalDate: row.internalDateMs == null ? undefined : String(row.internalDateMs),
          }));
      }),
    upsertCachedMessages: protectedProcedure
      .input(
        z.object({
          messages: z.array(messageCacheSchema).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const dedupedMessagesById = new Map<string, z.infer<typeof messageCacheSchema>>();

        for (const message of input.messages) {
          const normalizedMessageId = message.id.trim();
          if (!normalizedMessageId) continue;
          dedupedMessagesById.set(normalizedMessageId, { ...message, id: normalizedMessageId });
        }

        const messages = Array.from(dedupedMessagesById.values());
        await persistFetchedMessages(ctx, messages);
        return { saved: messages.length };
      }),
    listMessages: protectedProcedure
      .input(
        z.object({
          category: mailboxCategorySchema,
          pageToken: z.string().optional(),
          maxResults: z.number().int().positive().max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const accessToken = await getGoogleAccessToken(ctx);
        const result = await listMessagesWithDetails(accessToken, {
          mailbox: input.category,
          pageToken: input.pageToken,
          maxResults: input.maxResults,
        });

        await persistFetchedMessages(ctx, result.messages);
        return result;
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
          ? await updateDraft(accessToken, input.draft.draftId, raw)
          : await createDraft(accessToken, raw);

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
          const savedDraft = await createDraft(accessToken, raw);
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
