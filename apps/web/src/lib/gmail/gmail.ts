import { resolveProviderAccessToken } from "../google-api/client";
import {
  gmailApi,
  type GmailListMessagesResponse,
  type GmailMessage,
  type GmailMessagePart,
} from "./gmail-api";
import { decodeMimeHeaderValue, extractMessageContent } from "./message-content";
import { getSenderAvatarUrl } from "./sender-avatar";

type MessagePart = GmailMessagePart;

const MESSAGE_DETAILS_CONCURRENCY = 8;
const RATE_LIMIT_MAX_RETRIES = 2;
const RATE_LIMIT_BASE_DELAY_MS = 350;
export const GMAIL_QUERY_STALE_TIME_MS = 1000 * 60 * 2;
export const GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS = 1000 * 10;
export const GMAIL_QUERY_BACKGROUND_SYNC_INTERVAL_MS = 1000 * 60;

export const MAILBOX_LABELS = {
  inbox: "INBOX",
  sent: "SENT",
  trash: "TRASH",
} as const;

export const GMAIL_UNREAD_LABEL = "UNREAD";

export type MailboxCategory = keyof typeof MAILBOX_LABELS;

const findHeaders = (
  obj: MessagePart | undefined,
): { name: string; value: string }[] | undefined => {
  if (!obj) return undefined;
  if (obj.headers?.length) return obj.headers;
  for (const p of obj.parts ?? []) {
    const h = findHeaders(p as MessagePart);
    if (h?.length) return h;
  }
  return undefined;
};

export type MessageListItem = {
  id: string;
  threadId: string;
  snippet?: string;
  subject?: string;
  from?: string;
  date?: string;
  internalDate?: string;
  bodyHtml?: string;
  bodyText?: string;
  senderAvatarUrl?: string;
  labelIds?: string[];
  isUnread?: boolean;
};

const normalizeLabelIds = (labelIds: string[] | undefined): string[] | undefined => {
  if (!labelIds?.length) return undefined;

  const normalized = Array.from(new Set(labelIds.map((labelId) => labelId.trim()).filter(Boolean)));

  return normalized.length > 0 ? normalized : undefined;
};

const hasUnreadLabel = (labelIds: string[] | undefined): boolean => {
  return Boolean(labelIds?.includes(GMAIL_UNREAD_LABEL));
};

export const removeUnreadLabel = (labelIds: string[] | undefined): string[] | undefined => {
  return normalizeLabelIds(labelIds?.filter((labelId) => labelId !== GMAIL_UNREAD_LABEL));
};

export const addUnreadLabel = (labelIds: string[] | undefined): string[] | undefined => {
  const mergedLabelIds = [...(labelIds ?? []), GMAIL_UNREAD_LABEL];
  return normalizeLabelIds(mergedLabelIds);
};

export const isMessageUnread = (
  message: Pick<MessageListItem, "isUnread" | "labelIds">,
): boolean => {
  return message.isUnread ?? hasUnreadLabel(message.labelIds);
};

export type ThreadMessagesResult = {
  threadId: string;
  snippet?: string;
  subject?: string;
  messages: MessageListItem[];
};

export type ListMessagesPageResult = {
  messages: MessageListItem[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type LoadCachedMessagesFn = (
  messageIds: string[],
  signal?: AbortSignal,
) => Promise<MessageListItem[]>;

type PersistFetchedMessagesFn = (
  messages: MessageListItem[],
  signal?: AbortSignal,
) => Promise<void>;

const resolveGoogleAccessToken = async (accessToken?: string | null): Promise<string> => {
  return await resolveProviderAccessToken("google", accessToken);
};

const sleep = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const isRateLimitError = (error: unknown): error is Error & { status: number } => {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  return status === 429;
};

const getMessageWithRetry = async (
  messageId: string,
  opts: { accessToken: string; signal?: AbortSignal },
) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getMessage(messageId, {
        accessToken: opts.accessToken,
        signal: opts.signal,
      });
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= RATE_LIMIT_MAX_RETRIES || opts.signal?.aborted) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 120);
      const delayMs = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt + jitter;
      await sleep(delayMs);
    }
  }
};

const getMessageDetailsWithConcurrency = async (
  messages: { id: string }[],
  opts: { accessToken: string; signal?: AbortSignal },
) => {
  const details: GmailMessage[] = [];

  for (let offset = 0; offset < messages.length; offset += MESSAGE_DETAILS_CONCURRENCY) {
    if (opts.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    const batch = messages.slice(offset, offset + MESSAGE_DETAILS_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(
        async (message) =>
          await getMessageWithRetry(message.id, {
            accessToken: opts.accessToken,
            signal: opts.signal,
          }),
      ),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        details.push(result.value);
      }
    }
  }

  return details;
};

