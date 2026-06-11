import type { GmailSearchResult } from "@quieter/ai";
import { isGmailServiceError, listMessagesWithDetails, type MailboxCategory } from "@quieter/gmail";
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

export const searchGmailForUser = async (input: {
  category: MailboxCategory;
  mailboxId: string;
  maxResults: number;
  query: string;
  signal?: AbortSignal;
  userId: string;
}): Promise<GmailSearchResult> => {
  const runSearch = async (accessToken: string): Promise<GmailSearchResult> => {
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
    };
  };

  const { accessToken, mailbox } = await getAuthorizedGmailMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });

  try {
    return await runSearch(accessToken);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      throw error;
    }

    const refreshedAccessToken = await refreshAuthorizedGmailAccessToken({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });

    try {
      return await runSearch(refreshedAccessToken);
    } catch (retryError) {
      if (isGmailAuthError(retryError)) {
        await markGmailMailboxNeedsReconnect(mailbox.id);
      }

      throw retryError;
    }
  }
};
