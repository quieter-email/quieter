import type { SendHeader } from "@quieter/mail/send";
import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  organizationApiMailAttachment,
  organizationApiMailMessage,
} from "@quieter/database/schema";
import {
  MAILBOX_LABELS,
  type ListMessagesPageResult,
  type MessageInspectorResult,
  type MessageListItem,
  type ThreadMessagesResult,
} from "@quieter/gmail";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { and, asc, count, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  assertUserCanManageOrganizationSettings,
  assertUserOrganizationMember,
} from "./mail-domain/service";
import { createManagedMailbox } from "./mailbox/managed-grants";
import { recordOutboundManagedMessageForSender } from "./managed-mail/messages/service";
import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
} from "./managed-mail/search/normalization";

const API_MAILBOX_ID_PREFIX = "api:";
const API_MESSAGE_PAGE_SIZE = 50;

export const getOrganizationApiMailboxId = (organizationId: string) =>
  `${API_MAILBOX_ID_PREFIX}${organizationId}`;

export const parseOrganizationApiMailboxId = (mailboxId: string) => {
  const normalized = mailboxId.trim();
  return normalized.startsWith(API_MAILBOX_ID_PREFIX)
    ? normalized.slice(API_MAILBOX_ID_PREFIX.length)
    : null;
};

export const isOrganizationApiMailboxId = (mailboxId: string) =>
  parseOrganizationApiMailboxId(mailboxId) !== null;

const normalizeEmailAddress = (value: string) => value.trim().toLowerCase();

const parsePageCursor = (pageToken: string | undefined) => {
  if (!pageToken) return null;
  try {
    const parsed = JSON.parse(Buffer.from(pageToken, "base64url").toString("utf8")) as {
      id?: unknown;
      sentAt?: unknown;
    };
    if (typeof parsed.id !== "string" || typeof parsed.sentAt !== "string") {
      throw new Error("Invalid cursor shape.");
    }
    const sentAt = new Date(parsed.sentAt);
    if (Number.isNaN(sentAt.getTime())) {
      throw new Error("Invalid cursor date.");
    }
    return { id: parsed.id, sentAt };
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "The message page token is invalid.",
    });
  }
};

const encodePageCursor = (record: { id: string; sentAt: Date }) =>
  Buffer.from(JSON.stringify({ id: record.id, sentAt: record.sentAt.toISOString() })).toString(
    "base64url",
  );

const getMessageMailboxState = async (input: {
  organizationId: string;
  senderAddress: string;
  userId: string;
}) => {
  const [senderMailbox, membership] = await Promise.all([
    db
      .select({
        id: mailbox.id,
        includeApiSentMessages: mailbox.includeApiSentMessages,
        provider: mailbox.provider,
      })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.organizationId, input.organizationId),
          eq(mailbox.emailAddress, input.senderAddress),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    assertUserOrganizationMember({
      organizationId: input.organizationId,
      userId: input.userId,
    }),
  ]);
  const canManageTeam = membership.role
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "admin" || part === "owner");

  return {
    canCreateMailbox: !senderMailbox && canManageTeam,
    canManageMailbox: senderMailbox?.provider === "managed" && canManageTeam,
    includedInMailbox:
      senderMailbox?.provider === "managed" ? senderMailbox.includeApiSentMessages : false,
    mailboxId: senderMailbox?.provider === "managed" ? senderMailbox.id : null,
  };
};

