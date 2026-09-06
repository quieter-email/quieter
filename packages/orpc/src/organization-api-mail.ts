import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  organizationApiMailAttachment,
  organizationApiMailMessage,
  organizationMailDeliveryRecipient,
} from "@quieter/database/schema";
import { MAILBOX_LABELS } from "@quieter/gmail";
import type {
  ListMessagesPageResult,
  MessageInspectorResult,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/gmail";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import type { SendHeader } from "@quieter/mail/send";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { and, asc, count, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";

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
import {
  getOrganizationMailDelivery,
  groupDeliveryStatusesByMessage,
} from "./organization-mail-delivery";
import { hasText } from "./text";

const API_MAILBOX_ID_PREFIX = "api:";
const API_MESSAGE_PAGE_SIZE = 50;
const API_MESSAGE_BACKFILL_LIMIT = 500;
const MAILBOX_EMAIL_UNIQUE_CONSTRAINT = "mailbox_email_address_unique";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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
  if (!hasText(pageToken)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(pageToken, "base64url").toString("utf-8")
    );
    if (!isRecord(parsed)) {
      throw new TypeError("Invalid cursor shape.");
    }
    if (typeof parsed.id !== "string" || typeof parsed.sentAt !== "string") {
      throw new TypeError("Invalid cursor shape.");
    }
    const sentAt = new Date(parsed.sentAt);
    if (Number.isNaN(sentAt.getTime())) {
      throw new TypeError("Invalid cursor date.");
    }
    return { id: parsed.id, sentAt };
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "The message page token is invalid.",
    });
  }
};

const encodePageCursor = (record: { id: string; sentAt: Date }) =>
  Buffer.from(
    JSON.stringify({ id: record.id, sentAt: record.sentAt.toISOString() })
  ).toString("base64url");

type ApiMessageMailboxState = {
  canCreateMailbox: boolean;
  canManageMailbox: boolean;
  includedInMailbox: boolean;
  mailboxId: string | null;
};

const canManageOrganization = (role: string) =>
  role
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "admin" || part === "owner");

const getPostgresErrorField = (
  error: unknown,
  field: "code" | "constraint"
): string | undefined => {
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  const value: unknown = Object.getOwnPropertyDescriptor(error, field)?.value;
  if (typeof value === "string") {
    return value;
  }
  const cause: unknown = Object.getOwnPropertyDescriptor(error, "cause")?.value;
  return getPostgresErrorField(cause, field);
};

const isMailboxEmailUniqueError = (error: unknown) =>
  getPostgresErrorField(error, "code") === "23505" &&
  [undefined, MAILBOX_EMAIL_UNIQUE_CONSTRAINT].includes(
    getPostgresErrorField(error, "constraint")
  );

const findMailboxByAddress = async (
  organizationId: string,
  emailAddress: string
) => {
  const [existingMailbox] = await db
    .select({ id: mailbox.id, provider: mailbox.provider })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, organizationId),
        eq(mailbox.emailAddress, emailAddress)
      )
    )
    .limit(1);
  return existingMailbox ?? null;
};

const toApiMessageMailboxState = (
  senderMailbox: {
    id: string;
    includeApiSentMessages: boolean;
    provider: string;
    emailAddress?: string;
  } | null,
  canManageTeam: boolean
): ApiMessageMailboxState => ({
  canCreateMailbox: senderMailbox === null && canManageTeam,
  canManageMailbox: senderMailbox?.provider === "managed" && canManageTeam,
  includedInMailbox:
    senderMailbox?.provider === "managed"
      ? senderMailbox.includeApiSentMessages
      : false,
  mailboxId: senderMailbox?.provider === "managed" ? senderMailbox.id : null,
});

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
          eq(mailbox.emailAddress, input.senderAddress)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    assertUserOrganizationMember({
      organizationId: input.organizationId,
      userId: input.userId,
    }),
  ]);
  return toApiMessageMailboxState(
    senderMailbox,
    canManageOrganization(membership.role)
  );
};

