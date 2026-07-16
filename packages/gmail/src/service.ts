import type { ComposeDraftAnchor } from "@quieter/mail/compose/schema";
import type { MailCategory } from "@quieter/mail/data-plane";
import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import {
  decodePartBody,
  decodeMimeHeaderValue,
  extractMessageAttachments,
  extractMessageContent,
  findRenderablePart,
} from "@quieter/mail/message-content";
import { parseStructuredSearchQuery, serializeStructuredSearchState } from "@quieter/mail/search";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { z } from "zod";

export const MAILBOX_LABELS = {
  archive: "ARCHIVE",
  inbox: "INBOX",
  unread: "UNREAD",
  spam: "SPAM",
  sent: "SENT",
  trash: "TRASH",
  drafts: "DRAFT",
} as const;

export type MailboxCategory = MailCategory;

export const GMAIL_UNREAD_LABEL = MAILBOX_LABELS.unread;

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

const gmailWatchSchema = z.object({
  historyId: z.string(),
  expiration: z.string(),
});

const listMessagesSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

const listThreadsSchema = z.object({
  threads: z.array(z.object({ id: z.string(), historyId: z.string().optional() })).default([]),
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

const labelMutationSchema = gmailLabelSchema;

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
  apiSource?: {
    canCreateMailbox: boolean;
    canManageMailbox: boolean;
    includedInMailbox: boolean;
    organizationId: string;
    senderAddress: string;
    senderMailboxId: string | null;
  };
  unsubscribeMailto?: string;
  unsubscribeUrl?: string;
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
export type GmailWatch = {
  expiration: Date;
  historyId: string;
};
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
export type GmailAddedMessageHistoryPage = {
  hasMore: boolean;
  historyExpired: boolean;
  historyId: string;
  messageIds: string[];
  nextPageToken?: string;
};
export type GmailMessageIdPage = {
  messageIds: string[];
  nextPageToken?: string;
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
const GMAIL_THREAD_LIST_METADATA_FIELDS = `id,historyId,snippet,messages(id,threadId,labelIds,snippet,historyId,internalDate,payload(${GMAIL_MESSAGE_PAYLOAD_METADATA_FIELDS}))`;
const GMAIL_MESSAGE_LIST_FIELDS = "messages(id,threadId),nextPageToken,resultSizeEstimate";
const GMAIL_THREAD_LIST_FIELDS = "threads(id,historyId),nextPageToken,resultSizeEstimate";
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
  !!labelIds?.includes(GMAIL_UNREAD_LABEL);

const hasDraftLabel = (labelIds: string[] | undefined): boolean =>
  !!labelIds?.includes(MAILBOX_LABELS.drafts);

const isMessageInMailbox = (mailbox: MailboxCategory, labelIds: string[] | undefined): boolean => {
  if (mailbox === "archive") {
    return (
      !!labelIds &&
      ![
        MAILBOX_LABELS.inbox,
        MAILBOX_LABELS.sent,
        MAILBOX_LABELS.drafts,
        MAILBOX_LABELS.spam,
        MAILBOX_LABELS.trash,
      ].some((labelId) => labelIds.includes(labelId))
    );
  }
  if (!labelIds?.includes(MAILBOX_LABELS[mailbox])) return false;
  if (mailbox === "trash") return true;
  if (labelIds.includes(MAILBOX_LABELS.trash)) return false;
  if (mailbox !== "spam" && labelIds.includes(MAILBOX_LABELS.spam)) return false;
  return true;
};

const appendGmailQueryTerms = (
  query: string | undefined,
  terms: readonly string[],
): string | undefined => {
  const normalizedQuery = query?.trim();
  const existingTerms = new Set(normalizedQuery?.split(/\s+/) ?? []);
  const missingTerms = terms.filter((term) => !existingTerms.has(term));
  return [normalizedQuery, ...missingTerms].filter(Boolean).join(" ") || undefined;
};

const getListMessagesQuery = (mailbox: MailboxCategory | undefined, query: string | undefined) =>
  mailbox === "unread"
    ? appendGmailQueryTerms(query, ["-in:spam", "-in:trash"])
    : mailbox === "archive"
      ? appendGmailQueryTerms(query, [
          "-in:inbox",
          "-in:sent",
          "-label:drafts",
          "-in:spam",
          "-in:trash",
        ])
      : query?.trim() || undefined;

const compileGmailSearchQuery = (
  mailbox: MailboxCategory | undefined,
  query: string | undefined,
) => {
  const parsed = parseStructuredSearchQuery(query ?? "");
  const archived = parsed.filters.some(
    (filter) =>
      !filter.negated && filter.type === "is" && filter.value.toLowerCase() === "archived",
  );
  const providerQuery = serializeStructuredSearchState({
    ...parsed,
    filters: parsed.filters.filter(
      (filter) => !(filter.type === "is" && filter.value.toLowerCase() === "archived"),
    ),
  });
  return getListMessagesQuery(
    mailbox,
    archived
      ? appendGmailQueryTerms(providerQuery, [
          "-in:inbox",
          "-in:sent",
          "-label:drafts",
          "-in:spam",
          "-in:trash",
        ])
      : providerQuery,
  );
};

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
  return !!(
    normalizedMessage &&
    (normalizedMessage.includes("quota exceeded") ||
      normalizedMessage.includes("rate limit exceeded") ||
      normalizedMessage.includes("resource exhausted"))
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

const sleep = async (durationMs: number, signal?: AbortSignal) => {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    timeout = setTimeout(finish, durationMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
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
  string | number | boolean | undefined | string[] | readonly string[]
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
      const outerHeaders =
        nestedResponseIndex === -1 ? "" : normalizedPart.slice(0, nestedResponseIndex);
      const contentId = outerHeaders
        .match(/^content-id:\s*<?(?:response-)?([^>\s]+)>?$/im)?.[1]
        ?.trim();
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
        contentId,
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

export const extractListUnsubscribeTargets = (value: string | undefined) => {
  const normalized = decodeMimeHeaderValue(value)?.trim();
  let mailto: string | undefined;
  let url: string | undefined;

  for (const candidate of normalized
    ?.match(/<[^>]+>|[^,]+/g)
    ?.map((entry) => entry.trim().replace(/^<|>$/g, "").trim())
    .filter(Boolean) ?? []) {
    const normalizedCandidate = candidate.toLowerCase();
    if (
      !normalizedCandidate.startsWith("mailto:") &&
      !normalizedCandidate.startsWith("http://") &&
      !normalizedCandidate.startsWith("https://")
    ) {
      continue;
    }

    try {
      const parsedUrl = new URL(candidate);

      if (!mailto && parsedUrl.protocol === "mailto:") {
        const pathname = decodeURIComponent(parsedUrl.pathname).trim();
        const queryTo = parsedUrl.searchParams.get("to")?.trim();

        if (pathname || queryTo) {
          mailto = candidate;
        }
      }

      if (!url && (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")) {
        url = candidate;
      }
    } catch {
      continue;
    }
  }

  return { mailto, url };
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
  const unsubscribeTargets = extractListUnsubscribeTargets(getHeader(message, "List-Unsubscribe"));

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
    unsubscribeMailto: unsubscribeTargets.mailto,
    unsubscribeUrl: unsubscribeTargets.url,
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
      labelIds:
        options?.mailbox && options.mailbox !== "archive"
          ? [MAILBOX_LABELS[options.mailbox]]
          : undefined,
      includeSpamTrash: includesSpamTrash ? true : undefined,
      q: compileGmailSearchQuery(options?.mailbox, options?.query),
    },
    signal: options?.signal,
  });
};

const listThreads = async (
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
  return await requestGmail(accessToken, "/gmail/v1/users/me/threads", listThreadsSchema, {
    query: {
      fields: GMAIL_THREAD_LIST_FIELDS,
      maxResults: options?.maxResults ?? 15,
      pageToken: options?.pageToken,
      labelIds:
        options?.mailbox && options.mailbox !== "archive"
          ? [MAILBOX_LABELS[options.mailbox]]
          : undefined,
      includeSpamTrash: includesSpamTrash ? true : undefined,
      q: compileGmailSearchQuery(options?.mailbox, options?.query),
    },
    signal: options?.signal,
  });
};

export const listGmailMessageIds = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    mailbox?: MailboxCategory;
    query?: string;
    signal?: AbortSignal;
  },
): Promise<GmailMessageIdPage> => {
  const response = await listMessages(accessToken, options);

  return {
    messageIds: response.messages.map((message) => message.id),
    nextPageToken: response.nextPageToken,
  };
};

export const getGmailMessageCount = async (
  accessToken: string,
  options?: {
    accurateUpTo?: number;
    countBy?: "messages" | "threads";
    mailbox?: MailboxCategory;
    query?: string;
    signal?: AbortSignal;
  },
) => {
  if (options?.accurateUpTo !== undefined) {
    const { accurateUpTo, countBy = "messages", ...listOptions } = options;
    const countLimit = Math.max(0, Math.floor(accurateUpTo));
    const threadIds = new Set<string>();
    let messageCount = 0;
    let pageToken: string | undefined;
    let resultSizeEstimate = 0;
    const getCount = () => (countBy === "threads" ? threadIds.size : messageCount);

    do {
      const count = getCount();
      const result = await listMessages(accessToken, {
        ...listOptions,
        maxResults:
          countBy === "threads"
            ? Math.min(500, Math.max(1, countLimit + 1))
            : Math.min(500, Math.max(1, countLimit + 1 - count)),
        pageToken,
      });
      resultSizeEstimate = Math.max(resultSizeEstimate, result.resultSizeEstimate ?? 0);
      messageCount += result.messages.length;
      for (const message of result.messages) {
        threadIds.add(message.threadId);
      }
      pageToken = result.nextPageToken;
    } while (pageToken && getCount() <= countLimit);

    const count = getCount();
    if (countBy === "threads") return count;
    return pageToken ? Math.max(resultSizeEstimate, count) : count;
  }

  const result = await listMessages(accessToken, {
    mailbox: options?.mailbox,
    query: options?.query,
    signal: options?.signal,
    maxResults: 1,
  });

  return result.resultSizeEstimate;
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

      await sleep(getRetryDelayMs(attempt, error.retryAfterMs), signal);
    }
  }
};