const toMessageListItem = async (
  record: typeof organizationApiMailMessage.$inferSelect,
  options: {
    attachmentCount?: number;
    includeApiSource?: boolean;
    userId: string;
  },
): Promise<MessageListItem> => {
  const mailboxState = options.includeApiSource
    ? await getMessageMailboxState({
        organizationId: record.organizationId,
        senderAddress: record.senderAddress,
        userId: options.userId,
      })
    : null;

  return {
    apiSource: mailboxState
      ? {
          canCreateMailbox: mailboxState.canCreateMailbox,
          canManageMailbox: mailboxState.canManageMailbox,
          includedInMailbox: mailboxState.includedInMailbox,
          organizationId: record.organizationId,
          senderAddress: record.senderAddress,
          senderMailboxId: mailboxState.mailboxId,
        }
      : undefined,
    bcc: record.bcc ?? undefined,
    bodyHtml: record.bodyHtml ?? undefined,
    bodyText: record.bodyText ?? undefined,
    cc: record.cc ?? undefined,
    date: record.sentAt.toISOString(),
    from: record.from,
    id: record.id,
    internalDate: String(record.sentAt.getTime()),
    isUnread: false,
    labelIds: [MAILBOX_LABELS.sent],
    messageHeaderId: record.messageHeaderId ?? undefined,
    replyTo: record.replyTo ?? undefined,
    senderAvatarUrls: await getSenderAvatarUrls(record.from),
    snippet: record.snippet ?? undefined,
    subject: record.subject ?? undefined,
    threadAttachmentCount: options.attachmentCount,
    threadId: record.id,
    threadMessageCount: 1,
    to: record.to ?? undefined,
  };
};

const findApiMessage = async (input: {
  messageId: string;
  organizationId: string;
  userId: string;
}) => {
  await assertUserOrganizationMember({
    organizationId: input.organizationId,
    userId: input.userId,
  });

  const [record] = await db
    .select()
    .from(organizationApiMailMessage)
    .where(
      and(
        eq(organizationApiMailMessage.id, input.messageId),
        eq(organizationApiMailMessage.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: "API message not found." });
  }
  return record;
};

export const recordOrganizationApiMailMessage = async (input: {
  attachments?: Array<{
    contentId?: string | null;
    fileName: string;
    inline: boolean;
    mimeType: string;
    size: number;
  }>;
  bcc?: string[];
  bodyHtml?: string;
  bodyText?: string;
  cc?: string[];
  headers?: SendHeader[];
  messageHeaderId?: string;
  organizationId: string;
  providerMessageId: string;
  rawSizeBytes?: number | null;
  replyTo?: string[];
  sender: string;
  senderAddress?: string;
  sentAt?: Date;
  subject: string;
  to: string[];
}) => {
  const id = randomUUID();
  const sentAt = input.sentAt ?? new Date();
  const senderAddress = normalizeEmailAddress(
    input.senderAddress ?? extractMailAddress(input.sender),
  );
  const snippet =
    (input.bodyText ?? input.bodyHtml?.replaceAll(/<[^>]+>/g, " "))
      ?.replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 240) || null;
  const [inserted] = await db
    .insert(organizationApiMailMessage)
    .values({
      bcc: input.bcc?.join(", ") || null,
      bccNormalized: normalizeManagedSearchValue(input.bcc?.join(", ")),
      bodyHtml: input.bodyHtml ?? null,
      bodyText: input.bodyText ?? null,
      cc: input.cc?.join(", ") || null,
      ccNormalized: normalizeManagedSearchValue(input.cc?.join(", ")),
      createdAt: sentAt,
      from: input.sender,
      fromNormalized: normalizeManagedSearchValue(input.sender),
      headers: input.headers ?? [],
      id,
      messageHeaderId: input.messageHeaderId ?? null,
      organizationId: input.organizationId,
      providerMessageId: input.providerMessageId,
      rawSizeBytes: input.rawSizeBytes ?? null,
      replyTo: input.replyTo?.join(", ") || null,
      searchText: createManagedMessageSearchText({
        bodyText: input.bodyText,
        snippet,
        subject: input.subject,
      }),
      senderAddress,
      sentAt,
      snippet,
      subject: input.subject || null,
      to: input.to.join(", "),
      toNormalized: normalizeManagedSearchValue(input.to.join(", ")),
      updatedAt: sentAt,
    })
    .onConflictDoNothing({
      target: [
        organizationApiMailMessage.organizationId,
        organizationApiMailMessage.providerMessageId,
      ],
    })
    .returning({ id: organizationApiMailMessage.id });

  if (!inserted || !input.attachments?.length) return inserted ?? null;

  await db.insert(organizationApiMailAttachment).values(
    input.attachments.map((attachment) => ({
      contentId: attachment.contentId ?? null,
      createdAt: sentAt,
      fileName: attachment.fileName,
      id: randomUUID(),
      inline: attachment.inline,
      messageId: inserted.id,
      mimeType: attachment.mimeType,
      normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
      organizationId: input.organizationId,
      size: attachment.size,
    })),
  );
  return inserted;
};

