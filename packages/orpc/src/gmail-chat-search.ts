import type {
  GmailAttachmentResult,
  GmailLabelListResult,
  GmailMessageResult,
  GmailMessagesResult,
  GmailSearchResult,
  GmailThreadResult,
  MailboxOverviewResult,
  ModifyMailResult,
} from "@quieter/ai/chat-agent";
import {
  getGmailMessageCount,
  getGmailProfile,
  getMessageAttachment,
  getMessageWithDetails,
  getThreadWithDetails,
  isGmailServiceError,
  listLabels,
  listMessagesForAgent,
  markMessageAsRead,
  markMessageAsUnread,
  markThreadAsRead,
  markThreadAsUnread,
  moveMessageToTrash,
  moveThreadToTrash,
  type MailboxCategory,
  untrashMessage,
  untrashThread,
  updateMessageLabels,
  updateThreadLabels,
} from "@quieter/gmail";
import { syncGmailLabels } from "./gmail-labels";
import {
  getAuthorizedGmailMailbox,
  markGmailMailboxNeedsReconnect,
  refreshAuthorizedGmailAccessToken,
} from "./gmail-mailbox-access";

const isGmailAuthError = (error: unknown) =>
  isGmailServiceError(error) &&
  error.status === 401 &&
  (error.googleReason?.toLowerCase() === "autherror" ||
    error.googleStatus?.toUpperCase() === "UNAUTHENTICATED");

type GmailChatRequest = {
  mailboxId: string;
  signal?: AbortSignal;
  userId: string;
};

const runAuthorizedGmailChatRequest = async <T>(
  input: GmailChatRequest,
  request: (accessToken: string) => Promise<T>,
) => {
  const { accessToken, mailbox } = await getAuthorizedGmailMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });

  try {
    return await request(accessToken);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      throw error;
    }

    const refreshedAccessToken = await refreshAuthorizedGmailAccessToken({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });

    try {
      return await request(refreshedAccessToken);
    } catch (retryError) {
      if (isGmailAuthError(retryError)) {
        await markGmailMailboxNeedsReconnect(mailbox.id);
      }

      throw retryError;
    }
  }
};

export const searchGmailForUser = async (
  input: GmailChatRequest & {
    category: MailboxCategory;
    maxResults: number;
    pageToken?: string;
    query: string;
  },
): Promise<GmailSearchResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const result = await listMessagesForAgent(accessToken, {
      mailbox: input.category,
      maxResults: input.maxResults,
      pageToken: input.pageToken,
      query: input.query,
      signal: input.signal,
    });

    return {
      category: input.category,
      fetchedAt: new Date().toISOString(),
      messages: result.messages.map((message) => ({
        date: message.date ?? message.internalDate,
        from: message.from,
        id: message.id,
        isUnread: message.isUnread,
        labelIds: message.labelIds,
        snippet: message.snippet,
        subject: message.subject,
        threadId: message.threadId,
      })),
      nextPageToken: result.nextPageToken,
      query: input.query,
      resultSizeEstimate: result.resultSizeEstimate,
      status: "success",
    };
  });

const THREAD_MESSAGE_LIMIT = 12;
const THREAD_MESSAGE_BODY_LIMIT = 2_000;
const MESSAGE_BODY_LIMIT = 8_000;
const ATTACHMENT_CONTENT_LIMIT = 50_000;
const ATTACHMENT_SIZE_LIMIT = 1_000_000;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "ics",
  "json",
  "log",
  "md",
  "srt",
  "text",
  "txt",
  "vtt",
  "xml",
  "yaml",
  "yml",
]);
const GMAIL_STARRED_LABEL = "STARRED";
const GMAIL_INBOX_LABEL = "INBOX";
const GMAIL_NON_SPAM_TRASH_UNREAD_QUERY = "is:unread -in:spam -in:trash";

const getUnreadOverviewQuery = (category: MailboxCategory) =>
  category === "spam" || category === "trash" ? "is:unread" : GMAIL_NON_SPAM_TRASH_UNREAD_QUERY;

