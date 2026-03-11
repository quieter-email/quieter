import { z } from "zod";
import { decodeMimeHeaderValue, extractMessageContent } from "./gmail-message-content";
import { getSenderAvatarUrls } from "./sender-avatar";

export const MAILBOX_LABELS = {
  inbox: "INBOX",
  sent: "SENT",
  trash: "TRASH",
} as const;

export type MailboxCategory = keyof typeof MAILBOX_LABELS;

export const GMAIL_UNREAD_LABEL = "UNREAD";

const headerSchema = z.object({
  name: z.string(),
  value: z.string(),
});

type RecursiveMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: RecursiveMessagePart[];
};

const messagePartSchema: z.ZodType<RecursiveMessagePart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z
      .object({
        attachmentId: z.string().optional(),
        size: z.number().optional(),
        data: z.string().optional(),
      })
      .optional(),
    parts: z.array(messagePartSchema).optional(),
  }),
);

const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  historyId: z.string().optional(),
  internalDate: z.string().optional(),
  payload: messagePartSchema.optional(),
  raw: z.string().optional(),
});

const gmailThreadSchema = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  snippet: z.string().optional(),
  messages: z.array(gmailMessageSchema).optional(),
});

const gmailDraftSchema = z.object({
  id: z.string(),
  message: gmailMessageSchema.optional(),
});

const gmailAttachmentSchema = z.object({
  attachmentId: z.string().optional(),
  size: z.number().optional(),
  data: z.string().optional(),
});

const gmailLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  labelListVisibility: z.string().optional(),
  messageListVisibility: z.string().optional(),
});

const gmailProfileSchema = z.object({
  emailAddress: z.string(),
  historyId: z.string().optional(),
  messagesTotal: z.number().optional(),
  threadsTotal: z.number().optional(),
});

const listMessagesSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

const listLabelsSchema = z.object({
  labels: z.array(gmailLabelSchema).optional(),
});

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
  senderAvatarUrls?: { light: string; dark: string };
  labelIds?: string[];
  isUnread?: boolean;
};

export type ListMessagesPageResult = {
  messages: MessageListItem[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type ThreadMessagesResult = {
  threadId: string;
  snippet?: string;
  subject?: string;
  messages: MessageListItem[];
};

export type GmailLabelListItem = z.infer<typeof gmailLabelSchema>;
export type GmailProfile = z.infer<typeof gmailProfileSchema>;
export type GmailMessage = z.infer<typeof gmailMessageSchema>;
export type GmailDraft = z.infer<typeof gmailDraftSchema>;
export type GmailAttachment = z.infer<typeof gmailAttachmentSchema>;
export { decodeMimeHeaderValue, extractMessageContent };

const GMAIL_MESSAGE_DETAILS_CONCURRENCY = 6;
const GMAIL_METADATA_RETRY_LIMIT = 2;
const GMAIL_METADATA_RETRY_BASE_DELAY_MS = 250;

const normalizeLabelIds = (labelIds: string[] | undefined): string[] | undefined => {
  if (!labelIds?.length) return undefined;

  const normalized = Array.from(new Set(labelIds.map((labelId) => labelId.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
};

const hasUnreadLabel = (labelIds: string[] | undefined): boolean =>
  Boolean(labelIds?.includes(GMAIL_UNREAD_LABEL));

const createGoogleApiError = async (response: Response) => {
  const body = await response.text().catch(() => "");
  const error = new Error(
    body || `Google API request failed with status ${response.status}.`,
  ) as Error & {
    status: number;
    retryAfterMs?: number;
  };
  error.status = response.status;
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      error.retryAfterMs = retryAfterSeconds * 1000;
    }
  }
  return error;
};

const isErrorWithStatus = (
  error: unknown,
): error is Error & { status: number; retryAfterMs?: number } =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof (error as { status?: unknown }).status === "number";

const sleep = async (durationMs: number) => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const getRetryDelayMs = (attempt: number, retryAfterMs?: number) => {
  if (retryAfterMs != null) {
    return retryAfterMs;
  }

  const backoffMs = GMAIL_METADATA_RETRY_BASE_DELAY_MS * 2 ** attempt;
  return backoffMs + Math.floor(Math.random() * 100);
};

const mapWithConcurrency = async <TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
) => {
  const results = Array.from({ length: items.length }) as TResult[];
  let nextIndex = 0;

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex] as TItem, currentIndex);
      }
    }),
  );

  return results;
};