export const listMessages = async (opts?: {
  pageToken?: string;
  maxResults?: number;
  mailbox?: MailboxCategory;
  accessToken?: string | null;
  signal?: AbortSignal;
}): Promise<GmailListMessagesResponse> => {
  const accessToken = await resolveGoogleAccessToken(opts?.accessToken);

  return await gmailApi.listMessages(
    {
      maxResults: opts?.maxResults ?? 20,
      pageToken: opts?.pageToken,
      labelIds: opts?.mailbox ? [MAILBOX_LABELS[opts.mailbox]] : undefined,
      includeSpamTrash: opts?.mailbox === "trash" ? true : undefined,
    },
    {
      accessToken,
      signal: opts?.signal,
    },
  );
};

const extractEmailFromFrom = (from?: string): string | undefined => {
  if (!from) return undefined;
  const match = from.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? (from.includes("@") ? from.trim() : undefined);
};

const senderAvatarCache = new Map<string, string | undefined>();

const getMessageTimestamp = (message: MessageListItem): number => {
  const source = message.internalDate ?? message.date;
  if (!source) return 0;

  const numeric = Number(source);
  const parsedDate = Number.isFinite(numeric) ? new Date(numeric) : new Date(source);
  const timestamp = parsedDate.getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const toMessageListItem = (message: GmailMessage, includeBody = false): MessageListItem => {
  const headers = findHeaders(message.payload) ?? message.payload?.headers;
  const labelIds = normalizeLabelIds(message.labelIds);
  const content = includeBody
    ? extractMessageContent(message.payload)
    : { html: undefined, text: undefined };
  const getHeader = (name: string) =>
    decodeMimeHeaderValue(
      headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value,
    );

  return {
    id: message.id,
    threadId: message.threadId,
    snippet: decodeMimeHeaderValue(message.snippet),
    subject: getHeader("Subject"),
    from: getHeader("From"),
    date: getHeader("Date"),
    internalDate: message.internalDate,
    bodyHtml: content.html,
    bodyText: content.text,
    labelIds,
    isUnread: hasUnreadLabel(labelIds),
  };
};

const withSenderAvatars = async (messages: MessageListItem[]): Promise<MessageListItem[]> => {
  const senderEmails = Array.from(
    new Set(
      messages
        .filter((message) => !message.senderAvatarUrl)
        .map((message) => extractEmailFromFrom(message.from))
        .filter((email): email is string => Boolean(email)),
    ),
  );

  await Promise.all(
    senderEmails.map(async (email) => {
      if (senderAvatarCache.has(email)) return;
      const avatarUrl = await getSenderAvatarUrl(email, { size: 64 });
      senderAvatarCache.set(email, avatarUrl);
    }),
  );

  return messages.map((message) => {
    if (message.senderAvatarUrl) {
      const email = extractEmailFromFrom(message.from);
      if (email) senderAvatarCache.set(email, message.senderAvatarUrl);
      return message;
    }

    const email = extractEmailFromFrom(message.from);
    if (!email) return message;

    const avatarUrl = senderAvatarCache.get(email);

    return {
      ...message,
      senderAvatarUrl: avatarUrl,
    };
  });
};

export const listMessagesWithDetails = async (opts?: {
  pageToken?: string;
  maxResults?: number;
  mailbox?: MailboxCategory;
  accessToken?: string | null;
  cachedMessagesById?: ReadonlyMap<string, MessageListItem>;
  loadCachedMessages?: LoadCachedMessagesFn;
  persistFetchedMessages?: PersistFetchedMessagesFn;
  signal?: AbortSignal;
}): Promise<ListMessagesPageResult> => {
  const accessToken = await resolveGoogleAccessToken(opts?.accessToken);

  const list = await listMessages({
    pageToken: opts?.pageToken,
    maxResults: opts?.maxResults,
    mailbox: opts?.mailbox,
    accessToken,
    signal: opts?.signal,
  });

  const missingMessageRefs = list.messages.filter((message) => {
    const cachedMessage = opts?.cachedMessagesById?.get(message.id);
    if (!cachedMessage) return true;

    return cachedMessage.isUnread == null;
  });

  const persistedMessagesById = new Map<string, MessageListItem>();

  if (missingMessageRefs.length > 0 && opts?.loadCachedMessages) {
    const persistedMessages = await opts.loadCachedMessages(
      missingMessageRefs.map((message) => message.id),
      opts.signal,
    );

    for (const message of persistedMessages) {
      persistedMessagesById.set(message.id, message);
    }
  }

  const messagesStillMissing = missingMessageRefs.filter((message) => {
    const persistedMessage = persistedMessagesById.get(message.id);
    if (!persistedMessage) return true;

    return persistedMessage.isUnread == null;
  });

  const fallbackMessagesById = new Map<string, MessageListItem>(
    messagesStillMissing.map((message) => [
      message.id,
      {
        id: message.id,
        threadId: message.threadId,
      },
    ]),
  );

  const details =
    messagesStillMissing.length > 0
      ? await getMessageDetailsWithConcurrency(messagesStillMissing, {
          accessToken,
          signal: opts?.signal,
        })
      : [];

  if (opts?.signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }

  const fetchedMessagesById = new Map(
    details.map((message) => {
      const item = toMessageListItem(message, false);
      return [item.id, item] as const;
    }),
  );

  const messages = list.messages
    .map((message) => {
      const cachedMessage = opts?.cachedMessagesById?.get(message.id);
      if (cachedMessage?.isUnread != null) {
        return cachedMessage;
      }

      return (
        fetchedMessagesById.get(message.id) ??
        cachedMessage ??
        persistedMessagesById.get(message.id) ??
        fallbackMessagesById.get(message.id)
      );
    })
    .filter((message): message is MessageListItem => Boolean(message));

  if (!messages.length && list.messages.length > 0) {
    throw new Error("Failed to get message");
  }

  const messagesWithAvatars = await withSenderAvatars(messages);

  if (opts?.persistFetchedMessages && fetchedMessagesById.size > 0) {
    const fetchedMessageIds = new Set(fetchedMessagesById.keys());
    const fetchedMessagesWithAvatars = messagesWithAvatars.filter((message) =>
      fetchedMessageIds.has(message.id),
    );

    if (fetchedMessagesWithAvatars.length > 0) {
      void opts.persistFetchedMessages(fetchedMessagesWithAvatars).catch(() => undefined);
    }
  }

  return {
    messages: messagesWithAvatars,
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
  };
};

export const getThreadWithDetails = async (
  threadId: string,
  opts?: { accessToken?: string | null; signal?: AbortSignal },
): Promise<ThreadMessagesResult> => {
  const accessToken = await resolveGoogleAccessToken(opts?.accessToken);

  const thread = await gmailApi.getThread(
    threadId,
    {
      format: "full",
    },
    {
      accessToken,
      signal: opts?.signal,
    },
  );
  const sortedMessages = (thread.messages ?? [])
    .map((message) => toMessageListItem(message, true))
    .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
  const messagesWithAvatars = await withSenderAvatars(sortedMessages);

  const subject = messagesWithAvatars.reduce<string | undefined>((resolved, message) => {
    if (!message.subject?.trim()) return resolved;
    return message.subject;
  }, undefined);

  return {
    threadId: thread.id,
    snippet: decodeMimeHeaderValue(thread.snippet),
    subject,
    messages: messagesWithAvatars,
  };
};

export const getMessage = async (
  messageId: string,
  opts?: { accessToken?: string | null; signal?: AbortSignal },
) => {
  const accessToken = await resolveGoogleAccessToken(opts?.accessToken);

  return await gmailApi.getMessage(
    messageId,
    {
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    },
    {
      accessToken,
      signal: opts?.signal,
    },
  );
};

export const markMessageAsRead = async (
  messageId: string,
  opts?: { accessToken?: string | null; signal?: AbortSignal },
) => {
  const accessToken = await resolveGoogleAccessToken(opts?.accessToken);

  const updatedMessage = await gmailApi.modifyMessage(
    messageId,
    {
      removeLabelIds: [GMAIL_UNREAD_LABEL],
    },
    {
      accessToken,
      signal: opts?.signal,
    },
  );

  const labelIds = normalizeLabelIds(updatedMessage.labelIds);

  return {
    id: updatedMessage.id,
    labelIds,
    isUnread: hasUnreadLabel(labelIds),
  };
};

export const markMessageAsUnread = async (
  messageId: string,
  opts?: { accessToken?: string | null; signal?: AbortSignal },
) => {
  const accessToken = await resolveGoogleAccessToken(opts?.accessToken);

  const updatedMessage = await gmailApi.modifyMessage(
    messageId,
    {
      addLabelIds: [GMAIL_UNREAD_LABEL],
    },
    {
      accessToken,
      signal: opts?.signal,
    },
  );

  const labelIds = normalizeLabelIds(updatedMessage.labelIds);

  return {
    id: updatedMessage.id,
    labelIds,
    isUnread: hasUnreadLabel(labelIds),
  };
};