const createSnippet = (input: { bodyHtml?: string; bodyText?: string }) => {
  const rawBody =
    input.bodyText ?? input.bodyHtml?.replaceAll(/<[^>]+>/gu, " ");
  if (!hasText(rawBody)) {
    return null;
  }
  const trimmed = rawBody.replaceAll(/\s+/gu, " ").trim().slice(0, 240);
  return hasText(trimmed) ? trimmed : null;
};

const toMessageListItem = async (
  record: typeof organizationApiMailMessage.$inferSelect,
  options: {
    attachmentCount?: number;
    includeApiSource?: boolean;
    mailboxState?: ApiMessageMailboxState | null;
    userId: string;
  }
): Promise<MessageListItem> => {
  let { mailboxState } = options;
  if (mailboxState === undefined && options.includeApiSource === true) {
    mailboxState = await getMessageMailboxState({
      organizationId: record.organizationId,
      senderAddress: record.senderAddress,
      userId: options.userId,
    });
  }

  let apiSource: MessageListItem["apiSource"];
  if (mailboxState !== null && mailboxState !== undefined) {
    apiSource = {
      canCreateMailbox: mailboxState.canCreateMailbox,
      canManageMailbox: mailboxState.canManageMailbox,
      includedInMailbox: mailboxState.includedInMailbox,
      organizationId: record.organizationId,
      senderAddress: record.senderAddress,
      senderMailboxId: mailboxState.mailboxId,
    };
  }

  return {
    apiSource,
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
        eq(organizationApiMailMessage.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "API message not found." });
  }
  return record;
};

const hasAttachmentsToRecord = (
  inserted: { id: string } | undefined,
  attachmentCount: number
) => inserted !== undefined && attachmentCount > 0;