export const getGmailMessageSender = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
) => getHeader(await getGmailMessageMetadata(accessToken, messageId, signal), "From");

const getGmailMessagesMetadataBatch = async (
  accessToken: string,
  messageIds: readonly string[],
  signal?: AbortSignal,
  attempt = 0,
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

  const partsById = new Map(
    parts.map((part, index) => [part.contentId ?? `message-${index}`, part]),
  );
  const results: Array<GmailMessage | null> = [];
  const retryIndexes: number[] = [];
  for (const [index] of messageIds.entries()) {
    const part = partsById.get(`message-${index}`);
    if (!part) throw new Error("Gmail batch response omitted a requested message.");
    if (part.status === 404) {
      results.push(null);
      continue;
    }

    if (part.status < 200 || part.status >= 300) {
      if ((part.status === 429 || part.status === 503) && attempt === 0 && !signal?.aborted) {
        retryIndexes.push(index);
        results.push(null);
        continue;
      }
      const error = new Error(
        part.body || `Gmail batch subrequest failed with status ${part.status}.`,
      ) as Error & { status: number };
      error.status = part.status;
      throw error;
    }

    const parsed = part.body.trim() ? JSON.parse(part.body) : {};
    results.push(gmailMessageSchema.parse(parsed));
  }
  if (retryIndexes.length > 0) {
    await sleep(1000 + Math.floor(Math.random() * 100), signal);
    const retried = await getGmailMessagesMetadataBatch(
      accessToken,
      retryIndexes.map((index) => messageIds[index]!),
      signal,
      attempt + 1,
    );
    retryIndexes.forEach((resultIndex, retryIndex) => {
      results[resultIndex] = retried[retryIndex] ?? null;
    });
  }
  return results;
};

