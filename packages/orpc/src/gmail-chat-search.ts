import type {
  GmailLabelListResult,
  GmailMessageResult,
  GmailSearchResult,
  GmailThreadResult,
  MailboxOverviewResult,
  ModifyMailResult,
} from "@quieter/ai/chat-agent";
import {
  getGmailMessageCount,
  getGmailProfile,
  getMessageWithDetails,
  getThreadWithDetails,
  isGmailServiceError,
  listLabels,
  listMessagesWithDetails,
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
    query: string;
  },
): Promise<GmailSearchResult> =>
  runAuthorizedGmailChatRequest(input, async (accessToken) => {
    const result = await listMessagesWithDetails(accessToken, {
      mailbox: input.category,
      maxResults: input.maxResults,
      query: input.query,
      signal: input.signal,
    });

    return {
      category: input.category,
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
      query: input.query,
      resultSizeEstimate: result.resultSizeEstimate,
      status: "success",
    };
  });

const THREAD_MESSAGE_LIMIT = 12;
const THREAD_MESSAGE_BODY_LIMIT = 2_000;
const MESSAGE_BODY_LIMIT = 8_000;
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
      body: body.slice(0, MESSAGE_BODY_LIMIT),
      bodyTruncated: body.length > MESSAGE_BODY_LIMIT,
      category: input.category,
      date: message.date ?? message.internalDate,
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
      starredMessages,
      status: "success",
      totalMessages: profile.messagesTotal,
      totalThreads: profile.threadsTotal,
      unreadMessages,
    };
  });