const requestGmail = async <T>(
  accessToken: string,
  path: string,
  schema: z.ZodType<T>,
  options?: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    query?: Record<string, string | number | boolean | undefined | string[] | undefined>;
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<T> => {
  const url = new URL(`https://gmail.googleapis.com${path}`);

  for (const [key, rawValue] of Object.entries(options?.query ?? {})) {
    if (rawValue == null) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value == null) continue;
      url.searchParams.append(key, String(value));
    }
  }

  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
  });

  let body: string | undefined;
  if (options?.body != null) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    headers,
    body,
    signal: options?.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw await createGoogleApiError(response);
  }

  const text = await response.text();
  const parsed = text.trim() ? JSON.parse(text) : {};
  return schema.parse(parsed);
};

const getHeader = (message: GmailMessage, name: string): string | undefined => {
  const headers = message.payload?.headers;
  return decodeMimeHeaderValue(
    headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value,
  );
};

const toMessageListItem = async (
  message: GmailMessage,
  includeBody = false,
): Promise<MessageListItem> => {
  const labelIds = normalizeLabelIds(message.labelIds);
  const content = includeBody
    ? extractMessageContent(message.payload)
    : { html: undefined, text: undefined };
  const from = getHeader(message, "From");

  return {
    id: message.id,
    threadId: message.threadId,
    snippet: decodeMimeHeaderValue(message.snippet),
    subject: getHeader(message, "Subject"),
    from,
    date: getHeader(message, "Date"),
    internalDate: message.internalDate,
    bodyHtml: content.html,
    bodyText: content.text,
    senderAvatarUrls: await getSenderAvatarUrls(from),
    labelIds,
    isUnread: hasUnreadLabel(labelIds),
  };
};

const getMessageTimestamp = (message: MessageListItem): number => {
  const source = message.internalDate ?? message.date;
  if (!source) return 0;

  const numeric = Number(source);
  const parsedDate = Number.isFinite(numeric) ? new Date(numeric) : new Date(source);
  const timestamp = parsedDate.getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const listMessages = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    mailbox?: MailboxCategory;
    signal?: AbortSignal;
  },
) => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/messages", listMessagesSchema, {
    query: {
      maxResults: options?.maxResults ?? 20,
      pageToken: options?.pageToken,
      labelIds: options?.mailbox ? [MAILBOX_LABELS[options.mailbox]] : undefined,
      includeSpamTrash: options?.mailbox === "trash" ? true : undefined,
    },
    signal: options?.signal,
  });
};

export const getGmailProfile = async (
  accessToken: string,
  signal?: AbortSignal,
): Promise<GmailProfile> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/profile", gmailProfileSchema, {
    signal,
  });
};

