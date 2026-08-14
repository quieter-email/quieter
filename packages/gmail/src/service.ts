import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import type { ComposeDraftAnchor } from "@quieter/mail/compose/schema";
import type { MailCategory as MailboxCategory } from "@quieter/mail/data-plane";
import {
  decodePartBody,
  decodeMimeHeaderValue,
  extractMessageAttachments,
  extractMessageContent,
  findRenderablePart,
} from "@quieter/mail/message-content";
import {
  parseStructuredSearchQuery,
  serializeStructuredSearchState,
} from "@quieter/mail/search";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { z } from "zod";

export const MAILBOX_LABELS = {
  archive: "ARCHIVE",
  drafts: "DRAFT",
  inbox: "INBOX",
  sent: "SENT",
  spam: "SPAM",
  trash: "TRASH",
  unread: "UNREAD",
} as const;

export type { MailCategory as MailboxCategory } from "@quieter/mail/data-plane";

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
    body: z
      .object({
        attachmentId: z.string().optional(),
        data: z.string().optional(),
        size: z.number().optional(),
      })
      .optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    mimeType: z.string().optional(),
    partId: z.string().optional(),
    parts: z.array(messagePartSchema).optional(),
  })
);

const gmailMessageSchema = z.object({
  historyId: z.string().optional(),
  id: z.string(),
  internalDate: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  payload: messagePartSchema.optional(),
  raw: z.string().optional(),
  snippet: z.string().optional(),
  threadId: z.string(),
});

const gmailMessageMutationSchema = z.object({
  historyId: z.string().optional(),
  id: z.string(),
  labelIds: z.array(z.string()).optional(),
});

const gmailThreadSchema = z.object({
  historyId: z.string().optional(),
  id: z.string(),
  messages: z.array(gmailMessageSchema).optional(),
  snippet: z.string().optional(),
});

const gmailThreadMutationSchema = z.object({
  historyId: z.string().optional(),
  id: z.string(),
  messages: z.array(gmailMessageMutationSchema).optional(),
});

const gmailDraftSchema = z.object({
  id: z.string(),
  message: gmailMessageSchema.optional(),
});

const gmailAttachmentSchema = z.object({
  attachmentId: z.string().optional(),
  data: z.string().optional(),
  size: z.number().optional(),
});

const gmailApiErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    errors: z
      .array(
        z.object({
          domain: z.string().optional(),
          location: z.string().optional(),
          locationType: z.string().optional(),
          message: z.string().optional(),
          reason: z.string().optional(),
        })
      )
      .optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  }),
});

const gmailLabelSchema = z.object({
  id: z.string(),
  labelListVisibility: z.string().optional(),
  messageListVisibility: z.string().optional(),
  name: z.string(),
  type: z.string().optional(),
});

const gmailProfileSchema = z.object({
  emailAddress: z.string(),
  historyId: z.string().optional(),
  messagesTotal: z.number().optional(),
  threadsTotal: z.number().optional(),
});

const gmailWatchSchema = z.object({
  expiration: z.string(),
  historyId: z.string(),
});