export const recordOrganizationApiMailMessage = async (input: {
  attachments?: {
    contentId?: string | null;
    fileName: string;
    inline: boolean;
    mimeType: string;
    size: number;
  }[];
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
    input.senderAddress ?? extractMailAddress(input.sender)
  );
  const snippet = createSnippet({
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
  });
  const bccJoined = input.bcc?.join(", ");
  const ccJoined = input.cc?.join(", ");
  const replyToJoined = input.replyTo?.join(", ");
  const [inserted] = await db
    .insert(organizationApiMailMessage)
    .values({
      bcc: hasText(bccJoined) ? bccJoined : null,
      bccNormalized: normalizeManagedSearchValue(bccJoined),
      bodyHtml: input.bodyHtml ?? null,
      bodyText: input.bodyText ?? null,
      cc: hasText(ccJoined) ? ccJoined : null,
      ccNormalized: normalizeManagedSearchValue(ccJoined),
      createdAt: sentAt,
      from: input.sender,
      fromNormalized: normalizeManagedSearchValue(input.sender),
      headers: input.headers ?? [],
      id,
      messageHeaderId: input.messageHeaderId ?? null,
      organizationId: input.organizationId,
      providerMessageId: input.providerMessageId,
      rawSizeBytes: input.rawSizeBytes ?? null,
      replyTo: hasText(replyToJoined) ? replyToJoined : null,
      searchText: createManagedMessageSearchText({
        bodyText: input.bodyText,
        snippet,
        subject: input.subject,
      }),
      senderAddress,
      sentAt,
      snippet,
      subject: hasText(input.subject) ? input.subject : null,
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

  const attachmentCount = input.attachments?.length ?? 0;
  if (!hasAttachmentsToRecord(inserted, attachmentCount)) {
    return inserted ?? null;
  }

  const attachments = input.attachments ?? [];
  await db.insert(organizationApiMailAttachment).values(
    attachments.map((attachment) => ({
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
    }))
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
  if (organizationId === null) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  const membership = await assertUserOrganizationMember({
    organizationId,
    userId: input.userId,
  });
  if (input.category !== "sent") {
    return { messages: [], resultSizeEstimate: 0 };
  }

  const normalizedQuery = input.query?.trim();
  let queryCondition;
  if (hasText(normalizedQuery)) {
    queryCondition = ilike(
      organizationApiMailMessage.searchText,
      `%${normalizedQuery}%`
    );
  }
  const where = and(
    eq(organizationApiMailMessage.organizationId, organizationId),
    queryCondition
  );
  const limit = Math.min(input.maxResults ?? API_MESSAGE_PAGE_SIZE, 100);
  const cursor = parsePageCursor(input.pageToken);
  let cursorCondition;
  if (cursor !== null) {
    cursorCondition = or(
      lt(organizationApiMailMessage.sentAt, cursor.sentAt),
      and(
        eq(organizationApiMailMessage.sentAt, cursor.sentAt),
        lt(organizationApiMailMessage.id, cursor.id)
      )
    );
  }
  const [records, countRows] = await Promise.all([
    db
      .select()
      .from(organizationApiMailMessage)
      .where(and(where, cursorCondition))
      .orderBy(
        desc(organizationApiMailMessage.sentAt),
        desc(organizationApiMailMessage.id)
      )
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
                pageRecords.map((record) => record.id)
              )
            )
          )
          .groupBy(organizationApiMailAttachment.messageId);
  const attachmentCountByMessageId = new Map(
    attachmentCounts.map((record) => [record.messageId, record.count])
  );
  const mailboxRows =
    pageRecords.length === 0
      ? []
      : await db
          .select({
            emailAddress: mailbox.emailAddress,
            id: mailbox.id,
            includeApiSentMessages: mailbox.includeApiSentMessages,
            provider: mailbox.provider,
          })
          .from(mailbox)
          .where(
            and(
              eq(mailbox.organizationId, organizationId),
              inArray(mailbox.emailAddress, [
                ...new Set(pageRecords.map((record) => record.senderAddress)),
              ])
            )
          );
  const mailboxBySenderAddress = new Map(
    mailboxRows.map((row) => [row.emailAddress, row])
  );
  const canManageTeam = canManageOrganization(membership.role);

  const lastPageRecord = pageRecords.at(-1);
  let nextPageToken: string | undefined;
  if (hasNextPage && lastPageRecord !== undefined) {
    nextPageToken = encodePageCursor(lastPageRecord);
  }

  return {
    messages: await Promise.all(
      pageRecords.map(
        async (record) =>
          await toMessageListItem(record, {
            attachmentCount: attachmentCountByMessageId.get(record.id) ?? 0,
            includeApiSource: true,
            mailboxState: toApiMessageMailboxState(
              mailboxBySenderAddress.get(record.senderAddress) ?? null,
              canManageTeam
            ),
            userId: input.userId,
          })
      )
    ),
    nextPageToken,
    resultSizeEstimate: countRows[0]?.count ?? 0,
  };
};

export const getOrganizationApiMailThread = async (input: {
  mailboxId: string;
  threadId: string;
  userId: string;
}): Promise<ThreadMessagesResult> => {
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (organizationId === null) {
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
  if (organizationId === null) {
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

export const getOrganizationApiMailDelivery = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (organizationId === null) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  const record = await findApiMessage({
    messageId: input.messageId,
    organizationId,
    userId: input.userId,
  });
  return await getOrganizationMailDelivery({
    organizationId,
    providerMessageId: record.providerMessageId,
  });
};

export const listOrganizationApiMailDeliveryStatuses = async (input: {
  mailboxId: string;
  messageIds: string[];
  userId: string;
}) => {
  if (input.messageIds.length === 0) {
    return {};
  }
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (organizationId === null) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  await assertUserOrganizationMember({
    organizationId,
    userId: input.userId,
  });

  const rows = await db
    .select({
      messageId: organizationApiMailMessage.id,
      status: organizationMailDeliveryRecipient.status,
    })
    .from(organizationApiMailMessage)
    .innerJoin(
      organizationMailDeliveryRecipient,
      and(
        eq(
          organizationMailDeliveryRecipient.providerMessageId,
          organizationApiMailMessage.providerMessageId
        ),
        eq(organizationMailDeliveryRecipient.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(organizationApiMailMessage.organizationId, organizationId),
        inArray(organizationApiMailMessage.id, input.messageIds)
      )
    );

  return groupDeliveryStatusesByMessage(rows);
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
    .where(
      and(eq(mailbox.id, input.mailboxId), eq(mailbox.provider, "managed"))
    )
    .limit(1);
  if (targetMailbox === undefined) {
    return;
  }
  if (!targetMailbox.includeApiSentMessages) {
    return;
  }

  const records = await db
    .select()
    .from(organizationApiMailMessage)
    .where(
      and(
        eq(
          organizationApiMailMessage.organizationId,
          targetMailbox.organizationId
        ),
        eq(organizationApiMailMessage.senderAddress, targetMailbox.emailAddress)
      )
    )
    .orderBy(asc(organizationApiMailMessage.sentAt))
    .limit(API_MESSAGE_BACKFILL_LIMIT);
  if (records.length === 0) {
    return;
  }

  const attachments = await db
    .select()
    .from(organizationApiMailAttachment)
    .where(
      and(
        eq(
          organizationApiMailAttachment.organizationId,
          targetMailbox.organizationId
        ),
        inArray(
          organizationApiMailAttachment.messageId,
          records.map((record) => record.id)
        )
      )
    );
  const attachmentsByMessageId = new Map<
    string,
    (typeof organizationApiMailAttachment.$inferSelect)[]
  >();
  for (const attachment of attachments) {
    const messageAttachments =
      attachmentsByMessageId.get(attachment.messageId) ?? [];
    messageAttachments.push(attachment);
    attachmentsByMessageId.set(attachment.messageId, messageAttachments);
  }

  for (const record of records) {
    const messageAttachments = attachmentsByMessageId.get(record.id) ?? [];
    await recordOutboundManagedMessageForSender({
      attachments: messageAttachments.map((attachment) => ({
        contentId: attachment.contentId,
        fileName: attachment.fileName,
        inline: attachment.inline,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      bcc: hasText(record.bcc) ? [record.bcc] : [],
      bodyHtml: record.bodyHtml ?? undefined,
      bodyText: record.bodyText ?? undefined,
      cc: hasText(record.cc) ? [record.cc] : [],
      headers: record.headers,
      messageHeaderId: record.messageHeaderId ?? undefined,
      organizationId: record.organizationId,
      providerMessageId: record.providerMessageId,
      rawSizeBytes: record.rawSizeBytes,
      replyTo: hasText(record.replyTo) ? [record.replyTo] : [],
      requireApiSentMessageInclusion: true,
      sender: record.from,
      senderAddress: record.senderAddress,
      sentAt: record.sentAt,
      subject: record.subject ?? "",
      to: hasText(record.to) ? [record.to] : [],
    });
  }
};

export const createManagedMailboxForApiMessage = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
  if (organizationId === null) {
    throw new ORPCError("NOT_FOUND", { message: "API mailbox not found." });
  }
  await assertUserCanManageOrganizationSettings({
    organizationId,
    userId: input.userId,
  });
  const record = await findApiMessage({
    messageId: input.messageId,
    organizationId,
    userId: input.userId,
  });

  const existingMailbox = await findMailboxByAddress(
    organizationId,
    record.senderAddress
  );
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
  if (existingMailbox !== null) {
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
  }).catch(async (error: unknown) => {
    if (!isMailboxEmailUniqueError(error)) {
      throw error;
    }

    const racedMailbox = await findMailboxByAddress(
      organizationId,
      record.senderAddress
    );
    if (racedMailbox?.provider !== "managed") {
      throw new ORPCError("CONFLICT", {
        message: "A mailbox with this address already exists.",
      });
    }

    await db
      .update(mailbox)
      .set({ includeApiSentMessages: true, updatedAt: new Date() })
      .where(eq(mailbox.id, racedMailbox.id));
    return { mailboxId: racedMailbox.id };
  });
  await backfillApiMessagesForManagedMailbox({
    mailboxId: created.mailboxId,
    userId: input.userId,
  });
  return created;
};