export const watchGmailMailbox = async (
  accessToken: string,
  topicName: string,
  signal?: AbortSignal,
): Promise<GmailWatch> => {
  const response = await requestGmail(accessToken, "/gmail/v1/users/me/watch", gmailWatchSchema, {
    method: "POST",
    body: { topicName },
    signal,
  });

  return {
    expiration: new Date(Number(response.expiration)),
    historyId: response.historyId,
  };
};

export const stopGmailWatch = async (accessToken: string, signal?: AbortSignal): Promise<void> => {
  await requestGmail(accessToken, "/gmail/v1/users/me/stop", z.object({}).passthrough(), {
    method: "POST",
    signal,
  });
};

export const listGmailAddedMessageHistoryPage = async (
  accessToken: string,
  options: {
    maxResults?: number;
    pageToken?: string;
    signal?: AbortSignal;
    startHistoryId: string;
  },
): Promise<GmailAddedMessageHistoryPage> => {
  try {
    const response = await requestGmail(
      accessToken,
      "/gmail/v1/users/me/history",
      listHistorySchema,
      {
        query: {
          fields: "history(id,messagesAdded(message(id,threadId))),historyId,nextPageToken",
          historyTypes: ["messageAdded"],
          maxResults: options.maxResults ?? 25,
          pageToken: options.pageToken,
          startHistoryId: options.startHistoryId,
        },
        signal: options.signal,
      },
    );
    const history = response.history ?? [];
    const messageIds = Array.from(
      new Set(
        history.flatMap((record) => (record.messagesAdded ?? []).map((entry) => entry.message.id)),
      ),
    );

    return {
      hasMore: !!response.nextPageToken,
      historyExpired: false,
      historyId: response.historyId ?? options.startHistoryId,
      messageIds,
      nextPageToken: response.nextPageToken,
    };
  } catch (error) {
    if (isErrorWithStatus(error) && error.status === 404) {
      return {
        hasMore: false,
        historyExpired: true,
        historyId: options.startHistoryId,
        messageIds: [],
      };
    }

    throw error;
  }
};