const listMessagesSchema = z.object({
  messages: z
    .array(z.object({ id: z.string(), threadId: z.string() }))
    .default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

const listThreadsSchema = z.object({
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
  threads: z
    .array(z.object({ historyId: z.string().optional(), id: z.string() }))
    .default([]),
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
      })
    )
    .default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

const listLabelsSchema = z.object({
  labels: z.array(gmailLabelSchema).optional(),
});

const labelMutationSchema = gmailLabelSchema;

const emptyGmailResponseSchema = z.object({}).loose();

const gmailHistoryMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

const gmailHistoryRecordSchema = z.object({
  id: z.string().optional(),
  labelsAdded: z
    .array(
      z.object({
        labelIds: z.array(z.string()).optional(),
        message: gmailHistoryMessageSchema,
      })
    )
    .optional(),
  labelsRemoved: z
    .array(
      z.object({
        labelIds: z.array(z.string()).optional(),
        message: gmailHistoryMessageSchema,
      })
    )
    .optional(),
  messagesAdded: z
    .array(
      z.object({
        message: gmailHistoryMessageSchema,
      })
    )
    .optional(),
  messagesDeleted: z
    .array(
      z.object({
        message: gmailHistoryMessageSchema,
      })
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
  threadLabelIds?: string[];
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
export {
  decodeMimeHeaderValue,
  extractMessageContent,
} from "@quieter/mail/message-content";

type ThreadListSummary = {
  labelIds: string[];
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
const GMAIL_MESSAGE_LIST_FIELDS =
  "messages(id,threadId),nextPageToken,resultSizeEstimate";
const GMAIL_THREAD_LIST_FIELDS =
  "threads(id,historyId),nextPageToken,resultSizeEstimate";
const GMAIL_DRAFT_LIST_FIELDS =
  "drafts(id,message(id,threadId)),nextPageToken,resultSizeEstimate";
const GMAIL_LABEL_LIST_FIELDS =
  "labels(id,name,type,labelListVisibility,messageListVisibility)";
const GMAIL_PROFILE_FIELDS =
  "emailAddress,historyId,messagesTotal,threadsTotal";
const GMAIL_HISTORY_FIELDS =
  "history(messagesAdded(message(id,threadId)),messagesDeleted(message(id,threadId)),labelsAdded(message(id,threadId),labelIds),labelsRemoved(message(id,threadId),labelIds)),historyId,nextPageToken";

const normalizeLabelIds = (
  labelIds: string[] | undefined
): string[] | undefined => {
  if (labelIds === undefined || labelIds.length === 0) {
    return undefined;
  }

  const normalized = [
    ...new Set(labelIds.map((labelId) => labelId.trim()).filter(Boolean)),
  ];
  return normalized.length > 0 ? normalized : undefined;
};

const hasUnreadLabel = (labelIds: string[] | undefined): boolean =>
  labelIds !== undefined && labelIds.includes(GMAIL_UNREAD_LABEL);

const hasDraftLabel = (labelIds: string[] | undefined): boolean =>
  labelIds !== undefined && labelIds.includes(MAILBOX_LABELS.drafts);

export const isGmailMessageArchived = (
  labelIds: readonly string[] | undefined
): boolean =>
  labelIds !== undefined &&
  labelIds.length > 0 &&
  ![
    MAILBOX_LABELS.inbox,
    MAILBOX_LABELS.sent,
    MAILBOX_LABELS.drafts,
    MAILBOX_LABELS.spam,
    MAILBOX_LABELS.trash,
  ].some((labelId) => labelIds.includes(labelId));

const isMessageInMailbox = (
  mailbox: MailboxCategory,
  labelIds: string[] | undefined
): boolean => {
  if (mailbox === "archive") {
    return isGmailMessageArchived(labelIds);
  }
  if (labelIds === undefined || !labelIds.includes(MAILBOX_LABELS[mailbox])) {
    return false;
  }
  if (mailbox === "trash") {
    return true;
  }
  if (labelIds.includes(MAILBOX_LABELS.trash)) {
    return false;
  }
  if (mailbox !== "spam" && labelIds.includes(MAILBOX_LABELS.spam)) {
    return false;
  }
  return true;
};

const isNonEmptyString = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

const parseBatchJsonBody = (body: string): unknown =>
  body.trim() === "" ? {} : JSON.parse(body);

const createServiceError = (
  message: string,
  status: number,
  extras?: {
    googleReason?: string;
    googleStatus?: string;
    retryAfterMs?: number;
  }
): GmailServiceError =>
  Object.assign(new Error(message), { status, ...extras });

const createBatchSubrequestError = (
  body: string,
  status: number
): GmailServiceError =>
  createServiceError(
    body.trim() === ""
      ? `Gmail batch subrequest failed with status ${status}.`
      : body,
    status
  );

const appendGmailQueryTerms = (
  query: string | undefined,
  terms: readonly string[]
): string | undefined => {
  const normalizedQuery = query?.trim();
  const existingTerms = isNonEmptyString(normalizedQuery)
    ? new Set(normalizedQuery.split(/\s+/u))
    : new Set<string>();
  const missingTerms = terms.filter((term) => !existingTerms.has(term));
  const combined = [normalizedQuery, ...missingTerms]
    .filter((term) => term !== undefined && term !== "")
    .join(" ");
  return combined === "" ? undefined : combined;
};

const getListMessagesQuery = (
  mailbox: MailboxCategory | undefined,
  query: string | undefined
): string | undefined => {
  if (mailbox === "unread") {
    return appendGmailQueryTerms(query, ["-in:spam", "-in:trash"]);
  }
  if (mailbox === "archive") {
    return appendGmailQueryTerms(query, [
      "-in:inbox",
      "-in:sent",
      "-label:drafts",
      "-in:spam",
      "-in:trash",
    ]);
  }
  const trimmedQuery = query?.trim();
  return trimmedQuery === undefined || trimmedQuery === ""
    ? undefined
    : trimmedQuery;
};

const compileGmailSearchQuery = (
  mailbox: MailboxCategory | undefined,
  query: string | undefined
) => {
  const parsed = parseStructuredSearchQuery(query ?? "");
  const archived = parsed.filters.some(
    (filter) =>
      filter.negated !== true &&
      filter.type === "is" &&
      filter.value.toLowerCase() === "archived"
  );
  const notArchived = parsed.filters.some(
    (filter) =>
      filter.negated === true &&
      filter.type === "is" &&
      filter.value.toLowerCase() === "archived"
  );
  const providerQuery = serializeStructuredSearchState({
    ...parsed,
    filters: parsed.filters.filter(
      (filter) =>
        !(filter.type === "is" && filter.value.toLowerCase() === "archived")
    ),
  });
  const archiveQuery = archived
    ? appendGmailQueryTerms(providerQuery, [
        "-in:inbox",
        "-in:sent",
        "-label:drafts",
        "-in:spam",
        "-in:trash",
      ])
    : providerQuery;
  return getListMessagesQuery(
    mailbox,
    notArchived
      ? appendGmailQueryTerms(archiveQuery, [
          "{in:inbox in:sent label:drafts in:spam in:trash}",
        ])
      : archiveQuery
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

  if (
    details.googleReason !== undefined &&
    details.googleReason !== "" &&
    GMAIL_RATE_LIMIT_REASONS.has(details.googleReason)
  ) {
    return true;
  }

  if (details.googleStatus === "RESOURCE_EXHAUSTED") {
    return true;
  }

  const normalizedMessage = details.message?.trim().toLowerCase();
  if (normalizedMessage === undefined || normalizedMessage === "") {
    return false;
  }
  return (
    normalizedMessage.includes("quota exceeded") ||
    normalizedMessage.includes("rate limit exceeded") ||
    normalizedMessage.includes("resource exhausted")
  );
};

const toAbortError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error("Aborted", { cause: reason });

const buildGoogleApiErrorMessage = (
  googleReason: string | undefined,
  googleMessage: string | undefined,
  body: string,
  status: number
): string => {
  if (
    googleReason === "invalidargument" &&
    googleMessage === "Invalid To header"
  ) {
    return "Check the To field. One or more recipient addresses are invalid.";
  }
  if (
    googleReason === "invalidargument" &&
    googleMessage === "Invalid Cc header"
  ) {
    return "Check the Cc field. One or more recipient addresses are invalid.";
  }
  if (
    googleReason === "invalidargument" &&
    googleMessage === "Invalid Bcc header"
  ) {
    return "Check the Bcc field. One or more recipient addresses are invalid.";
  }
  if (isNonEmptyString(googleMessage)) {
    return googleMessage;
  }
  if (body.trim() !== "") {
    return body;
  }
  return `Google API request failed with status ${status}.`;
};

const parseGoogleApiErrorBody = (body: string) => {
  if (body.trim() === "") {
    return null;
  }

  try {
    const json: unknown = JSON.parse(body);
    return gmailApiErrorSchema.parse(json);
  } catch {
    return null;
  }
};

const applyRetryAfterHeader = (
  error: GmailServiceError,
  response: Response
): void => {
  const retryAfterHeader = response.headers.get("retry-after");
  if (!isNonEmptyString(retryAfterHeader)) {
    return;
  }

  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    error.retryAfterMs = retryAfterSeconds * 1000;
  }
};

const createGoogleApiError = async (
  response: Response
): Promise<GmailServiceError> => {
  const body = await response.text().catch(() => "");
  const parsedBody = parseGoogleApiErrorBody(body);
  const googleMessage = parsedBody?.error.message?.trim();
  const googleStatus = parsedBody?.error.status?.trim().toUpperCase();
  const googleReason = parsedBody?.error.errors?.[0]?.reason
    ?.trim()
    .toLowerCase();
  const message = buildGoogleApiErrorMessage(
    googleReason,
    googleMessage,
    body,
    response.status
  );
  const error = createServiceError(message, response.status, {
    googleReason,
    googleStatus,
  });
  applyRetryAfterHeader(error, response);
  if (
    error.retryAfterMs === undefined &&
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

export const isGmailServiceError = (
  error: unknown
): error is GmailServiceError => isErrorWithStatus(error);

export const isGmailRateLimitedError = (
  error: unknown
): error is GmailServiceError =>
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

const sleep = async (
  durationMs: number,
  signal?: AbortSignal
): Promise<void> => {
  if (signal?.aborted === true) {
    throw toAbortError(signal.reason);
  }

  const wait = Promise.withResolvers<true>();
  const timer: {
    id?: ReturnType<typeof globalThis.setTimeout>;
  } = {};
  const onAbort = () => {
    if (timer.id !== undefined) {
      globalThis.clearTimeout(timer.id);
    }
    signal?.removeEventListener("abort", onAbort);
    wait.reject(toAbortError(signal?.reason));
  };

  timer.id = globalThis.setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    wait.resolve(true);
  }, durationMs);

  signal?.addEventListener("abort", onAbort, { once: true });
  await wait.promise;
};

const getRetryDelayMs = (attempt: number, retryAfterMs?: number) => {
  if (retryAfterMs !== undefined && retryAfterMs !== null) {
    return retryAfterMs;
  }

  const backoffMs = GMAIL_METADATA_RETRY_BASE_DELAY_MS * 2 ** attempt;
  return backoffMs + Math.floor(Math.random() * 100);
};

type GmailRequestQuery = Record<
  string,
  string | number | boolean | undefined | string[] | readonly string[]
>;

const appendQueryParameters = (
  searchParams: URLSearchParams,
  query: GmailRequestQuery = {}
) => {
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined || value === null) {
        continue;
      }
      searchParams.append(key, String(value));
    }
  }
};

const buildGmailPathWithQuery = (path: string, query?: GmailRequestQuery) => {
  const url = new URL(`https://gmail.googleapis.com${path}`);
  appendQueryParameters(url.searchParams, query);
  return `${url.pathname}${url.search}`;
};

const chunkArray = <TValue>(
  items: readonly TValue[],
  size: number
): TValue[][] => {
  if (items.length === 0) {
    return [];
  }

  const chunks: TValue[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const buildBatchPart = (boundary: string, id: string, pathWithQuery: string) =>
  [
    `--${boundary}`,
    "Content-Type: application/http",
    `Content-ID: <${id}>`,
    "",
    `GET ${pathWithQuery} HTTP/1.1`,
    "",
    "",
  ].join("\r\n");

const parseBatchResponseParts = (response: Response, text: string) => {
  const contentType = response.headers.get("content-type") ?? "";
  const boundaryMatch = /boundary="?(?<boundary>[^";]+)"?/iu.exec(contentType);
  const boundary = boundaryMatch?.groups?.boundary?.trim();

  if (boundary === undefined || boundary === "") {
    throw new Error(
      "Gmail batch response did not include a multipart boundary."
    );
  }

  return text
    .split(`--${boundary}`)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "--")
    .map((part) => {
      const normalizedPart = part.replaceAll("\r\n", "\n");
      const nestedResponseIndex = normalizedPart.indexOf("\n\n");
      const outerHeaders =
        nestedResponseIndex === -1
          ? ""
          : normalizedPart.slice(0, nestedResponseIndex);
      const contentId =
        /^content-id:\s*<?(?:response-)?(?<contentId>[^>\s]+)>?$/imu
          .exec(outerHeaders)
          ?.groups?.contentId?.trim();
      const nestedResponse =
        nestedResponseIndex === -1
          ? normalizedPart
          : normalizedPart.slice(nestedResponseIndex + 2);

      const nestedHeadersIndex = nestedResponse.indexOf("\n\n");
      const responseHead =
        nestedHeadersIndex === -1
          ? nestedResponse.trim()
          : nestedResponse.slice(0, nestedHeadersIndex).trim();
      const responseBody =
        nestedHeadersIndex === -1
          ? ""
          : nestedResponse.slice(nestedHeadersIndex + 2).trim();

      const [statusLine] = responseHead.split("\n");
      const statusMatch = /^HTTP\/\d+(?:\.\d+)?\s+(?<status>\d{3})/u.exec(
        statusLine
      );
      const statusCode = statusMatch?.groups?.status;
      const status =
        statusCode !== undefined && statusCode !== ""
          ? Number(statusCode)
          : Number.NaN;

      if (!Number.isFinite(status)) {
        throw new TypeError(
          "Gmail batch response part did not include a valid HTTP status."
        );
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
  }
): Promise<T> => {
  const url = new URL(`https://gmail.googleapis.com${path}`);
  appendQueryParameters(url.searchParams, options?.query);

  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
  });

  let body: string | undefined;
  if (options?.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url.toString(), {
    body,
    cache: "no-store",
    headers,
    method: options?.method ?? "GET",
    signal: options?.signal,
  });

  if (!response.ok) {
    throw await createGoogleApiError(response);
  }

  const text = await response.text();
  const trimmed = text.trim();
  const parsed: unknown = trimmed === "" ? {} : JSON.parse(trimmed);
  return schema.parse(parsed);
};

const getHeader = (message: GmailMessage, name: string): string | undefined => {
  const headers = message.payload?.headers;
  return decodeMimeHeaderValue(
    headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value
  );
};

const decodeBase64UrlToBytes = (value: string) => {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.codePointAt(0) ?? 0);
};