export const getGmailMessage = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestGmail(
        accessToken,
        `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
        gmailMessageSchema,
        {
          query: {
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"],
          },
          signal,
        },
      );
    } catch (error) {
      const shouldRetry =
        isErrorWithStatus(error) &&
        error.status === 429 &&
        attempt < GMAIL_METADATA_RETRY_LIMIT &&
        !signal?.aborted;

      if (!shouldRetry) {
        throw error;
      }

      await sleep(getRetryDelayMs(attempt, error.retryAfterMs));
    }
  }
};

export const listMessagesWithDetails = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    mailbox?: MailboxCategory;
    signal?: AbortSignal;
  },
): Promise<ListMessagesPageResult> => {
  const list = await listMessages(accessToken, options);
  const details = await mapWithConcurrency(
    list.messages,
    GMAIL_MESSAGE_DETAILS_CONCURRENCY,
    async (message) => await getGmailMessage(accessToken, message.id, options?.signal),
  );

  return {
    messages: await Promise.all(details.map(async (message) => await toMessageListItem(message))),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
  };
};

export const getThreadWithDetails = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadMessagesResult> => {
  const thread = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
    gmailThreadSchema,
    {
      query: { format: "full" },
      signal,
    },
  );

  const messages = (
    await Promise.all(
      (thread.messages ?? []).map(async (message) => await toMessageListItem(message, true)),
    )
  ).sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));

  const subject = messages.reduce<string | undefined>((resolved, message) => {
    if (!message.subject?.trim()) return resolved;
    return message.subject;
  }, undefined);

  return {
    threadId: thread.id,
    snippet: decodeMimeHeaderValue(thread.snippet),
    subject,
    messages,
  };
};

export const listLabels = async (
  accessToken: string,
  signal?: AbortSignal,
): Promise<GmailLabelListItem[]> => {
  const response = await requestGmail(accessToken, "/gmail/v1/users/me/labels", listLabelsSchema, {
    signal,
  });

  return [...(response.labels ?? [])].sort((left, right) => {
    if (left.type !== right.type) {
      if (left.type === "user") return -1;
      if (right.type === "user") return 1;
    }

    return left.name.localeCompare(right.name);
  });
};

const toMessageMetadataUpdate = (message: GmailMessage) => {
  const labelIds = normalizeLabelIds(message.labelIds);

  return {
    id: message.id,
    labelIds,
    isUnread: hasUnreadLabel(labelIds),
  };
};

const toThreadMetadataUpdate = (thread: z.infer<typeof gmailThreadSchema>) => ({
  threadId: thread.id,
  messages: (thread.messages ?? []).map((message) => toMessageMetadataUpdate(message)),
});

export const markMessageAsRead = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    gmailMessageSchema,
    {
      method: "POST",
      body: { removeLabelIds: [GMAIL_UNREAD_LABEL] },
      signal,
    },
  );

  return toMessageMetadataUpdate(updated);
};

export const markMessageAsUnread = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    gmailMessageSchema,
    {
      method: "POST",
      body: { addLabelIds: [GMAIL_UNREAD_LABEL] },
      signal,
    },
  );

  return toMessageMetadataUpdate(updated);
};

export const markThreadAsRead = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    gmailThreadSchema,
    {
      method: "POST",
      body: { removeLabelIds: [GMAIL_UNREAD_LABEL] },
      signal,
    },
  );

  return toThreadMetadataUpdate(updated);
};

export const markThreadAsUnread = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    gmailThreadSchema,
    {
      method: "POST",
      body: { addLabelIds: [GMAIL_UNREAD_LABEL] },
      signal,
    },
  );

  return toThreadMetadataUpdate(updated);
};

export const updateMessageLabels = async (
  accessToken: string,
  messageId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    gmailMessageSchema,
    {
      method: "POST",
      body: changes,
      signal,
    },
  );

  return toMessageMetadataUpdate(updated);
};

export const moveMessageToTrash = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`,
    gmailMessageSchema,
    {
      method: "POST",
      signal,
    },
  );

  return toMessageMetadataUpdate(updated);
};

export const deleteMessagePermanently = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => {
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
    z.object({}).passthrough(),
    {
      method: "DELETE",
      signal,
    },
  );

  return { id: messageId };
};

export const getDraft = async (
  accessToken: string,
  draftId: string,
  signal?: AbortSignal,
): Promise<GmailDraft> => {
  return await requestGmail(
    accessToken,
    `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    gmailDraftSchema,
    {
      query: { format: "full" },
      signal,
    },
  );
};

export const createDraft = async (
  accessToken: string,
  raw: string,
  signal?: AbortSignal,
): Promise<GmailDraft> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/drafts", gmailDraftSchema, {
    method: "POST",
    body: { message: { raw } },
    signal,
  });
};

export const updateDraft = async (
  accessToken: string,
  draftId: string,
  raw: string,
  signal?: AbortSignal,
): Promise<GmailDraft> => {
  return await requestGmail(
    accessToken,
    `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    gmailDraftSchema,
    {
      method: "PUT",
      body: { id: draftId, message: { raw } },
      signal,
    },
  );
};

export const sendDraft = async (
  accessToken: string,
  draftId: string,
  signal?: AbortSignal,
): Promise<GmailMessage> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/drafts/send", gmailMessageSchema, {
    method: "POST",
    body: { id: draftId },
    signal,
  });
};

export const deleteDraft = async (
  accessToken: string,
  draftId: string,
  signal?: AbortSignal,
): Promise<void> => {
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    z.object({}).passthrough(),
    {
      method: "DELETE",
      signal,
    },
  );
};

export const getMessageAttachment = async (
  accessToken: string,
  messageId: string,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<GmailAttachment> => {
  return await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    gmailAttachmentSchema,
    { signal },
  );
};
