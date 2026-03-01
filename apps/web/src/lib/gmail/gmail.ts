import type { z } from "zod";
import { getAccessToken } from "~/lib/auth";
import { decodeMimeHeaderValue, extractMessageContent } from "./message-content";
import { getMessageSchema, getThreadSchema, listMessagesSchema } from "./schema";
import { getSenderAvatarUrl } from "./sender-avatar";

type MessagePart = z.infer<typeof getMessageSchema>["payload"];
type GmailMessage = z.infer<typeof getMessageSchema>;

const MESSAGE_DETAILS_CONCURRENCY = 8;
const RATE_LIMIT_MAX_RETRIES = 2;
const RATE_LIMIT_BASE_DELAY_MS = 350;
export const GMAIL_QUERY_STALE_TIME_MS = 1000 * 60 * 2;
export const GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS = 1000 * 30;
export const GMAIL_QUERY_BACKGROUND_SYNC_INTERVAL_MS = 1000 * 60 * 5;

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
  if (accessToken) return accessToken;

  const resolvedAccessToken = await getAccessToken("google");
  if (!resolvedAccessToken) throw new Error("Failed to get access token");

  return resolvedAccessToken;
};

const createApiError = (message: string, status: number): Error & { status: number } => {
  const error = new Error(`${message} (${status})`) as Error & { status: number };
  error.status = status;
  return error;
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
  accessToken?: string | null;
  signal?: AbortSignal;
}) => {
  const accessToken = await resolveGoogleAccessToken(opts?.accessToken);

  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", String(opts?.maxResults ?? 20));
  if (opts?.pageToken) url.searchParams.set("pageToken", opts.pageToken);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: opts?.signal,
  });
  if (!response.ok) throw createApiError("Failed to list messages", response.status);
  return listMessagesSchema.parse(await response.json());
};

const extractEmailFromFrom = (from?: string): string | undefined => {
  if (!from) return undefined;
  const match = from.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? (from.includes("@") ? from.trim() : undefined);
};

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
  };
};

const withSenderAvatars = async (messages: MessageListItem[]): Promise<MessageListItem[]> => {
  const senderEmails = Array.from(
    new Set(
      messages
        .map((message) => extractEmailFromFrom(message.from))
        .filter((email): email is string => Boolean(email)),
    ),
  );

  const avatarByEmail = new Map<string, string | undefined>();
  await Promise.all(
    senderEmails.map(async (email) => {
      const avatarUrl = await getSenderAvatarUrl(email, { size: 64 });
      avatarByEmail.set(email, avatarUrl);
    }),
  );

  return messages.map((message) => {
    const email = extractEmailFromFrom(message.from);

    return {
      ...message,
      senderAvatarUrl: email ? avatarByEmail.get(email) : undefined,
    };
  });
};

export const listMessagesWithDetails = async (opts?: {
  pageToken?: string;
  maxResults?: number;
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
    accessToken,
    signal: opts?.signal,
  });

  const missingMessageRefs = list.messages.filter(
    (message) => !opts?.cachedMessagesById?.has(message.id),
  );

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

  const messagesStillMissing = missingMessageRefs.filter(
    (message) => !persistedMessagesById.has(message.id),
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
      return (
        opts?.cachedMessagesById?.get(message.id) ??
        persistedMessagesById.get(message.id) ??
        fetchedMessagesById.get(message.id)
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
      try {
        await opts.persistFetchedMessages(fetchedMessagesWithAvatars, opts.signal);
      } catch (error) {
        if (opts.signal?.aborted) {
          throw error;
        }
      }
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

  const endpoint = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`);
  endpoint.searchParams.set("format", "full");

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: opts?.signal,
  });
  if (!response.ok) throw createApiError("Failed to get thread", response.status);

  const thread = getThreadSchema.parse(await response.json());
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

  const endpoint = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
  endpoint.searchParams.set("format", "metadata");
  endpoint.searchParams.append("metadataHeaders", "Subject");
  endpoint.searchParams.append("metadataHeaders", "From");
  endpoint.searchParams.append("metadataHeaders", "Date");

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: opts?.signal,
  });
  if (!response.ok) throw createApiError("Failed to get message", response.status);
  return getMessageSchema.parse(await response.json());
};