const decodeRawMessageText = (raw: string | undefined): string | undefined => {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  return new TextDecoder().decode(decodeBase64UrlToBytes(raw));
};

export const extractListUnsubscribeTargets = (value: string | undefined) => {
  const normalized = decodeMimeHeaderValue(value)?.trim();
  let mailto: string | undefined;
  let url: string | undefined;

  for (const candidate of normalized
    ?.match(/<[^>]+>|[^,]+/gu)
    ?.map((entry) => entry.trim().replaceAll(/^<|>$/gu, "").trim())
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

      if (mailto === undefined && parsedUrl.protocol === "mailto:") {
        const pathname = decodeURIComponent(parsedUrl.pathname).trim();
        const queryTo = parsedUrl.searchParams.get("to")?.trim();

        if (pathname !== "" || (queryTo !== undefined && queryTo !== "")) {
          mailto = candidate;
        }
      }

      if (
        url === undefined &&
        (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
      ) {
        url = candidate;
      }
    } catch {
      continue;
    }
  }

  return { mailto, url };
};

export const getMessageAttachment = async (
  accessToken: string,
  messageId: string,
  attachmentId: string,
  signal?: AbortSignal
): Promise<GmailAttachment> =>
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    gmailAttachmentSchema,
    { signal }
  );

const resolveRenderablePartBody = async (
  accessToken: string,
  message: GmailMessage,
  mimeType: "text/html" | "text/plain",
  signal?: AbortSignal
): Promise<string | undefined> => {
  const renderablePart = findRenderablePart(message.payload, mimeType);
  if (renderablePart === undefined) {
    return undefined;
  }

  const inlineData = renderablePart.body?.data;
  if (inlineData !== undefined && inlineData !== "") {
    return decodePartBody(renderablePart);
  }

  const attachmentId = renderablePart.body?.attachmentId?.trim();
  if (attachmentId === undefined || attachmentId === "") {
    return undefined;
  }

  const attachment = await getMessageAttachment(
    accessToken,
    message.id,
    attachmentId,
    signal
  );
  const attachmentData = attachment.data;
  if (attachmentData === undefined || attachmentData === "") {
    return undefined;
  }

  return decodePartBody({
    ...renderablePart,
    body: {
      ...renderablePart.body,
      data: attachmentData,
    },
  });
};

