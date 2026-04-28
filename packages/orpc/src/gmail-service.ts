import { z } from "zod";
import type { ComposeDraftAnchor } from "./gmail/compose/schema";
import {
  decodePartBody,
  decodeMimeHeaderValue,
  extractMessageAttachments,
  extractMessageContent,
  findRenderablePart,
} from "./gmail-message-content";
import { parseDraftAnchorFromHeaderReader } from "./gmail/compose/draft-anchor";
import { getSenderAvatarUrls } from "./sender-avatar";

export const MAILBOX_LABELS = {
  inbox: "INBOX",
  spam: "SPAM",
  sent: "SENT",
  trash: "TRASH",
  drafts: "DRAFT",
} as const;

export type MailboxCategory = keyof typeof MAILBOX_LABELS;

export const GMAIL_UNREAD_LABEL = "UNREAD";

const headerSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export type MessageHeader = z.infer<typeof headerSchema>;

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

const gmailApiErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    errors: z
      .array(
        z.object({
          domain: z.string().optional(),
          location: z.string().optional(),
          locationType: z.string().optional(),
          message: z.string().optional(),
          reason: z.string().optional(),
        }),
      )
      .optional(),
  }),
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

const listDraftsSchema = z.object({
  drafts: z
    .array(
      z.object({
        id: z.string(),
        message: z
          .object({
            id: z.string(),
            threadId: z.string(),
          })
          .optional(),
      }),
    )
    .default([]),
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

export type GmailMessagePart = RecursiveMessagePart;

export type MessageListItem = {
  id: string;
  threadId: string;
  threadMessageCount?: number;
  threadAttachmentCount?: number;
  draftId?: string;
  draftAnchor?: ComposeDraftAnchor;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  replyTo?: string;
  messageHeaderId?: string;
  references?: string;
  date?: string;
  internalDate?: string;
  bodyHtml?: string;
  bodyText?: string;
  attachments?: MessageAttachment[];
  unsubscribeMailto?: string;
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

export type MessageInspectorResult = {
  id: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  messageHeaderId?: string;
  references?: string;
  date?: string;
  internalDate?: string;
  headers: MessageHeader[];
  payload?: GmailMessagePart;
  raw?: string;
  rawText?: string;
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
export type GmailServiceError = Error & {
  googleReason?: string;
  googleStatus?: string;
  status: number;
  retryAfterMs?: number;
};
export type MailboxSyncDelta = {
  historyId?: string;
  hasChanges: boolean;
  refreshFirstPage: boolean;
  removedMessageIds: string[];
  requiresFullRefresh: boolean;
  updatedMessages: MessageListItem[];
};
export { decodeMimeHeaderValue, extractMessageContent };

type ThreadListSummary = {
  messageCount: number;
  attachmentCount: number;
};

const GMAIL_BATCH_MESSAGE_CHUNK_SIZE = 25;
const GMAIL_METADATA_RETRY_LIMIT = 2;
const GMAIL_METADATA_RETRY_BASE_DELAY_MS = 250;
const GMAIL_SERVICE_UNAVAILABLE_RETRY_AFTER_MS = 1000 * 5;
const GMAIL_RATE_LIMIT_REASONS = new Set([
  "dailylimitexceeded",
  "quotaexceeded",
  "ratelimitexceeded",
  "resourceexhausted",
  "userratelimitexceeded",
]);
const GMAIL_RATE_LIMIT_RETRY_AFTER_MS = 1000 * 60;
const GMAIL_MESSAGE_PAYLOAD_METADATA_FIELDS =
  "headers(name,value),mimeType,filename,body(attachmentId,size),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size)))))";
const GMAIL_THREAD_PAYLOAD_METADATA_FIELDS =
  "headers(name,value),mimeType,filename,body(attachmentId,size,data),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size,data),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size,data),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size,data),parts(partId,mimeType,filename,headers(name,value),body(attachmentId,size,data)))))";
const GMAIL_MESSAGE_METADATA_FIELDS = `id,threadId,labelIds,snippet,historyId,internalDate,payload(${GMAIL_MESSAGE_PAYLOAD_METADATA_FIELDS})`;
const GMAIL_THREAD_DETAIL_MESSAGE_FIELDS = `id,threadId,labelIds,snippet,historyId,internalDate,payload(${GMAIL_THREAD_PAYLOAD_METADATA_FIELDS})`;
const GMAIL_THREAD_DETAIL_FIELDS = `id,snippet,messages(${GMAIL_THREAD_DETAIL_MESSAGE_FIELDS})`;
const GMAIL_THREAD_LIST_METADATA_FIELDS = `id,messages(id,threadId,labelIds,payload(${GMAIL_MESSAGE_PAYLOAD_METADATA_FIELDS}))`;
const GMAIL_MESSAGE_LIST_FIELDS = "messages(id,threadId),nextPageToken,resultSizeEstimate";
const GMAIL_DRAFT_LIST_FIELDS = "drafts(id,message(id,threadId)),nextPageToken,resultSizeEstimate";
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

const hasDraftLabel = (labelIds: string[] | undefined): boolean =>
  Boolean(labelIds?.includes(MAILBOX_LABELS.drafts));

const isKnownGmailRateLimit = (details: {
  googleReason?: string;
  googleStatus?: string;
  message?: string;
  status: number;
}) => {
  if (details.status === 429 || details.status === 503) {
    return true;
  }

  if (details.status !== 403) {
    return false;
  }

  if (details.googleReason && GMAIL_RATE_LIMIT_REASONS.has(details.googleReason)) {
    return true;
  }

  if (details.googleStatus === "RESOURCE_EXHAUSTED") {
    return true;
  }

  const normalizedMessage = details.message?.trim().toLowerCase();
  return Boolean(
    normalizedMessage &&
    (normalizedMessage.includes("quota exceeded") ||
      normalizedMessage.includes("rate limit exceeded") ||
      normalizedMessage.includes("resource exhausted")),
  );
};

const createGoogleApiError = async (response: Response) => {
  const body = await response.text().catch(() => "");
  const parsedBody = (() => {
    if (!body.trim()) {
      return null;
    }

    try {
      return gmailApiErrorSchema.parse(JSON.parse(body));
    } catch {
      return null;
    }
  })();
  const googleMessage = parsedBody?.error.message?.trim();
  const googleStatus = parsedBody?.error.status?.trim().toUpperCase();
  const googleReason = parsedBody?.error.errors?.[0]?.reason?.trim().toLowerCase();
  const message =
    googleReason === "invalidargument" && googleMessage === "Invalid To header"
      ? "Check the To field. One or more recipient addresses are invalid."
      : googleReason === "invalidargument" && googleMessage === "Invalid Cc header"
        ? "Check the Cc field. One or more recipient addresses are invalid."
        : googleReason === "invalidargument" && googleMessage === "Invalid Bcc header"
          ? "Check the Bcc field. One or more recipient addresses are invalid."
          : googleMessage || body || `Google API request failed with status ${response.status}.`;
  const error = new Error(message) as Error & {
    googleReason?: string;
    googleStatus?: string;
    status: number;
    retryAfterMs?: number;
  };
  error.googleReason = googleReason;
  error.googleStatus = googleStatus;
  error.status = response.status;
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      error.retryAfterMs = retryAfterSeconds * 1000;
    }
  }
  if (
    error.retryAfterMs == null &&
    isKnownGmailRateLimit({
      googleReason,
      googleStatus,
      message,
      status: response.status,
    })
  ) {
    error.retryAfterMs =
      response.status === 503
        ? GMAIL_SERVICE_UNAVAILABLE_RETRY_AFTER_MS
        : GMAIL_RATE_LIMIT_RETRY_AFTER_MS;
  }
  return error;
};

const isErrorWithStatus = (error: unknown): error is GmailServiceError =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof (error as { status?: unknown }).status === "number";

export const isGmailServiceError = (error: unknown): error is GmailServiceError =>
  isErrorWithStatus(error);

export const isGmailRateLimitedError = (error: unknown): error is GmailServiceError =>
  isErrorWithStatus(error) &&
  isKnownGmailRateLimit({
    googleReason:
      "googleReason" in error && typeof error.googleReason === "string"
        ? error.googleReason
        : undefined,
    googleStatus:
      "googleStatus" in error && typeof error.googleStatus === "string"
        ? error.googleStatus
        : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
    status: error.status,
  });

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

const decodeBase64UrlToBytes = (value: string) => {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

const decodeRawMessageText = (raw: string | undefined) => {
  if (!raw?.trim()) {
    return undefined;
  }

  return new TextDecoder().decode(decodeBase64UrlToBytes(raw));
};

export const extractListUnsubscribeMailto = (value: string | undefined) => {
  const normalized = decodeMimeHeaderValue(value)?.trim();
  if (!normalized) return undefined;

  const entries = normalized.match(/<[^>]+>|[^,]+/g) ?? [];

  for (const entry of entries) {
    const candidate = entry.trim().replace(/^<|>$/g, "").trim();
    if (!candidate || !candidate.toLowerCase().startsWith("mailto:")) {
      continue;
    }

    try {
      const url = new URL(candidate);
      if (url.protocol !== "mailto:") {
        continue;
      }

      const pathname = decodeURIComponent(url.pathname).trim();
      const queryTo = url.searchParams.get("to")?.trim();

      if (!pathname && !queryTo) {
        continue;
      }

      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
};

const resolveRenderablePartBody = async (
  accessToken: string,
  message: GmailMessage,
  mimeType: "text/html" | "text/plain",
  signal?: AbortSignal,
) => {
  const renderablePart = findRenderablePart(message.payload, mimeType);
  if (!renderablePart) {
    return undefined;
  }

  if (renderablePart.body?.data) {
    return decodePartBody(renderablePart);
  }

  const attachmentId = renderablePart.body?.attachmentId?.trim();
  if (!attachmentId) {
    return undefined;
  }

  const attachment = await getMessageAttachment(accessToken, message.id, attachmentId, signal);
  if (!attachment.data) {
    return undefined;
  }

  return decodePartBody({
    ...renderablePart,
    body: {
      ...renderablePart.body,
      data: attachment.data,
    },
  });
};

const resolveMessageContent = async (
  accessToken: string,
  message: GmailMessage,
  signal?: AbortSignal,
) => {
  const inlineContent = extractMessageContent(message.payload);
  const [html, text] = await Promise.all([
    inlineContent.html
      ? Promise.resolve(inlineContent.html)
      : resolveRenderablePartBody(accessToken, message, "text/html", signal),
    inlineContent.text
      ? Promise.resolve(inlineContent.text)
      : resolveRenderablePartBody(accessToken, message, "text/plain", signal),
  ]);

  return { html, text };
};

const toMessageListItem = async (
  accessToken: string,
  message: GmailMessage,
  options: {
    includeAttachmentMetadata?: boolean;
    includeBody?: boolean;
    threadSummary?: ThreadListSummary;
  } = {},
  signal?: AbortSignal,
): Promise<MessageListItem> => {
  const includeBody = options.includeBody ?? false;
  const labelIds = normalizeLabelIds(message.labelIds);
  const content = includeBody
    ? await resolveMessageContent(accessToken, message, signal)
    : { html: undefined, text: undefined };
  const from = getHeader(message, "From");

  return {
    id: message.id,
    threadId: message.threadId,
    threadMessageCount: options.threadSummary?.messageCount,
    threadAttachmentCount: options.threadSummary?.attachmentCount,
    snippet: decodeMimeHeaderValue(message.snippet),
    draftAnchor: parseDraftAnchorFromHeaderReader((name) => getHeader(message, name)),
    subject: getHeader(message, "Subject"),
    from,
    to: getHeader(message, "To"),
    cc: getHeader(message, "Cc"),
    bcc: getHeader(message, "Bcc"),
    inReplyTo: getHeader(message, "In-Reply-To"),
    replyTo: getHeader(message, "Reply-To"),
    messageHeaderId: getHeader(message, "Message-ID"),
    references: getHeader(message, "References"),
    date: getHeader(message, "Date"),
    internalDate: message.internalDate,
    bodyHtml: content.html,
    bodyText: content.text,
    attachments:
      includeBody || options.includeAttachmentMetadata
        ? extractMessageAttachments(message.payload)
        : undefined,
    unsubscribeMailto: extractListUnsubscribeMailto(getHeader(message, "List-Unsubscribe")),
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

const listDrafts = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    query?: string;
    signal?: AbortSignal;
  },
) => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/drafts", listDraftsSchema, {
    query: {
      fields: GMAIL_DRAFT_LIST_FIELDS,
      maxResults: options?.maxResults ?? 20,
      pageToken: options?.pageToken,
      q: options?.query?.trim() || undefined,
    },
    signal: options?.signal,
  });
};

const getDraftIdForMessageHeaderId = async (
  accessToken: string,
  messageHeaderId: string,
  threadId: string,
  signal?: AbortSignal,
) => {
  const list = await listDrafts(accessToken, {
    maxResults: 10,
    query: `rfc822msgid:${messageHeaderId}`,
    signal,
  });

  return list.drafts.find((draft) => draft.message?.threadId === threadId)?.id;
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

export const getGmailMessageMetadata = async (
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
            format: "full",
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
          format: "full",
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

const getGmailThreadsListMetadataBatch = async (
  accessToken: string,
  threadIds: readonly string[],
  signal?: AbortSignal,
) => {
  if (threadIds.length === 0) return [];

  const boundary = `batch_${crypto.randomUUID().replaceAll("-", "")}`;
  const body = [
    ...threadIds.map((threadId, index) =>
      buildBatchPart(
        boundary,
        `thread-${index}`,
        buildGmailPathWithQuery(`/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`, {
          fields: GMAIL_THREAD_LIST_METADATA_FIELDS,
          format: "full",
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

  if (parts.length !== threadIds.length) {
    throw new Error("Gmail batch response size did not match the requested thread count.");
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
    return gmailThreadSchema.parse(parsed);
  });
};

const getGmailThreadsListMetadata = async (
  accessToken: string,
  threadIds: readonly string[],
  signal?: AbortSignal,
) => {
  const uniqueThreadIds = Array.from(new Set(threadIds));
  const threads: Array<z.infer<typeof gmailThreadSchema> | null> = [];

  for (const batchThreadIds of chunkArray(uniqueThreadIds, GMAIL_BATCH_MESSAGE_CHUNK_SIZE)) {
    try {
      threads.push(
        ...(await getGmailThreadsListMetadataBatch(accessToken, batchThreadIds, signal)),
      );
    } catch {
      for (const threadId of batchThreadIds) {
        try {
          const thread = await requestGmail(
            accessToken,
            `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
            gmailThreadSchema,
            {
              query: {
                fields: GMAIL_THREAD_LIST_METADATA_FIELDS,
                format: "full",
              },
              signal,
            },
          );
          threads.push(thread);
        } catch (error) {
          if (isErrorWithStatus(error) && error.status === 404) {
            threads.push(null);
            continue;
          }

          throw error;
        }
      }
    }
  }

  return threads;
};

const getThreadListSummaries = async (
  accessToken: string,
  threadIds: readonly string[],
  options?: { includeDrafts?: boolean },
  signal?: AbortSignal,
) => {
  const summariesByThreadId = new Map<string, ThreadListSummary>();
  const threads = await getGmailThreadsListMetadata(accessToken, threadIds, signal);

  for (const thread of threads) {
    if (!thread) continue;

    const messages = (thread.messages ?? []).filter(
      (message) => options?.includeDrafts || !hasDraftLabel(message.labelIds),
    );
    summariesByThreadId.set(thread.id, {
      attachmentCount: messages.reduce(
        (count, message) => count + extractMessageAttachments(message.payload).length,
        0,
      ),
      messageCount: messages.length,
    });
  }

  return summariesByThreadId;
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
  const [details, threadSummariesById] = await Promise.all([
    getGmailMessagesMetadata(accessToken, messageIds, options?.signal),
    getThreadListSummaries(
      accessToken,
      list.messages.map((message) => message.threadId),
      { includeDrafts: false },
      options?.signal,
    ),
  ]);
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
      orderedDetails.map(
        async (message) =>
          await toMessageListItem(accessToken, message, {
            threadSummary: threadSummariesById.get(message.threadId),
          }),
      ),
    ),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
    historyId,
  };
};

export const listDraftsWithDetails = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    query?: string;
    signal?: AbortSignal;
  },
): Promise<ListMessagesPageResult> => {
  const list = await listDrafts(accessToken, options);
  const draftRefs = list.drafts.flatMap((draft) => {
    if (!draft.message?.id || !draft.message.threadId) {
      return [];
    }

    return [
      {
        draftId: draft.id,
        messageId: draft.message.id,
        threadId: draft.message.threadId,
      },
    ];
  });
  const [draftDetails, threadSummariesById] = await Promise.all([
    Promise.all(
      draftRefs.map(async (draft) => {
        try {
          return {
            draftId: draft.draftId,
            draft: await getDraft(accessToken, draft.draftId, options?.signal),
          };
        } catch (error) {
          if (isErrorWithStatus(error) && error.status === 404) {
            return null;
          }

          throw error;
        }
      }),
    ),
    getThreadListSummaries(
      accessToken,
      draftRefs.map((draft) => draft.threadId),
      { includeDrafts: true },
      options?.signal,
    ),
  ]);
  const orderedDrafts = draftDetails.flatMap((draft) => {
    const message = draft?.draft.message;
    return message ? [{ draftId: draft.draftId, message }] : [];
  });

  return {
    messages: await Promise.all(
      orderedDrafts.map(async (draft) => ({
        ...(await toMessageListItem(
          accessToken,
          draft.message,
          {
            includeBody: true,
            threadSummary: threadSummariesById.get(draft.message.threadId),
          },
          options?.signal,
        )),
        draftId: draft.draftId,
      })),
    ),
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
      query: { fields: GMAIL_THREAD_DETAIL_FIELDS, format: "full" },
      signal,
    },
  );

  const messages = (
    await Promise.all(
      (thread.messages ?? []).map(
        async (message) =>
          await toMessageListItem(accessToken, message, { includeBody: true }, signal),
      ),
    )
  ).sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));
  const draftIdsByMessageId = new Map(
    (
      await Promise.all(
        messages
          .filter(
            (message) =>
              message.labelIds?.includes(MAILBOX_LABELS.drafts) &&
              Boolean(message.messageHeaderId?.trim()),
          )
          .map(async (message) => [
            message.id,
            await getDraftIdForMessageHeaderId(
              accessToken,
              message.messageHeaderId!.trim(),
              message.threadId,
              signal,
            ),
          ]),
      )
    ).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  const subject = messages.reduce<string | undefined>((resolved, message) => {
    if (!message.subject?.trim()) return resolved;
    return message.subject;
  }, undefined);

  return {
    threadId: thread.id,
    snippet: decodeMimeHeaderValue(thread.snippet),
    subject,
    messages: messages.map((message) =>
      draftIdsByMessageId.has(message.id)
        ? {
            ...message,
            draftId: draftIdsByMessageId.get(message.id),
          }
        : message,
    ),
  };
};

export const getMessageInspector = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<MessageInspectorResult> => {
  const path = `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`;
  const [fullMessage, rawMessage] = await Promise.all([
    requestGmail(accessToken, path, gmailMessageSchema, {
      query: { format: "full" },
      signal,
    }),
    requestGmail(accessToken, path, gmailMessageSchema, {
      query: { format: "raw" },
      signal,
    }),
  ]);

  const headers = (fullMessage.payload?.headers ?? []).map((header) => ({
    name: header.name,
    value: decodeMimeHeaderValue(header.value) ?? header.value,
  }));

  return {
    id: fullMessage.id,
    snippet: decodeMimeHeaderValue(fullMessage.snippet),
    subject: getHeader(fullMessage, "Subject"),
    from: getHeader(fullMessage, "From"),
    to: getHeader(fullMessage, "To"),
    cc: getHeader(fullMessage, "Cc"),
    bcc: getHeader(fullMessage, "Bcc"),
    replyTo: getHeader(fullMessage, "Reply-To"),
    messageHeaderId: getHeader(fullMessage, "Message-ID"),
    references: getHeader(fullMessage, "References"),
    date: getHeader(fullMessage, "Date"),
    internalDate: fullMessage.internalDate,
    headers,
    payload: fullMessage.payload,
    raw: rawMessage.raw,
    rawText: decodeRawMessageText(rawMessage.raw),
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

      updatedMessages.push(await toMessageListItem(accessToken, changedMessage));
    }

    const threadSummariesById = await getThreadListSummaries(
      accessToken,
      updatedMessages.map((message) => message.threadId),
      { includeDrafts: options.mailbox === "drafts" },
      options.signal,
    );

    for (const [index, updatedMessage] of updatedMessages.entries()) {
      const threadSummary = threadSummariesById.get(updatedMessage.threadId);
      if (!threadSummary) continue;

      updatedMessages[index] = {
        ...updatedMessage,
        threadAttachmentCount: threadSummary.attachmentCount,
        threadMessageCount: threadSummary.messageCount,
      };
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

export const updateThreadLabels = async (
  accessToken: string,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
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
      body: changes,
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

export const moveThreadToTrash = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/trash`,
    gmailThreadMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,historyId,messages(id,labelIds,historyId)",
      },
      signal,
    },
  );

  return toThreadMetadataUpdate(updated);
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

export const untrashMessage = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/untrash`,
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

export const untrashThread = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal,
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/untrash`,
    gmailThreadMutationSchema,
    {
      method: "POST",
      query: {
        fields: "id,historyId,messages(id,labelIds,historyId)",
      },
      signal,
    },
  );

  return toThreadMetadataUpdate(updated);
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

export const deleteThreadPermanently = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal,
) => {
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
    z.object({}).passthrough(),
    {
      method: "DELETE",
      signal,
    },
  );

  return { threadId };
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
  raw?: string,
  threadId?: string,
  signal?: AbortSignal,
): Promise<GmailMessage> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/drafts/send", gmailMessageSchema, {
    method: "POST",
    body: raw
      ? {
          id: draftId,
          message: {
            raw,
            threadId,
          },
        }
      : { id: draftId },
    signal,
  });
};

export const sendRawMessage = async (
  accessToken: string,
  raw: string,
  signal?: AbortSignal,
): Promise<GmailMessage> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/messages/send", gmailMessageSchema, {
    method: "POST",
    body: { raw },
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