const getGmailMessagesMetadata = async (
  accessToken: string,
  messageIds: readonly string[],
  signal?: AbortSignal,
) => {
  const messages: Array<GmailMessage | null> = [];

  for (const batchMessageIds of chunkArray(messageIds, GMAIL_BATCH_MESSAGE_CHUNK_SIZE)) {
    messages.push(...(await getGmailMessagesMetadataBatch(accessToken, batchMessageIds, signal)));
  }

  return messages;
};

const getGmailThreadsListMetadataBatch = async (
  accessToken: string,
  threadIds: readonly string[],
  signal?: AbortSignal,
  attempt = 0,
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

  const partsById = new Map(
    parts.map((part, index) => [part.contentId ?? `thread-${index}`, part]),
  );
  const results: Array<z.infer<typeof gmailThreadSchema> | null> = [];
  const retryIndexes: number[] = [];
  for (const [index] of threadIds.entries()) {
    const part = partsById.get(`thread-${index}`);
    if (!part) throw new Error("Gmail batch response omitted a requested thread.");
    if (part.status === 404) {
      results.push(null);
      continue;
    }

    if (part.status < 200 || part.status >= 300) {
      if ((part.status === 429 || part.status === 503) && attempt === 0 && !signal?.aborted) {
        retryIndexes.push(index);
        results.push(null);
        continue;
      }
      const error = new Error(
        part.body || `Gmail batch subrequest failed with status ${part.status}.`,
      ) as Error & { status: number };
      error.status = part.status;
      throw error;
    }

    const parsed = part.body.trim() ? JSON.parse(part.body) : {};
    results.push(gmailThreadSchema.parse(parsed));
  }
  if (retryIndexes.length > 0) {
    await sleep(1000 + Math.floor(Math.random() * 100), signal);
    const retried = await getGmailThreadsListMetadataBatch(
      accessToken,
      retryIndexes.map((index) => threadIds[index]!),
      signal,
      attempt + 1,
    );
    retryIndexes.forEach((resultIndex, retryIndex) => {
      results[resultIndex] = retried[retryIndex] ?? null;
    });
  }
  return results;
};