const resolveMessageContent = async (
  accessToken: string,
  message: GmailMessage,
  signal?: AbortSignal
) => {
  const inlineContent = extractMessageContent(message.payload);
  const [html, text] = await Promise.all([
    inlineContent.html !== undefined && inlineContent.html !== ""
      ? Promise.resolve(inlineContent.html)
      : resolveRenderablePartBody(accessToken, message, "text/html", signal),
    inlineContent.text !== undefined && inlineContent.text !== ""
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
  signal?: AbortSignal
): Promise<MessageListItem> => {
  const includeBody = options.includeBody ?? false;
  const labelIds = normalizeLabelIds(message.labelIds);
  const content = includeBody
    ? await resolveMessageContent(accessToken, message, signal)
    : { html: undefined, text: undefined };
  const from = getHeader(message, "From");
  const unsubscribeTargets = extractListUnsubscribeTargets(
    getHeader(message, "List-Unsubscribe")
  );

  return {
    attachments:
      includeBody || options.includeAttachmentMetadata === true
        ? extractMessageAttachments(message.payload)
        : undefined,
    bcc: getHeader(message, "Bcc"),
    bodyHtml: content.html,
    bodyText: content.text,
    cc: getHeader(message, "Cc"),
    date: getHeader(message, "Date"),
    draftAnchor: parseDraftAnchorFromHeaderReader((name) =>
      getHeader(message, name)
    ),
    from,
    id: message.id,
    inReplyTo: getHeader(message, "In-Reply-To"),
    internalDate: message.internalDate,
    isUnread: hasUnreadLabel(labelIds),
    labelIds,
    messageHeaderId: getHeader(message, "Message-ID"),
    references: getHeader(message, "References"),
    replyTo: getHeader(message, "Reply-To"),
    senderAvatarUrls: await getSenderAvatarUrls(from, {
      headers: message.payload?.headers ?? [],
    }),
    snippet: decodeMimeHeaderValue(message.snippet),
    subject: getHeader(message, "Subject"),
    threadAttachmentCount: options.threadSummary?.attachmentCount,
    threadId: message.threadId,
    threadLabelIds: options.threadSummary?.labelIds,
    threadMessageCount: options.threadSummary?.messageCount,
    to: getHeader(message, "To"),
    unsubscribeMailto: unsubscribeTargets.mailto,
    unsubscribeUrl: unsubscribeTargets.url,
  };
};

const getMessageTimestamp = (message: MessageListItem): number => {
  const source = message.internalDate ?? message.date;
  if (source === undefined || source === "") {
    return 0;
  }

  const numeric = Number(source);
  const parsedDate = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(source);
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
  }
) => {
  const includesSpamTrash =
    options?.mailbox === "spam" || options?.mailbox === "trash";

  return await requestGmail(
    accessToken,
    "/gmail/v1/users/me/messages",
    listMessagesSchema,
    {
      query: {
        fields: GMAIL_MESSAGE_LIST_FIELDS,
        includeSpamTrash: includesSpamTrash ? true : undefined,
        labelIds:
          options?.mailbox !== undefined && options.mailbox !== "archive"
            ? [MAILBOX_LABELS[options.mailbox]]
            : undefined,
        maxResults: options?.maxResults ?? 20,
        pageToken: options?.pageToken,
        q: compileGmailSearchQuery(options?.mailbox, options?.query),
      },
      signal: options?.signal,
    }
  );
};

const listThreads = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    mailbox?: MailboxCategory;
    query?: string;
    signal?: AbortSignal;
  }
) => {
  const includesSpamTrash =
    options?.mailbox === "spam" || options?.mailbox === "trash";
  return await requestGmail(
    accessToken,
    "/gmail/v1/users/me/threads",
    listThreadsSchema,
    {
      query: {
        fields: GMAIL_THREAD_LIST_FIELDS,
        includeSpamTrash: includesSpamTrash ? true : undefined,
        labelIds:
          options?.mailbox !== undefined && options.mailbox !== "archive"
            ? [MAILBOX_LABELS[options.mailbox]]
            : undefined,
        maxResults: options?.maxResults ?? 15,
        pageToken: options?.pageToken,
        q: compileGmailSearchQuery(options?.mailbox, options?.query),
      },
      signal: options?.signal,
    }
  );
};

export const listGmailMessageIds = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    mailbox?: MailboxCategory;
    query?: string;
    signal?: AbortSignal;
  }
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
  }
) => {
  if (options?.accurateUpTo !== undefined) {
    const { accurateUpTo, countBy = "messages", ...listOptions } = options;
    const countLimit = Math.max(0, Math.floor(accurateUpTo));

    const countAccurateMessages = async (
      pageToken: string | undefined,
      threadIds: Set<string>,
      messageCount: number,
      resultSizeEstimate: number
    ): Promise<number> => {
      const count = countBy === "threads" ? threadIds.size : messageCount;
      const result = await listMessages(accessToken, {
        ...listOptions,
        maxResults:
          countBy === "threads"
            ? Math.min(500, Math.max(1, countLimit + 1))
            : Math.min(500, Math.max(1, countLimit + 1 - count)),
        pageToken,
      });
      const nextResultSizeEstimate = Math.max(
        resultSizeEstimate,
        result.resultSizeEstimate ?? 0
      );
      const nextMessageCount = messageCount + result.messages.length;
      const nextThreadIds = new Set(threadIds);
      for (const message of result.messages) {
        nextThreadIds.add(message.threadId);
      }
      const nextCount =
        countBy === "threads" ? nextThreadIds.size : nextMessageCount;
      const { nextPageToken } = result;

      if (
        nextPageToken !== undefined &&
        nextPageToken !== "" &&
        nextCount <= countLimit
      ) {
        return await countAccurateMessages(
          nextPageToken,
          nextThreadIds,
          nextMessageCount,
          nextResultSizeEstimate
        );
      }

      if (countBy === "threads") {
        return nextCount;
      }
      return nextPageToken !== undefined && nextPageToken !== ""
        ? Math.max(nextResultSizeEstimate, nextCount)
        : nextCount;
    };

    return await countAccurateMessages(undefined, new Set(), 0, 0);
  }

  const result = await listMessages(accessToken, {
    mailbox: options?.mailbox,
    maxResults: 1,
    query: options?.query,
    signal: options?.signal,
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
  }
) =>
  await requestGmail(
    accessToken,
    "/gmail/v1/users/me/drafts",
    listDraftsSchema,
    {
      query: {
        fields: GMAIL_DRAFT_LIST_FIELDS,
        maxResults: options?.maxResults ?? 20,
        pageToken: options?.pageToken,
        q: (() => {
          const trimmedQuery = options?.query?.trim();
          return trimmedQuery === undefined || trimmedQuery === ""
            ? undefined
            : trimmedQuery;
        })(),
      },
      signal: options?.signal,
    }
  );

const getDraftIdForMessageHeaderId = async (
  accessToken: string,
  messageHeaderId: string,
  threadId: string,
  signal?: AbortSignal
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
  signal?: AbortSignal
): Promise<GmailProfile> =>
  await requestGmail(
    accessToken,
    "/gmail/v1/users/me/profile",
    gmailProfileSchema,
    {
      query: {
        fields: GMAIL_PROFILE_FIELDS,
      },
      signal,
    }
  );

const requestGmailMessageMetadata = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
): Promise<GmailMessage> =>
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
    gmailMessageSchema,
    {
      query: {
        fields: GMAIL_MESSAGE_METADATA_FIELDS,
        format: "full",
      },
      signal,
    }
  );

export const getGmailMessageMetadata = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
): Promise<GmailMessage> => {
  const fetchMetadata = async (attempt: number): Promise<GmailMessage> => {
    try {
      return await requestGmailMessageMetadata(accessToken, messageId, signal);
    } catch (error) {
      const shouldRetry =
        isErrorWithStatus(error) &&
        error.status === 429 &&
        attempt < GMAIL_METADATA_RETRY_LIMIT &&
        !isAborted(signal);

      if (!shouldRetry) {
        throw error;
      }

      await sleep(getRetryDelayMs(attempt, error.retryAfterMs), signal);
      return await fetchMetadata(attempt + 1);
    }
  };

  return await fetchMetadata(0);
};

export const getGmailMessageSender = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
) =>
  getHeader(
    await getGmailMessageMetadata(accessToken, messageId, signal),
    "From"
  );