export const readGmailThreadForUser = async (
  input: GmailChatRequest & { category: MailboxCategory; threadId: string },
): Promise<GmailThreadResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const thread = await getThreadWithDetails(accessToken, input.threadId, input.signal);
    const includedMessages = thread.messages.slice(-THREAD_MESSAGE_LIMIT);

    return {
      category: input.category,
      fetchedAt: new Date().toISOString(),
      messages: includedMessages.map((message) => {
        const body = message.bodyText?.trim() || message.snippet?.trim() || "";

        return {
          attachmentCount: message.attachments?.length ?? 0,
          body: body.slice(0, THREAD_MESSAGE_BODY_LIMIT),
          bodyTruncated: body.length > THREAD_MESSAGE_BODY_LIMIT,
          date: message.date ?? message.internalDate,
          from: message.from,
          id: message.id,
          isUnread: message.isUnread,
          snippet: message.snippet,
          to: message.to,
        };
      }),
      omittedMessageCount: Math.max(0, thread.messages.length - includedMessages.length),
      snippet: thread.snippet,
      status: "success",
      subject: thread.subject,
      threadId: thread.threadId,
    };
  });

export const readGmailMessageForUser = async (
  input: GmailChatRequest & { category: MailboxCategory; messageId: string },
): Promise<GmailMessageResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const message = await getMessageWithDetails(accessToken, input.messageId, input.signal);
    const body = message.bodyText?.trim() || message.snippet?.trim() || "";

    return {
      attachmentCount: message.attachments?.length ?? 0,
      attachments: message.attachments ?? [],
      body: body.slice(0, MESSAGE_BODY_LIMIT),
      bodyTruncated: body.length > MESSAGE_BODY_LIMIT,
      category: input.category,
      date: message.date ?? message.internalDate,
      fetchedAt: new Date().toISOString(),
      from: message.from,
      id: message.id,
      isUnread: message.isUnread,
      labelIds: message.labelIds,
      snippet: message.snippet,
      status: "success",
      subject: message.subject,
      threadId: message.threadId,
      to: message.to,
    };
  });

export const readGmailMessagesForUser = async (
  input: GmailChatRequest & { category: MailboxCategory; messageIds: string[] },
): Promise<GmailMessagesResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const fetchedAt = new Date().toISOString();
    const results = await Promise.allSettled(
      input.messageIds.map(async (messageId) => {
        const message = await getMessageWithDetails(accessToken, messageId, input.signal);
        const body = message.bodyText?.trim() || message.snippet?.trim() || "";

        return {
          attachmentCount: message.attachments?.length ?? 0,
          attachments: message.attachments ?? [],
          body: body.slice(0, MESSAGE_BODY_LIMIT),
          bodyTruncated: body.length > MESSAGE_BODY_LIMIT,
          category: input.category,
          date: message.date ?? message.internalDate,
          fetchedAt,
          from: message.from,
          id: message.id,
          isUnread: message.isUnread,
          labelIds: message.labelIds,
          snippet: message.snippet,
          status: "success" as const,
          subject: message.subject,
          threadId: message.threadId,
          to: message.to,
        };
      }),
    );

    return {
      failed: results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              {
                error:
                  result.reason instanceof Error
                    ? result.reason.message
                    : "Could not read this message.",
                messageId: input.messageIds[index]!,
              },
            ]
          : [],
      ),
      fetchedAt,
      messages: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      status: "success",
    };
  });

export const readGmailAttachmentForUser = async (
  input: GmailChatRequest & {
    attachmentId: string;
    category: MailboxCategory;
    messageId: string;
  },
): Promise<GmailAttachmentResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const message = await getMessageWithDetails(accessToken, input.messageId, input.signal);
    const metadata = message.attachments?.find(
      (attachment) => attachment.attachmentId === input.attachmentId,
    );

    if (!metadata) {
      throw new Error("The attachment was not found on this message.");
    }

    if (metadata.size > ATTACHMENT_SIZE_LIMIT) {
      throw new Error("This attachment is too large to read in chat.");
    }

    const extension = metadata.fileName.split(".").at(-1)?.toLowerCase() ?? "";
    if (
      !metadata.mimeType.startsWith("text/") &&
      !["application/json", "application/xml", "application/yaml"].includes(metadata.mimeType) &&
      !TEXT_ATTACHMENT_EXTENSIONS.has(extension)
    ) {
      throw new Error("This attachment type cannot be read as text in chat.");
    }

    const attachment = await getMessageAttachment(
      accessToken,
      input.messageId,
      input.attachmentId,
      input.signal,
    );
    if (!attachment.data) {
      throw new Error("The attachment did not contain readable data.");
    }

    const base64 = attachment.data.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const content = new TextDecoder().decode(bytes).replaceAll("\0", "");

    return {
      attachmentId: input.attachmentId,
      content: content.slice(0, ATTACHMENT_CONTENT_LIMIT),
      contentTruncated: content.length > ATTACHMENT_CONTENT_LIMIT,
      fetchedAt: new Date().toISOString(),
      fileName: metadata.fileName,
      messageId: input.messageId,
      mimeType: metadata.mimeType,
      size: metadata.size,
      status: "success",
    };
  });