const getGmailThreadsListMetadata = async (
  accessToken: string,
  threadIds: readonly string[],
  signal?: AbortSignal,
) => {
  const uniqueThreadIds = Array.from(new Set(threadIds));
  const threads: Array<z.infer<typeof gmailThreadSchema> | null> = [];

  for (const batchThreadIds of chunkArray(uniqueThreadIds, GMAIL_BATCH_MESSAGE_CHUNK_SIZE)) {
    threads.push(...(await getGmailThreadsListMetadataBatch(accessToken, batchThreadIds, signal)));
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
  const list = await listThreads(accessToken, options);
  const threads = await getGmailThreadsListMetadata(
    accessToken,
    list.threads.map((thread) => thread.id),
    options?.signal,
  );
  const mailbox = options?.mailbox;
  const rows = threads.flatMap((thread) => {
    if (!thread) return [];
    const messages = (thread.messages ?? []).filter((message) => !hasDraftLabel(message.labelIds));
    const matchingMessages = mailbox
      ? messages.filter((message) =>
          isMessageInMailbox(mailbox, normalizeLabelIds(message.labelIds)),
        )
      : messages;
    const anchor = matchingMessages.reduce<GmailMessage | undefined>(
      (latest, message) =>
        !latest || Number(message.internalDate ?? 0) > Number(latest.internalDate ?? 0)
          ? message
          : latest,
      undefined,
    );
    if (!anchor) return [];
    return [
      {
        anchor,
        summary: {
          attachmentCount: messages.reduce(
            (count, message) => count + extractMessageAttachments(message.payload).length,
            0,
          ),
          messageCount: messages.length,
        },
      },
    ];
  });
  const historyId =
    threads.find((thread) => thread?.historyId)?.historyId ??
    (await getGmailProfile(accessToken, options?.signal)).historyId;

  return {
    messages: await Promise.all(
      rows.map(
        async ({ anchor, summary }) =>
          await toMessageListItem(accessToken, anchor, {
            threadSummary: summary,
          }),
      ),
    ),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
    historyId,
  };
};

/** Live, compact mailbox search for agent tools. Skips thread summaries and avatar lookups. */
export const listMessagesForAgent = async (
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
  const details = await getGmailMessagesMetadata(
    accessToken,
    list.messages.map((message) => message.id),
    options?.signal,
  );
  const messages = details.flatMap((message) => {
    if (!message) return [];

    const labelIds = normalizeLabelIds(message.labelIds);
    if (options?.mailbox && !isMessageInMailbox(options.mailbox, labelIds)) return [];

    return [
      {
        date: getHeader(message, "Date"),
        from: getHeader(message, "From"),
        id: message.id,
        internalDate: message.internalDate,
        isUnread: hasUnreadLabel(labelIds),
        labelIds,
        snippet: decodeMimeHeaderValue(message.snippet),
        subject: getHeader(message, "Subject"),
        threadId: message.threadId,
        to: getHeader(message, "To"),
      },
    ];
  });

  return {
    messages,
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
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
              !!message.messageHeaderId?.trim(),
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
    ).filter((entry): entry is [string, string] => !!entry[1]),
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

export const getMessageWithDetails = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<MessageListItem> => {
  const message = await getGmailMessageMetadata(accessToken, messageId, signal);

  return await toMessageListItem(
    accessToken,
    message,
    { includeAttachmentMetadata: true, includeBody: true },
    signal,
  );
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

export const createLabel = async (
  accessToken: string,
  name: string,
  signal?: AbortSignal,
): Promise<GmailLabelListItem> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/labels", labelMutationSchema, {
    method: "POST",
    body: {
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
      name,
    },
    signal,
  });
};

export const updateLabel = async (
  accessToken: string,
  labelId: string,
  name: string,
  signal?: AbortSignal,
): Promise<GmailLabelListItem> => {
  return await requestGmail(
    accessToken,
    `/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    labelMutationSchema,
    {
      method: "PUT",
      body: {
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        name,
      },
      signal,
    },
  );
};

export const deleteLabel = async (
  accessToken: string,
  labelId: string,
  signal?: AbortSignal,
): Promise<{ id: string }> => {
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    z.object({}).passthrough(),
    {
      method: "DELETE",
      signal,
    },
  );

  return { id: labelId };
};

export const getMailboxSyncDelta = async (
  accessToken: string,
  options: {
    mailbox: MailboxCategory;
    startHistoryId: string;
    signal?: AbortSignal;
  },
): Promise<MailboxSyncDelta> => {
  const mailboxLabel = options.mailbox === "archive" ? undefined : MAILBOX_LABELS[options.mailbox];
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

          if (mailboxLabel && labelIds?.includes(mailboxLabel)) {
            removedMessageIds.delete(labelsAdded.message.id);
            mailboxAdditionCandidateIds.add(labelsAdded.message.id);
            refreshFirstPage = true;
          }
        }

        for (const labelsRemoved of historyRecord.labelsRemoved ?? []) {
          const labelIds = normalizeLabelIds(labelsRemoved.labelIds);
          if (mailboxLabel && labelIds?.includes(mailboxLabel)) {
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

      if (!isMessageInMailbox(options.mailbox, normalizeLabelIds(changedMessage.labelIds))) {
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

export const batchModifyMessages = async (
  accessToken: string,
  messageIds: readonly string[],
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal,
) => {
  const ids = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  for (const chunk of chunkArray(ids, 1000)) {
    await requestGmail(
      accessToken,
      "/gmail/v1/users/me/messages/batchModify",
      z.object({}).passthrough(),
      {
        method: "POST",
        body: { ids: chunk, ...changes },
        signal,
      },
    );
  }
  return { ids };
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
  threadId?: string,
  signal?: AbortSignal,
): Promise<GmailMessage> => {
  return await requestGmail(accessToken, "/gmail/v1/users/me/messages/send", gmailMessageSchema, {
    method: "POST",
    body: {
      raw,
      ...(threadId ? { threadId } : {}),
    },
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