const getGmailMessagesMetadataBatch = async (
  accessToken: string,
  messageIds: readonly string[],
  signal?: AbortSignal,
  attempt = 0
) => {
  if (messageIds.length === 0) {
    return [];
  }

  const boundary = `batch_${crypto.randomUUID().replaceAll("-", "")}`;
  const body = [
    ...messageIds.map((messageId, index) =>
      buildBatchPart(
        boundary,
        `message-${index}`,
        buildGmailPathWithQuery(
          `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
          {
            fields: GMAIL_MESSAGE_METADATA_FIELDS,
            format: "full",
          }
        )
      )
    ),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
    body,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw await createGoogleApiError(response);
  }

  const text = await response.text();
  const parts = parseBatchResponseParts(response, text);

  if (parts.length !== messageIds.length) {
    throw new Error(
      "Gmail batch response size did not match the requested message count."
    );
  }

  const partsById = new Map(
    parts.map((part, index) => [part.contentId ?? `message-${index}`, part])
  );
  const results: (GmailMessage | null)[] = [];
  const retryIndexes: number[] = [];
  for (const [index] of messageIds.entries()) {
    const part = partsById.get(`message-${index}`);
    if (!part) {
      throw new Error("Gmail batch response omitted a requested message.");
    }
    if (part.status === 404) {
      results.push(null);
      continue;
    }

    if (part.status < 200 || part.status >= 300) {
      if (
        (part.status === 429 || part.status === 503) &&
        attempt === 0 &&
        !isAborted(signal)
      ) {
        retryIndexes.push(index);
        results.push(null);
        continue;
      }
      throw createBatchSubrequestError(part.body, part.status);
    }

    const parsed = parseBatchJsonBody(part.body);
    results.push(gmailMessageSchema.parse(parsed));
  }
  if (retryIndexes.length > 0) {
    await sleep(1000 + Math.floor(Math.random() * 100), signal);
    const retried = await getGmailMessagesMetadataBatch(
      accessToken,
      retryIndexes.map((index) => messageIds[index]),
      signal,
      attempt + 1
    );
    for (const [retryIndex, resultIndex] of retryIndexes.entries()) {
      results[resultIndex] = retried[retryIndex] ?? null;
    }
  }
  return results;
};

export const watchGmailMailbox = async (
  accessToken: string,
  topicName: string,
  signal?: AbortSignal
): Promise<GmailWatch> => {
  const response = await requestGmail(
    accessToken,
    "/gmail/v1/users/me/watch",
    gmailWatchSchema,
    {
      body: { topicName },
      method: "POST",
      signal,
    }
  );

  return {
    expiration: new Date(Number(response.expiration)),
    historyId: response.historyId,
  };
};

export const stopGmailWatch = async (
  accessToken: string,
  signal?: AbortSignal
): Promise<void> => {
  await requestGmail(
    accessToken,
    "/gmail/v1/users/me/stop",
    emptyGmailResponseSchema,
    {
      method: "POST",
      signal,
    }
  );
};

export const listGmailAddedMessageHistoryPage = async (
  accessToken: string,
  options: {
    maxResults?: number;
    pageToken?: string;
    signal?: AbortSignal;
    startHistoryId: string;
  }
): Promise<GmailAddedMessageHistoryPage> => {
  try {
    const response = await requestGmail(
      accessToken,
      "/gmail/v1/users/me/history",
      listHistorySchema,
      {
        query: {
          fields:
            "history(id,messagesAdded(message(id,threadId))),historyId,nextPageToken",
          historyTypes: ["messageAdded"],
          maxResults: options.maxResults ?? 25,
          pageToken: options.pageToken,
          startHistoryId: options.startHistoryId,
        },
        signal: options.signal,
      }
    );
    const history = response.history ?? [];
    const messageIds = [
      ...new Set(
        history.flatMap((record) =>
          (record.messagesAdded ?? []).map((entry) => entry.message.id)
        )
      ),
    ];

    return {
      hasMore: isNonEmptyString(response.nextPageToken),
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
  signal?: AbortSignal
) => {
  const batches = await Promise.all(
    chunkArray(messageIds, GMAIL_BATCH_MESSAGE_CHUNK_SIZE).map(
      async (batchMessageIds) =>
        await getGmailMessagesMetadataBatch(
          accessToken,
          batchMessageIds,
          signal
        )
    )
  );
  return batches.flat();
};

export const getGmailMessageThreadAssociations = async (
  accessToken: string,
  messageIds: readonly string[],
  signal?: AbortSignal
) => {
  const messages = await getGmailMessagesMetadata(
    accessToken,
    messageIds,
    signal
  );
  return messages.flatMap((message) =>
    message === null ? [] : [{ id: message.id, threadId: message.threadId }]
  );
};

const getGmailThreadsListMetadataBatch = async (
  accessToken: string,
  threadIds: readonly string[],
  signal?: AbortSignal,
  attempt = 0
) => {
  if (threadIds.length === 0) {
    return [];
  }

  const boundary = `batch_${crypto.randomUUID().replaceAll("-", "")}`;
  const body = [
    ...threadIds.map((threadId, index) =>
      buildBatchPart(
        boundary,
        `thread-${index}`,
        buildGmailPathWithQuery(
          `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
          {
            fields: GMAIL_THREAD_LIST_METADATA_FIELDS,
            format: "full",
          }
        )
      )
    ),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
    body,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw await createGoogleApiError(response);
  }

  const text = await response.text();
  const parts = parseBatchResponseParts(response, text);

  if (parts.length !== threadIds.length) {
    throw new Error(
      "Gmail batch response size did not match the requested thread count."
    );
  }

  const partsById = new Map(
    parts.map((part, index) => [part.contentId ?? `thread-${index}`, part])
  );
  const results: (z.infer<typeof gmailThreadSchema> | null)[] = [];
  const retryIndexes: number[] = [];
  for (const [index] of threadIds.entries()) {
    const part = partsById.get(`thread-${index}`);
    if (!part) {
      throw new Error("Gmail batch response omitted a requested thread.");
    }
    if (part.status === 404) {
      results.push(null);
      continue;
    }

    if (part.status < 200 || part.status >= 300) {
      if (
        (part.status === 429 || part.status === 503) &&
        attempt === 0 &&
        signal?.aborted !== true
      ) {
        retryIndexes.push(index);
        results.push(null);
        continue;
      }
      throw createBatchSubrequestError(part.body, part.status);
    }

    const parsed = parseBatchJsonBody(part.body);
    results.push(gmailThreadSchema.parse(parsed));
  }
  if (retryIndexes.length > 0) {
    await sleep(1000 + Math.floor(Math.random() * 100), signal);
    const retried = await getGmailThreadsListMetadataBatch(
      accessToken,
      retryIndexes.map((index) => threadIds[index]),
      signal,
      attempt + 1
    );
    for (const [retryIndex, resultIndex] of retryIndexes.entries()) {
      results[resultIndex] = retried[retryIndex] ?? null;
    }
  }
  return results;
};

const getGmailThreadsListMetadata = async (
  accessToken: string,
  threadIds: readonly string[],
  signal?: AbortSignal
) => {
  const uniqueThreadIds = [...new Set(threadIds)];
  const batches = await Promise.all(
    chunkArray(uniqueThreadIds, GMAIL_BATCH_MESSAGE_CHUNK_SIZE).map(
      async (batchThreadIds) =>
        await getGmailThreadsListMetadataBatch(
          accessToken,
          batchThreadIds,
          signal
        )
    )
  );
  return batches.flat();
};