export const listOrganizationApiMailMessages = async (input: {
  category: string;
  mailboxId: string;
  maxResults?: number;
  pageToken?: string;
  query?: string;
  userId: string;
}): Promise<ListMessagesPageResult> => {
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (!organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  await assertUserOrganizationMember({ organizationId, userId: input.userId });
  if (input.category !== "sent") {
    return { messages: [], resultSizeEstimate: 0 };
  }

  const normalizedQuery = input.query?.trim();
  const queryCondition = normalizedQuery
    ? ilike(organizationApiMailMessage.searchText, `%${normalizedQuery}%`)
    : undefined;
  const where = and(eq(organizationApiMailMessage.organizationId, organizationId), queryCondition);
  const limit = Math.min(input.maxResults ?? API_MESSAGE_PAGE_SIZE, 100);
  const cursor = parsePageCursor(input.pageToken);
  const cursorCondition = cursor
    ? or(
        lt(organizationApiMailMessage.sentAt, cursor.sentAt),
        and(
          eq(organizationApiMailMessage.sentAt, cursor.sentAt),
          lt(organizationApiMailMessage.id, cursor.id),
        ),
      )
    : undefined;
  const [records, countRows] = await Promise.all([
    db
      .select()
      .from(organizationApiMailMessage)
      .where(and(where, cursorCondition))
      .orderBy(desc(organizationApiMailMessage.sentAt), desc(organizationApiMailMessage.id))
      .limit(limit + 1),
    db.select({ count: count() }).from(organizationApiMailMessage).where(where),
  ]);
  const hasNextPage = records.length > limit;
  const pageRecords = records.slice(0, limit);
  const attachmentCounts =
    pageRecords.length === 0
      ? []
      : await db
          .select({
            count: count(),
            messageId: organizationApiMailAttachment.messageId,
          })
          .from(organizationApiMailAttachment)
          .where(
            and(
              eq(organizationApiMailAttachment.organizationId, organizationId),
              inArray(
                organizationApiMailAttachment.messageId,
                pageRecords.map((record) => record.id),
              ),
            ),
          )
          .groupBy(organizationApiMailAttachment.messageId);
  const attachmentCountByMessageId = new Map(
    attachmentCounts.map((record) => [record.messageId, Number(record.count)]),
  );

  return {
    messages: await Promise.all(
      pageRecords.map((record) =>
        toMessageListItem(record, {
          attachmentCount: attachmentCountByMessageId.get(record.id) ?? 0,
          includeApiSource: true,
          userId: input.userId,
        }),
      ),
    ),
    nextPageToken:
      hasNextPage && pageRecords.length > 0
        ? encodePageCursor(pageRecords[pageRecords.length - 1])
        : undefined,
    resultSizeEstimate: Number(countRows[0]?.count ?? 0),
  };
};

export const getOrganizationApiMailThread = async (input: {
  mailboxId: string;
  threadId: string;
  userId: string;
}): Promise<ThreadMessagesResult> => {
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (!organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  const record = await findApiMessage({
    messageId: input.threadId,
    organizationId,
    userId: input.userId,
  });
  return {
    messages: [
      await toMessageListItem(record, {
        includeApiSource: true,
        userId: input.userId,
      }),
    ],
    snippet: record.snippet ?? undefined,
    subject: record.subject ?? undefined,
    threadId: record.id,
  };
};

export const getOrganizationApiMailInspector = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}): Promise<MessageInspectorResult> => {
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (!organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  const record = await findApiMessage({
    messageId: input.messageId,
    organizationId,
    userId: input.userId,
  });
  return {
    bcc: record.bcc ?? undefined,
    cc: record.cc ?? undefined,
    date: record.sentAt.toISOString(),
    from: record.from,
    headers: record.headers,
    id: record.id,
    messageHeaderId: record.messageHeaderId ?? undefined,
    rawText: record.bodyText ?? undefined,
    replyTo: record.replyTo ?? undefined,
    snippet: record.snippet ?? undefined,
    subject: record.subject ?? undefined,
    to: record.to ?? undefined,
  };
};

export const backfillApiMessagesForManagedMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const [targetMailbox] = await db
    .select({
      emailAddress: mailbox.emailAddress,
      includeApiSentMessages: mailbox.includeApiSentMessages,
      organizationId: mailbox.organizationId,
    })
    .from(mailbox)
    .where(and(eq(mailbox.id, input.mailboxId), eq(mailbox.provider, "managed")))
    .limit(1);
  if (!targetMailbox?.includeApiSentMessages) return;

  const records = await db
    .select()
    .from(organizationApiMailMessage)
    .where(
      and(
        eq(organizationApiMailMessage.organizationId, targetMailbox.organizationId),
        eq(organizationApiMailMessage.senderAddress, targetMailbox.emailAddress),
      ),
    )
    .orderBy(asc(organizationApiMailMessage.sentAt));

  for (const record of records) {
    const attachments = await db
      .select()
      .from(organizationApiMailAttachment)
      .where(eq(organizationApiMailAttachment.messageId, record.id));
    await recordOutboundManagedMessageForSender({
      attachments: attachments.map((attachment) => ({
        contentId: attachment.contentId,
        fileName: attachment.fileName,
        inline: attachment.inline,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      bcc: record.bcc ? [record.bcc] : [],
      bodyHtml: record.bodyHtml ?? undefined,
      bodyText: record.bodyText ?? undefined,
      cc: record.cc ? [record.cc] : [],
      headers: record.headers,
      messageHeaderId: record.messageHeaderId ?? undefined,
      organizationId: record.organizationId,
      providerMessageId: record.providerMessageId,
      rawSizeBytes: record.rawSizeBytes,
      replyTo: record.replyTo ? [record.replyTo] : [],
      requireApiSentMessageInclusion: true,
      sender: record.from,
      senderAddress: record.senderAddress,
      sentAt: record.sentAt,
      subject: record.subject ?? "",
      to: record.to ? [record.to] : [],
    });
  }
};

export const createManagedMailboxForApiMessage = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (!organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  await assertUserCanManageOrganizationSettings({ organizationId, userId: input.userId });
  const record = await findApiMessage({
    messageId: input.messageId,
    organizationId,
    userId: input.userId,
  });

  const [existingMailbox] = await db
    .select({ id: mailbox.id, provider: mailbox.provider })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, organizationId),
        eq(mailbox.emailAddress, record.senderAddress),
      ),
    )
    .limit(1);
  if (existingMailbox?.provider === "managed") {
    await db
      .update(mailbox)
      .set({ includeApiSentMessages: true, updatedAt: new Date() })
      .where(eq(mailbox.id, existingMailbox.id));
    await backfillApiMessagesForManagedMailbox({
      mailboxId: existingMailbox.id,
      userId: input.userId,
    });
    return { mailboxId: existingMailbox.id };
  }
  if (existingMailbox) {
    throw new ORPCError("CONFLICT", {
      message: "A mailbox with this address already exists.",
    });
  }

  const created = await createManagedMailbox({
    displayName: record.senderAddress,
    emailAddress: record.senderAddress,
    includeApiSentMessages: true,
    organizationId,
    userId: input.userId,
  });
  await backfillApiMessagesForManagedMailbox({
    mailboxId: created.mailboxId,
    userId: input.userId,
  });
  return created;
};
