import { z } from "zod";
import {
  decodeMimeHeaderValue,
  extractMessageAttachments,
  extractMessageContent,
} from "./gmail-message-content";
import { getSenderAvatarUrls } from "./sender-avatar";

export const MAILBOX_LABELS = {
  inbox: "INBOX",
  spam: "SPAM",
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

const gmailMessageMutationSchema = z.object({
  id: z.string(),
  labelIds: z.array(z.string()).optional(),
  historyId: z.string().optional(),
});

const gmailThreadSchema = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  snippet: z.string().optional(),
  messages: z.array(gmailMessageSchema).optional(),
});

const gmailThreadMutationSchema = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  messages: z.array(gmailMessageMutationSchema).optional(),
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

const gmailHistoryMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

const gmailHistoryRecordSchema = z.object({
  id: z.string().optional(),
  messagesAdded: z
    .array(
      z.object({
        message: gmailHistoryMessageSchema,
      }),
    )
    .optional(),
  messagesDeleted: z
    .array(
      z.object({
        message: gmailHistoryMessageSchema,
      }),
    )
    .optional(),
  labelsAdded: z
    .array(
      z.object({
        message: gmailHistoryMessageSchema,
        labelIds: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  labelsRemoved: z
    .array(
      z.object({
        message: gmailHistoryMessageSchema,
        labelIds: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const listHistorySchema = z.object({
  history: z.array(gmailHistoryRecordSchema).optional(),
  historyId: z.string().optional(),
  nextPageToken: z.string().optional(),
});

export type MessageListItem = {
  id: string;
  threadId: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  replyTo?: string;
  messageHeaderId?: string;
  references?: string;
  date?: string;
  internalDate?: string;
  bodyHtml?: string;
  bodyText?: string;
  attachments?: MessageAttachment[];
  senderAvatarUrls?: { light: string; dark: string };
  labelIds?: string[];
  isUnread?: boolean;
};

export type MessageAttachment = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type ListMessagesPageResult = {
  messages: MessageListItem[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
  historyId?: string;
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
export type MailboxSyncDelta = {
  historyId?: string;
  hasChanges: boolean;
  refreshFirstPage: boolean;
  removedMessageIds: string[];
  requiresFullRefresh: boolean;
  updatedMessages: MessageListItem[];
};
export { decodeMimeHeaderValue, extractMessageContent };

const GMAIL_BATCH_MESSAGE_CHUNK_SIZE = 25;
const GMAIL_METADATA_RETRY_LIMIT = 2;
const GMAIL_METADATA_RETRY_BASE_DELAY_MS = 250;
const GMAIL_MESSAGE_METADATA_HEADERS = [
  "Subject",
  "From",
  "To",
  "Cc",
  "Reply-To",
  "Date",
  "Message-ID",
  "References",
] as const;
const GMAIL_MESSAGE_METADATA_FIELDS =
  "id,threadId,labelIds,snippet,historyId,internalDate,payload(headers(name,value))";
const GMAIL_MESSAGE_LIST_FIELDS = "messages(id,threadId),nextPageToken,resultSizeEstimate";
const GMAIL_LABEL_LIST_FIELDS = "labels(id,name,type,labelListVisibility,messageListVisibility)";
const GMAIL_PROFILE_FIELDS = "emailAddress,historyId,messagesTotal,threadsTotal";
const GMAIL_HISTORY_FIELDS =
  "history(messagesAdded(message(id,threadId)),messagesDeleted(message(id,threadId)),labelsAdded(message(id,threadId),labelIds),labelsRemoved(message(id,threadId),labelIds)),historyId,nextPageToken";

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

type GmailRequestQuery = Record<
  string,
  string | number | boolean | undefined | string[] | readonly string[] | undefined
>;

const appendQueryParameters = (searchParams: URLSearchParams, query: GmailRequestQuery = {}) => {
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value == null) continue;
      searchParams.append(key, String(value));
    }
  }
};

const buildGmailPathWithQuery = (path: string, query?: GmailRequestQuery) => {
  const url = new URL(`https://gmail.googleapis.com${path}`);
  appendQueryParameters(url.searchParams, query);
  return `${url.pathname}${url.search}`;
};

const chunkArray = <TValue>(items: readonly TValue[], size: number): TValue[][] => {
  if (items.length === 0) return [];

  const chunks: TValue[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const buildBatchPart = (boundary: string, id: string, pathWithQuery: string) => {
  return [
    `--${boundary}`,
    "Content-Type: application/http",
    `Content-ID: <${id}>`,
    "",
    `GET ${pathWithQuery} HTTP/1.1`,
    "",
    "",
  ].join("\r\n");
};

const parseBatchResponseParts = (response: Response, text: string) => {
  const contentType = response.headers.get("content-type") ?? "";
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  const boundary = boundaryMatch?.[1]?.trim();

  if (!boundary) {
    throw new Error("Gmail batch response did not include a multipart boundary.");
  }

  return text
    .split(`--${boundary}`)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "--")
    .map((part) => {
      const normalizedPart = part.replace(/\r\n/g, "\n");
      const nestedResponseIndex = normalizedPart.indexOf("\n\n");
      const nestedResponse =
        nestedResponseIndex === -1 ? normalizedPart : normalizedPart.slice(nestedResponseIndex + 2);

      const nestedHeadersIndex = nestedResponse.indexOf("\n\n");
      const responseHead =
        nestedHeadersIndex === -1
          ? nestedResponse.trim()
          : nestedResponse.slice(0, nestedHeadersIndex).trim();
      const responseBody =
        nestedHeadersIndex === -1 ? "" : nestedResponse.slice(nestedHeadersIndex + 2).trim();

      const [statusLine] = responseHead.split("\n");
      const statusMatch = statusLine?.match(/^HTTP\/\d+(?:\.\d+)?\s+(\d{3})/);
      const status = statusMatch ? Number(statusMatch[1]) : Number.NaN;

      if (!Number.isFinite(status)) {
        throw new Error("Gmail batch response part did not include a valid HTTP status.");
      }

      return {
        body: responseBody,
        status,
      };
    });
};

const requestGmail = async <T>(
  accessToken: string,
  path: string,
  schema: z.ZodType<T>,
  options?: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    query?: GmailRequestQuery;
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<T> => {
  const url = new URL(`https://gmail.googleapis.com${path}`);
  appendQueryParameters(url.searchParams, options?.query);

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
    to: getHeader(message, "To"),
    cc: getHeader(message, "Cc"),
    replyTo: getHeader(message, "Reply-To"),
    messageHeaderId: getHeader(message, "Message-ID"),
    references: getHeader(message, "References"),
    date: getHeader(message, "Date"),
    internalDate: message.internalDate,
    bodyHtml: content.html,
    bodyText: content.text,
    attachments: includeBody ? extractMessageAttachments(message.payload) : undefined,
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
    query?: string;
    signal?: AbortSignal;
  },
) => {
  const includesSpamTrash = options?.mailbox === "spam" || options?.mailbox === "trash";

  return await requestGmail(accessToken, "/gmail/v1/users/me/messages", listMessagesSchema, {
    query: {
      fields: GMAIL_MESSAGE_LIST_FIELDS,
      maxResults: options?.maxResults ?? 20,
      pageToken: options?.pageToken,
      labelIds: options?.mailbox ? [MAILBOX_LABELS[options.mailbox]] : undefined,
      includeSpamTrash: includesSpamTrash ? true : undefined,
      q: options?.query?.trim() || undefined,
    },
    signal: options?.signal,
  });
};

export const getGmailProfile = async (
  accessToken: string,
  signal?: AbortSignal,
): Promise<GmailProfile> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/profile", gmailProfileSchema, {
    query: {
      fields: GMAIL_PROFILE_FIELDS,
    },
    signal,
  });
};

const getGmailMessageMetadata = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<GmailMessage> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestGmail(
        accessToken,
        `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
        gmailMessageSchema,
        {
          query: {
            fields: GMAIL_MESSAGE_METADATA_FIELDS,
            format: "metadata",
            metadataHeaders: GMAIL_MESSAGE_METADATA_HEADERS,
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

const getGmailMessageMetadataOrNull = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => {
  try {
    return await getGmailMessageMetadata(accessToken, messageId, signal);
  } catch (error) {
    if (isErrorWithStatus(error) && error.status === 404) {
      return null;
    }

    throw error;
  }
};

const getGmailMessagesMetadataBatch = async (
  accessToken: string,
  messageIds: readonly string[],
  signal?: AbortSignal,
) => {
  if (messageIds.length === 0) return [];

  const boundary = `batch_${crypto.randomUUID().replaceAll("-", "")}`;
  const body = [
    ...messageIds.map((messageId, index) =>
      buildBatchPart(
        boundary,
        `message-${index}`,
        buildGmailPathWithQuery(`/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`, {
          fields: GMAIL_MESSAGE_METADATA_FIELDS,
          format: "metadata",
          metadataHeaders: GMAIL_MESSAGE_METADATA_HEADERS,
        }),
      ),
    ),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body,
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw await createGoogleApiError(response);
  }

  const text = await response.text();
  const parts = parseBatchResponseParts(response, text);

  if (parts.length !== messageIds.length) {
    throw new Error("Gmail batch response size did not match the requested message count.");
  }

  return parts.map((part) => {
    if (part.status === 404) {
      return null;
    }

    if (part.status < 200 || part.status >= 300) {
      const error = new Error(
        part.body || `Gmail batch subrequest failed with status ${part.status}.`,
      ) as Error & { status: number };
      error.status = part.status;
      throw error;
    }

    const parsed = part.body.trim() ? JSON.parse(part.body) : {};
    return gmailMessageSchema.parse(parsed);
  });
};

const getGmailMessagesMetadata = async (
  accessToken: string,
  messageIds: readonly string[],
  signal?: AbortSignal,
) => {
  const messages: Array<GmailMessage | null> = [];

  for (const batchMessageIds of chunkArray(messageIds, GMAIL_BATCH_MESSAGE_CHUNK_SIZE)) {
    try {
      messages.push(...(await getGmailMessagesMetadataBatch(accessToken, batchMessageIds, signal)));
    } catch {
      for (const messageId of batchMessageIds) {
        messages.push(await getGmailMessageMetadataOrNull(accessToken, messageId, signal));
      }
    }
  }

  return messages;
};

export const listMessagesWithDetails = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    mailbox?: MailboxCategory;
    query?: string;
    signal?: AbortSignal;
  },
): Promise<ListMessagesPageResult> => {
  const list = await listMessages(accessToken, options);
  const messageIds = list.messages.map((message) => message.id);
  const details = await getGmailMessagesMetadata(accessToken, messageIds, options?.signal);
  const detailsById = new Map(
    details
      .filter((message): message is GmailMessage => Boolean(message))
      .map((message) => [message.id, message] as const),
  );
  const orderedDetails = list.messages
    .map((message) => detailsById.get(message.id))
    .filter((message): message is GmailMessage => Boolean(message));
  const historyId =
    orderedDetails[0]?.historyId ?? (await getGmailProfile(accessToken, options?.signal)).historyId;

  return {
    messages: await Promise.all(
      orderedDetails.map(async (message) => await toMessageListItem(message)),
    ),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
    historyId,
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
    query: {
      fields: GMAIL_LABEL_LIST_FIELDS,
    },
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

export const getMailboxSyncDelta = async (
  accessToken: string,
  options: {
    mailbox: MailboxCategory;
    startHistoryId: string;
    signal?: AbortSignal;
  },
): Promise<MailboxSyncDelta> => {
  const mailboxLabel = MAILBOX_LABELS[options.mailbox];
  let pageToken: string | undefined;
  const changedMessageIds = new Set<string>();
  const mailboxAdditionCandidateIds = new Set<string>();
  const removedMessageIds = new Set<string>();
  let nextHistoryId = options.startHistoryId;
  let refreshFirstPage = false;

  try {
    do {
      const response = await requestGmail(
        accessToken,
        "/gmail/v1/users/me/history",
        listHistorySchema,
        {
          query: {
            fields: GMAIL_HISTORY_FIELDS,
            historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
            maxResults: 100,
            pageToken,
            startHistoryId: options.startHistoryId,
          },
          signal: options.signal,
        },
      );

      nextHistoryId = response.historyId ?? nextHistoryId;

      for (const historyRecord of response.history ?? []) {
        for (const deleted of historyRecord.messagesDeleted ?? []) {
          removedMessageIds.add(deleted.message.id);
          changedMessageIds.delete(deleted.message.id);
          mailboxAdditionCandidateIds.delete(deleted.message.id);
          refreshFirstPage = true;
        }

        for (const labelsAdded of historyRecord.labelsAdded ?? []) {
          const labelIds = normalizeLabelIds(labelsAdded.labelIds);
          changedMessageIds.add(labelsAdded.message.id);

          if (labelIds?.includes(mailboxLabel)) {
            removedMessageIds.delete(labelsAdded.message.id);
            mailboxAdditionCandidateIds.add(labelsAdded.message.id);
            refreshFirstPage = true;
          }
        }

        for (const labelsRemoved of historyRecord.labelsRemoved ?? []) {
          const labelIds = normalizeLabelIds(labelsRemoved.labelIds);
          if (labelIds?.includes(mailboxLabel)) {
            removedMessageIds.add(labelsRemoved.message.id);
            changedMessageIds.delete(labelsRemoved.message.id);
            mailboxAdditionCandidateIds.delete(labelsRemoved.message.id);
            refreshFirstPage = true;
            continue;
          }

          changedMessageIds.add(labelsRemoved.message.id);
        }

        for (const added of historyRecord.messagesAdded ?? []) {
          if (removedMessageIds.has(added.message.id)) {
            removedMessageIds.delete(added.message.id);
          }

          changedMessageIds.add(added.message.id);
          mailboxAdditionCandidateIds.add(added.message.id);
        }
      }

      pageToken = response.nextPageToken;
    } while (pageToken);
  } catch (error) {
    if (isErrorWithStatus(error) && error.status === 404) {
      return {
        historyId: undefined,
        hasChanges: true,
        refreshFirstPage: false,
        removedMessageIds: [],
        requiresFullRefresh: true,
        updatedMessages: [],
      };
    }

    throw error;
  }

  const updatedMessages: MessageListItem[] = [];

  if (changedMessageIds.size > 0) {
    const changedMessages = await getGmailMessagesMetadata(
      accessToken,
      Array.from(changedMessageIds),
      options.signal,
    );

    for (const changedMessage of changedMessages) {
      if (!changedMessage) continue;

      const labelIds = normalizeLabelIds(changedMessage.labelIds);
      if (!labelIds?.includes(mailboxLabel)) {
        removedMessageIds.add(changedMessage.id);
        continue;
      }

      if (mailboxAdditionCandidateIds.has(changedMessage.id)) {
        refreshFirstPage = true;
      }

      updatedMessages.push(await toMessageListItem(changedMessage));
    }
  }

  return {
    historyId: nextHistoryId,
    hasChanges: nextHistoryId !== options.startHistoryId,
    refreshFirstPage,
    removedMessageIds: Array.from(removedMessageIds),
    requiresFullRefresh: false,
    updatedMessages,
  };
};

const toMessageMetadataUpdate = (message: z.infer<typeof gmailMessageMutationSchema>) => {
  const labelIds = normalizeLabelIds(message.labelIds);

  return {
    id: message.id,
    labelIds,
    isUnread: hasUnreadLabel(labelIds),
  };
};

const toThreadMetadataUpdate = (thread: z.infer<typeof gmailThreadMutationSchema>) => ({
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
    gmailMessageMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,labelIds,historyId",
      },
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
    gmailMessageMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,labelIds,historyId",
      },
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
    gmailThreadMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,historyId,messages(id,labelIds,historyId)",
      },
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
    gmailThreadMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,historyId,messages(id,labelIds,historyId)",
      },
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
    gmailMessageMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,labelIds,historyId",
      },
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
    gmailMessageMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,labelIds,historyId",
      },
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
  threadId?: string,
  signal?: AbortSignal,
): Promise<GmailDraft> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/drafts", gmailDraftSchema, {
    method: "POST",
    body: {
      message: {
        raw,
        threadId,
      },
    },
    signal,
  });
};

export const updateDraft = async (
  accessToken: string,
  draftId: string,
  raw: string,
  threadId?: string,
  signal?: AbortSignal,
): Promise<GmailDraft> => {
  return await requestGmail(
    accessToken,
    `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    gmailDraftSchema,
    {
      method: "PUT",
      body: {
        id: draftId,
        message: {
          raw,
          threadId,
        },
      },
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