const getThreadListSummaries = async (
  accessToken: string,
  threadIds: readonly string[],
  options?: { includeDrafts?: boolean },
  signal?: AbortSignal
) => {
  const summariesByThreadId = new Map<string, ThreadListSummary>();
  const threads = await getGmailThreadsListMetadata(
    accessToken,
    threadIds,
    signal
  );

  for (const thread of threads) {
    if (!thread) {
      continue;
    }

    const threadMessages = thread.messages ?? [];
    const messages = (thread.messages ?? []).filter(
      (message) =>
        options?.includeDrafts === true || !hasDraftLabel(message.labelIds)
    );
    let attachmentCount = 0;
    for (const message of messages) {
      attachmentCount += extractMessageAttachments(message.payload).length;
    }
    summariesByThreadId.set(thread.id, {
      attachmentCount,
      labelIds: [
        ...new Set(
          threadMessages.flatMap(
            (message) => normalizeLabelIds(message.labelIds) ?? []
          )
        ),
      ],
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
  }
): Promise<ListMessagesPageResult> => {
  const list = await listThreads(accessToken, options);
  const threads = await getGmailThreadsListMetadata(
    accessToken,
    list.threads.map((thread) => thread.id),
    options?.signal
  );
  const mailbox = options?.mailbox;
  const rows = threads.flatMap((thread) => {
    if (!thread) {
      return [];
    }
    const messages = (thread.messages ?? []).filter(
      (message) => !hasDraftLabel(message.labelIds)
    );
    const matchingMessages = mailbox
      ? messages.filter((message) =>
          isMessageInMailbox(mailbox, normalizeLabelIds(message.labelIds))
        )
      : messages;
    let anchor: GmailMessage | undefined;
    for (const message of matchingMessages) {
      if (
        anchor === undefined ||
        Number(message.internalDate ?? 0) > Number(anchor.internalDate ?? 0)
      ) {
        anchor = message;
      }
    }
    if (anchor === undefined) {
      return [];
    }
    let attachmentCount = 0;
    for (const message of messages) {
      attachmentCount += extractMessageAttachments(message.payload).length;
    }
    return [
      {
        anchor,
        summary: {
          attachmentCount,
          labelIds: [
            ...new Set(
              (thread.messages ?? []).flatMap(
                (message) => normalizeLabelIds(message.labelIds) ?? []
              )
            ),
          ],
          messageCount: messages.length,
        },
      },
    ];
  });
  const profile = await getGmailProfile(accessToken, options?.signal);
  const historyId =
    threads.find((thread) => isNonEmptyString(thread?.historyId))?.historyId ??
    profile.historyId;

  return {
    historyId,
    messages: await Promise.all(
      rows.map(
        async ({ anchor, summary }) =>
          await toMessageListItem(accessToken, anchor, {
            threadSummary: summary,
          })
      )
    ),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
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
  }
): Promise<ListMessagesPageResult> => {
  const list = await listMessages(accessToken, options);
  const details = await getGmailMessagesMetadata(
    accessToken,
    list.messages.map((message) => message.id),
    options?.signal
  );
  const messages = details.flatMap((message) => {
    if (!message) {
      return [];
    }

    const labelIds = normalizeLabelIds(message.labelIds);
    if (options?.mailbox && !isMessageInMailbox(options.mailbox, labelIds)) {
      return [];
    }

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

export const getDraft = async (
  accessToken: string,
  draftId: string,
  signal?: AbortSignal
): Promise<GmailDraft> =>
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    gmailDraftSchema,
    {
      query: { format: "full" },
      signal,
    }
  );

export const listDraftsWithDetails = async (
  accessToken: string,
  options?: {
    pageToken?: string;
    maxResults?: number;
    query?: string;
    signal?: AbortSignal;
  }
): Promise<ListMessagesPageResult> => {
  const list = await listDrafts(accessToken, options);
  const draftRefs = list.drafts.flatMap((draft) => {
    const messageId = draft.message?.id;
    const threadId = draft.message?.threadId;
    if (
      messageId === undefined ||
      messageId === "" ||
      threadId === undefined ||
      threadId === ""
    ) {
      return [];
    }

    return [
      {
        draftId: draft.id,
        messageId,
        threadId,
      },
    ];
  });
  const [draftDetails, threadSummariesById] = await Promise.all([
    Promise.all(
      draftRefs.map(async (draft) => {
        try {
          return {
            draft: await getDraft(accessToken, draft.draftId, options?.signal),
            draftId: draft.draftId,
          };
        } catch (error) {
          if (isErrorWithStatus(error) && error.status === 404) {
            return null;
          }

          throw error;
        }
      })
    ),
    getThreadListSummaries(
      accessToken,
      draftRefs.map((draft) => draft.threadId),
      { includeDrafts: true },
      options?.signal
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
          options?.signal
        )),
        draftId: draft.draftId,
      }))
    ),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
  };
};

export const getThreadWithDetails = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal
): Promise<ThreadMessagesResult> => {
  const thread = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
    gmailThreadSchema,
    {
      query: { fields: GMAIL_THREAD_DETAIL_FIELDS, format: "full" },
      signal,
    }
  );

  const messageItems = await Promise.all(
    (thread.messages ?? []).map(
      async (message) =>
        await toMessageListItem(
          accessToken,
          message,
          { includeBody: true },
          signal
        )
    )
  );
  const messages = messageItems.toSorted(
    (left, right) => getMessageTimestamp(left) - getMessageTimestamp(right)
  );
  const draftIdEntries = await Promise.all(
    messages
      .filter((message) => {
        const headerId = message.messageHeaderId?.trim() ?? "";
        return (
          message.labelIds !== undefined &&
          message.labelIds.includes(MAILBOX_LABELS.drafts) &&
          headerId !== ""
        );
      })
      .map(async (message) => {
        const headerId = message.messageHeaderId?.trim() ?? "";
        return [
          message.id,
          await getDraftIdForMessageHeaderId(
            accessToken,
            headerId,
            message.threadId,
            signal
          ),
        ] as const;
      })
  );
  const draftIdsByMessageId = new Map(
    draftIdEntries.filter(
      (entry): entry is [string, string] => (entry[1] ?? "") !== ""
    )
  );

  let subject: string | undefined;
  for (const message of messages) {
    const trimmedSubject = message.subject?.trim() ?? "";
    if (trimmedSubject !== "") {
      ({ subject } = message);
      break;
    }
  }

  const resolvedMessages = messages.map((message) =>
    draftIdsByMessageId.has(message.id)
      ? {
          ...message,
          draftId: draftIdsByMessageId.get(message.id),
        }
      : message
  );
  const threadLabelIds = [
    ...new Set(resolvedMessages.flatMap((message) => message.labelIds ?? [])),
  ];

  return {
    messages: resolvedMessages.map((message) => ({
      ...message,
      threadLabelIds,
    })),
    snippet: decodeMimeHeaderValue(thread.snippet),
    subject,
    threadId: thread.id,
  };
};

export const getMessageWithDetails = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
): Promise<MessageListItem> => {
  const message = await getGmailMessageMetadata(accessToken, messageId, signal);

  return await toMessageListItem(
    accessToken,
    message,
    { includeAttachmentMetadata: true, includeBody: true },
    signal
  );
};