export const listGmailLabelsForUser = async (
  input: GmailChatRequest & { category: MailboxCategory },
): Promise<GmailLabelListResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const labels = await syncGmailLabels(
      input.mailboxId,
      await listLabels(accessToken, input.signal),
    );

    return {
      category: input.category,
      fetchedAt: new Date().toISOString(),
      labels: labels.map((label) => ({
        id: label.id,
        name: label.name,
        description: label.description,
        inclusionCriteria: label.inclusionCriteria,
        type: label.type === "user" ? "user" : "system",
      })),
      status: "success",
    };
  });

export const modifyMailForUser = async (
  input: GmailChatRequest & {
    action: ModifyMailResult["action"];
    category: MailboxCategory;
    id: string;
    target: ModifyMailResult["target"];
  },
): Promise<ModifyMailResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const { action, id, target } = input;

    if (target === "thread") {
      switch (action) {
        case "mark_read":
          await markThreadAsRead(accessToken, id, input.signal);
          break;
        case "mark_unread":
          await markThreadAsUnread(accessToken, id, input.signal);
          break;
        case "star":
          await updateThreadLabels(
            accessToken,
            id,
            { addLabelIds: [GMAIL_STARRED_LABEL] },
            input.signal,
          );
          break;
        case "unstar":
          await updateThreadLabels(
            accessToken,
            id,
            { removeLabelIds: [GMAIL_STARRED_LABEL] },
            input.signal,
          );
          break;
        case "archive":
          await updateThreadLabels(
            accessToken,
            id,
            { removeLabelIds: [GMAIL_INBOX_LABEL] },
            input.signal,
          );
          break;
        case "trash":
          await moveThreadToTrash(accessToken, id, input.signal);
          break;
        case "untrash":
          await untrashThread(accessToken, id, input.signal);
          break;
      }
    } else {
      switch (action) {
        case "mark_read":
          await markMessageAsRead(accessToken, id, input.signal);
          break;
        case "mark_unread":
          await markMessageAsUnread(accessToken, id, input.signal);
          break;
        case "star":
          await updateMessageLabels(
            accessToken,
            id,
            { addLabelIds: [GMAIL_STARRED_LABEL] },
            input.signal,
          );
          break;
        case "unstar":
          await updateMessageLabels(
            accessToken,
            id,
            { removeLabelIds: [GMAIL_STARRED_LABEL] },
            input.signal,
          );
          break;
        case "archive":
          await updateMessageLabels(
            accessToken,
            id,
            { removeLabelIds: [GMAIL_INBOX_LABEL] },
            input.signal,
          );
          break;
        case "trash":
          await moveMessageToTrash(accessToken, id, input.signal);
          break;
        case "untrash":
          await untrashMessage(accessToken, id, input.signal);
          break;
      }
    }

    return {
      action,
      category: input.category,
      id,
      status: "success",
      target,
    };
  });

export const getMailboxOverviewForUser = async (
  input: GmailChatRequest & { category: MailboxCategory },
): Promise<MailboxOverviewResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const [profile, categoryMessages, unreadMessages, starredMessages, attachmentMessages] =
      await Promise.all([
        getGmailProfile(accessToken, input.signal),
        getGmailMessageCount(accessToken, {
          mailbox: input.category,
          signal: input.signal,
        }),
        getGmailMessageCount(accessToken, {
          mailbox: input.category,
          accurateUpTo: 200,
          countBy: "threads",
          query: getUnreadOverviewQuery(input.category),
          signal: input.signal,
        }),
        getGmailMessageCount(accessToken, {
          mailbox: input.category,
          query: "is:starred",
          signal: input.signal,
        }),
        getGmailMessageCount(accessToken, {
          mailbox: input.category,
          query: "has:attachment",
          signal: input.signal,
        }),
      ]);

    return {
      attachmentMessages,
      category: input.category,
      categoryMessages,
      emailAddress: profile.emailAddress,
      fetchedAt: new Date().toISOString(),
      starredMessages,
      status: "success",
      totalMessages: profile.messagesTotal,
      totalThreads: profile.threadsTotal,
      unreadMessages,
    };
  });