export const getMessageInspector = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
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
    bcc: getHeader(fullMessage, "Bcc"),
    cc: getHeader(fullMessage, "Cc"),
    date: getHeader(fullMessage, "Date"),
    from: getHeader(fullMessage, "From"),
    headers,
    id: fullMessage.id,
    internalDate: fullMessage.internalDate,
    messageHeaderId: getHeader(fullMessage, "Message-ID"),
    payload: fullMessage.payload,
    raw: rawMessage.raw,
    rawText: decodeRawMessageText(rawMessage.raw),
    references: getHeader(fullMessage, "References"),
    replyTo: getHeader(fullMessage, "Reply-To"),
    snippet: decodeMimeHeaderValue(fullMessage.snippet),
    subject: getHeader(fullMessage, "Subject"),
    to: getHeader(fullMessage, "To"),
  };
};

export const listLabels = async (
  accessToken: string,
  signal?: AbortSignal
): Promise<GmailLabelListItem[]> => {
  const response = await requestGmail(
    accessToken,
    "/gmail/v1/users/me/labels",
    listLabelsSchema,
    {
      query: {
        fields: GMAIL_LABEL_LIST_FIELDS,
      },
      signal,
    }
  );

  return [...(response.labels ?? [])].toSorted((left, right) => {
    if (left.type !== right.type) {
      if (left.type === "user") {
        return -1;
      }
      if (right.type === "user") {
        return 1;
      }
    }

    return left.name.localeCompare(right.name);
  });
};

export const createLabel = async (
  accessToken: string,
  name: string,
  signal?: AbortSignal
): Promise<GmailLabelListItem> =>
  await requestGmail(
    accessToken,
    "/gmail/v1/users/me/labels",
    labelMutationSchema,
    {
      body: {
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        name,
      },
      method: "POST",
      signal,
    }
  );

export const updateLabel = async (
  accessToken: string,
  labelId: string,
  name: string,
  signal?: AbortSignal
): Promise<GmailLabelListItem> =>
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    labelMutationSchema,
    {
      body: {
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        name,
      },
      method: "PUT",
      signal,
    }
  );

export const deleteLabel = async (
  accessToken: string,
  labelId: string,
  signal?: AbortSignal
): Promise<{ id: string }> => {
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    emptyGmailResponseSchema,
    {
      method: "DELETE",
      signal,
    }
  );

  return { id: labelId };
};

type MailboxSyncDeltaState = {
  changedMessageIds: Set<string>;
  mailboxAdditionCandidateIds: Set<string>;
  removedMessageIds: Set<string>;
  refreshFirstPage: boolean;
};

const applyHistoryRecordToMailboxSyncDelta = (
  historyRecord: z.infer<typeof gmailHistoryRecordSchema>,
  mailboxLabel: string | undefined,
  state: MailboxSyncDeltaState
) => {
  for (const deleted of historyRecord.messagesDeleted ?? []) {
    state.removedMessageIds.add(deleted.message.id);
    state.changedMessageIds.delete(deleted.message.id);
    state.mailboxAdditionCandidateIds.delete(deleted.message.id);
    state.refreshFirstPage = true;
  }

  for (const labelsAdded of historyRecord.labelsAdded ?? []) {
    const labelIds = normalizeLabelIds(labelsAdded.labelIds);
    state.changedMessageIds.add(labelsAdded.message.id);

    if (
      mailboxLabel !== undefined &&
      labelIds !== undefined &&
      labelIds.includes(mailboxLabel)
    ) {
      state.removedMessageIds.delete(labelsAdded.message.id);
      state.mailboxAdditionCandidateIds.add(labelsAdded.message.id);
      state.refreshFirstPage = true;
    }
  }

  for (const labelsRemoved of historyRecord.labelsRemoved ?? []) {
    const labelIds = normalizeLabelIds(labelsRemoved.labelIds);
    if (
      mailboxLabel !== undefined &&
      labelIds?.includes(mailboxLabel) === true
    ) {
      state.removedMessageIds.add(labelsRemoved.message.id);
      state.changedMessageIds.delete(labelsRemoved.message.id);
      state.mailboxAdditionCandidateIds.delete(labelsRemoved.message.id);
      state.refreshFirstPage = true;
      continue;
    }

    state.changedMessageIds.add(labelsRemoved.message.id);
  }

  for (const added of historyRecord.messagesAdded ?? []) {
    if (state.removedMessageIds.has(added.message.id)) {
      state.removedMessageIds.delete(added.message.id);
    }

    state.changedMessageIds.add(added.message.id);
    state.mailboxAdditionCandidateIds.add(added.message.id);
  }
};

const fetchMailboxHistoryPages = async (
  accessToken: string,
  options: {
    startHistoryId: string;
    signal?: AbortSignal;
  },
  mailboxLabel: string | undefined,
  state: MailboxSyncDeltaState
): Promise<string> => {
  const fetchPage = async (
    pageToken: string | undefined,
    nextHistoryId: string
  ): Promise<string> => {
    const response = await requestGmail(
      accessToken,
      "/gmail/v1/users/me/history",
      listHistorySchema,
      {
        query: {
          fields: GMAIL_HISTORY_FIELDS,
          historyTypes: [
            "messageAdded",
            "messageDeleted",
            "labelAdded",
            "labelRemoved",
          ],
          maxResults: 100,
          pageToken,
          startHistoryId: options.startHistoryId,
        },
        signal: options.signal,
      }
    );

    const historyId = response.historyId ?? nextHistoryId;

    for (const historyRecord of response.history ?? []) {
      applyHistoryRecordToMailboxSyncDelta(historyRecord, mailboxLabel, state);
    }

    const { nextPageToken } = response;
    if ((nextPageToken ?? "") === "") {
      return historyId;
    }

    return await fetchPage(nextPageToken, historyId);
  };

  return await fetchPage(undefined, options.startHistoryId);
};

const buildMailboxSyncUpdatedMessages = async (
  accessToken: string,
  mailbox: MailboxCategory,
  changedMessages: (GmailMessage | null)[],
  mailboxAdditionCandidateIds: Set<string>,
  removedMessageIds: Set<string>,
  signal?: AbortSignal
): Promise<{ messages: MessageListItem[]; refreshFirstPage: boolean }> => {
  let refreshFirstPage = false;
  const inMailboxMessages: GmailMessage[] = [];

  for (const changedMessage of changedMessages) {
    if (changedMessage === null) {
      continue;
    }

    if (
      !isMessageInMailbox(mailbox, normalizeLabelIds(changedMessage.labelIds))
    ) {
      removedMessageIds.add(changedMessage.id);
      continue;
    }

    if (mailboxAdditionCandidateIds.has(changedMessage.id)) {
      refreshFirstPage = true;
    }

    inMailboxMessages.push(changedMessage);
  }

  const updatedMessages = await Promise.all(
    inMailboxMessages.map(
      async (message) => await toMessageListItem(accessToken, message)
    )
  );

  const threadSummariesById = await getThreadListSummaries(
    accessToken,
    updatedMessages.map((message) => message.threadId),
    { includeDrafts: mailbox === "drafts" },
    signal
  );

  return {
    messages: updatedMessages.map((updatedMessage) => {
      const threadSummary = threadSummariesById.get(updatedMessage.threadId);
      if (threadSummary === undefined) {
        return updatedMessage;
      }

      return {
        ...updatedMessage,
        threadAttachmentCount: threadSummary.attachmentCount,
        threadMessageCount: threadSummary.messageCount,
      };
    }),
    refreshFirstPage,
  };
};

export const getMailboxSyncDelta = async (
  accessToken: string,
  options: {
    mailbox: MailboxCategory;
    startHistoryId: string;
    signal?: AbortSignal;
  }
): Promise<MailboxSyncDelta> => {
  const mailboxLabel =
    options.mailbox === "archive" ? undefined : MAILBOX_LABELS[options.mailbox];
  const state: MailboxSyncDeltaState = {
    changedMessageIds: new Set<string>(),
    mailboxAdditionCandidateIds: new Set<string>(),
    refreshFirstPage: false,
    removedMessageIds: new Set<string>(),
  };

  let nextHistoryId = options.startHistoryId;

  try {
    nextHistoryId = await fetchMailboxHistoryPages(
      accessToken,
      {
        signal: options.signal,
        startHistoryId: options.startHistoryId,
      },
      mailboxLabel,
      state
    );
  } catch (error) {
    if (isErrorWithStatus(error) && error.status === 404) {
      return {
        hasChanges: true,
        historyId: undefined,
        refreshFirstPage: false,
        removedMessageIds: [],
        requiresFullRefresh: true,
        updatedMessages: [],
      };
    }

    throw error;
  }

  let updatedMessages: MessageListItem[] = [];

  if (state.changedMessageIds.size > 0) {
    const changedMessages = await getGmailMessagesMetadata(
      accessToken,
      [...state.changedMessageIds],
      options.signal
    );
    const builtMessages = await buildMailboxSyncUpdatedMessages(
      accessToken,
      options.mailbox,
      changedMessages,
      state.mailboxAdditionCandidateIds,
      state.removedMessageIds,
      options.signal
    );
    updatedMessages = builtMessages.messages;
    if (builtMessages.refreshFirstPage) {
      state.refreshFirstPage = true;
    }
  }

  return {
    hasChanges: nextHistoryId !== options.startHistoryId,
    historyId: nextHistoryId,
    refreshFirstPage: state.refreshFirstPage,
    removedMessageIds: [...state.removedMessageIds],
    requiresFullRefresh: false,
    updatedMessages,
  };
};

const toMessageMetadataUpdate = (
  message: z.infer<typeof gmailMessageMutationSchema>
) => {
  const labelIds = normalizeLabelIds(message.labelIds);

  return {
    id: message.id,
    isUnread: hasUnreadLabel(labelIds),
    labelIds,
  };
};

const toThreadMetadataUpdate = (
  thread: z.infer<typeof gmailThreadMutationSchema>
) => ({
  messages: (thread.messages ?? []).map((message) =>
    toMessageMetadataUpdate(message)
  ),
  threadId: thread.id,
});

export const markMessageAsRead = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    gmailMessageMutationSchema,
    {
      body: { removeLabelIds: [GMAIL_UNREAD_LABEL] },
      method: "POST",
      query: {
        fields: "id,labelIds,historyId",
      },
      signal,
    }
  );

  return toMessageMetadataUpdate(updated);
};

export const markMessageAsUnread = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    gmailMessageMutationSchema,
    {
      body: { addLabelIds: [GMAIL_UNREAD_LABEL] },
      method: "POST",
      query: {
        fields: "id,labelIds,historyId",
      },
      signal,
    }
  );

  return toMessageMetadataUpdate(updated);
};

export const markThreadAsRead = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    gmailThreadMutationSchema,
    {
      body: { removeLabelIds: [GMAIL_UNREAD_LABEL] },
      method: "POST",
      query: {
        fields: "id,historyId,messages(id,labelIds,historyId)",
      },
      signal,
    }
  );

  return toThreadMetadataUpdate(updated);
};

export const markThreadAsUnread = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    gmailThreadMutationSchema,
    {
      body: { addLabelIds: [GMAIL_UNREAD_LABEL] },
      method: "POST",
      query: {
        fields: "id,historyId,messages(id,labelIds,historyId)",
      },
      signal,
    }
  );

  return toThreadMetadataUpdate(updated);
};

export const updateThreadLabels = async (
  accessToken: string,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    gmailThreadMutationSchema,
    {
      body: changes,
      method: "POST",
      query: {
        fields: "id,historyId,messages(id,labelIds,historyId)",
      },
      signal,
    }
  );

  return toThreadMetadataUpdate(updated);
};

export const updateMessageLabels = async (
  accessToken: string,
  messageId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal
) => {
  const updated = await requestGmail(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    gmailMessageMutationSchema,
    {
      body: changes,
      method: "POST",
      query: {
        fields: "id,labelIds,historyId",
      },
      signal,
    }
  );

  return toMessageMetadataUpdate(updated);
};

export const batchModifyMessages = async (
  accessToken: string,
  messageIds: readonly string[],
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal
) => {
  const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(
    chunkArray(ids, 1000).map(
      async (chunk) =>
        await requestGmail(
          accessToken,
          "/gmail/v1/users/me/messages/batchModify",
          emptyGmailResponseSchema,
          {
            body: { ids: chunk, ...changes },
            method: "POST",
            signal,
          }
        )
    )
  );
  return { ids };
};

export const moveThreadToTrash = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal
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
    }
  );

  return toThreadMetadataUpdate(updated);
};

export const moveMessageToTrash = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
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
    }
  );

  return toMessageMetadataUpdate(updated);
};

export const untrashMessage = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
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
    }
  );

  return toMessageMetadataUpdate(updated);
};

export const untrashThread = async (
  accessToken: string,
  threadId: string,
  signal?: AbortSignal
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
    }
  );

  return toThreadMetadataUpdate(updated);
};

export const createDraft = async (
  accessToken: string,
  raw: string,
  threadId?: string,
  signal?: AbortSignal
): Promise<GmailDraft> =>
  await requestGmail(
    accessToken,
    "/gmail/v1/users/me/drafts",
    gmailDraftSchema,
    {
      body: {
        message: {
          raw,
          threadId,
        },
      },
      method: "POST",
      signal,
    }
  );

export const updateDraft = async (
  accessToken: string,
  draftId: string,
  raw: string,
  threadId?: string,
  signal?: AbortSignal
): Promise<GmailDraft> =>
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    gmailDraftSchema,
    {
      body: {
        id: draftId,
        message: {
          raw,
          threadId,
        },
      },
      method: "PUT",
      signal,
    }
  );

export const sendDraft = async (
  accessToken: string,
  draftId: string,
  raw?: string,
  threadId?: string,
  signal?: AbortSignal
): Promise<GmailMessage> =>
  await requestGmail(
    accessToken,
    "/gmail/v1/users/me/drafts/send",
    gmailMessageSchema,
    {
      body:
        (raw ?? "") === ""
          ? { id: draftId }
          : {
              id: draftId,
              message: {
                raw,
                threadId,
              },
            },
      method: "POST",
      signal,
    }
  );

export const sendRawMessage = async (
  accessToken: string,
  raw: string,
  threadId?: string,
  signal?: AbortSignal
): Promise<GmailMessage> =>
  await requestGmail(
    accessToken,
    "/gmail/v1/users/me/messages/send",
    gmailMessageSchema,
    {
      body: {
        raw,
        ...((threadId ?? "") === "" ? {} : { threadId }),
      },
      method: "POST",
      signal,
    }
  );

export const deleteDraft = async (
  accessToken: string,
  draftId: string,
  signal?: AbortSignal
): Promise<void> => {
  await requestGmail(
    accessToken,
    `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    emptyGmailResponseSchema,
    {
      method: "DELETE",
      signal,
    }
  );
};
