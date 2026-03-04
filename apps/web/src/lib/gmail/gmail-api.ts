import { z } from "zod";
import {
  createGoogleApiClient,
  defineGoogleApiEndpoint,
  type GoogleApiEndpoint,
  type GoogleApiRequestOptions,
} from "../google-api/client";

const listMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      threadId: z.string(),
    }),
  ),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

const headerSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const messagePartBodySchema = z.object({
  attachmentId: z.string().optional(),
  size: z.number().optional(),
  data: z.string().optional(),
});

type RecursiveMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: RecursiveMessagePart[];
};

const gmailMessagePartSchema: z.ZodType<RecursiveMessagePart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: messagePartBodySchema.optional(),
    parts: z.array(gmailMessagePartSchema).optional(),
  }),
);

const classificationLabelFieldValueSchema = z.object({
  fieldId: z.string(),
  selection: z.string().optional(),
});

const classificationLabelValueSchema = z.object({
  labelId: z.string(),
  fields: z.array(classificationLabelFieldValueSchema).optional(),
});

const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  historyId: z.string().optional(),
  internalDate: z.string().optional(),
  payload: gmailMessagePartSchema.optional(),
  sizeEstimate: z.number().optional(),
  raw: z.string().optional(),
  classificationLabelValues: z.array(classificationLabelValueSchema).optional(),
});

const gmailThreadSchema = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  snippet: z.string().optional(),
  messages: z.array(gmailMessageSchema).optional(),
});

export type GmailListMessagesResponse = z.infer<typeof listMessagesResponseSchema>;
export type GmailMessage = z.infer<typeof gmailMessageSchema>;
export type GmailMessagePart = GmailMessage["payload"];
export type GmailThread = z.infer<typeof gmailThreadSchema>;

const gmailClient = createGoogleApiClient({
  baseUrl: "https://gmail.googleapis.com",
  providerId: "google",
});

type GmailRequestOptions = GoogleApiRequestOptions;

const requestGmailEndpoint = async <TParams, TResponseSchema extends z.ZodTypeAny>(
  endpoint: GoogleApiEndpoint<TParams, TResponseSchema>,
  params: TParams,
  options?: GmailRequestOptions,
): Promise<z.infer<TResponseSchema>> => {
  return await gmailClient.request({
    path: endpoint.path(params),
    responseSchema: endpoint.responseSchema,
    method: endpoint.method,
    query: endpoint.query?.(params),
    headers: endpoint.headers?.(params),
    body: endpoint.body?.(params) ?? undefined,
    cache: endpoint.cache,
    accessToken: options?.accessToken,
    signal: options?.signal,
  });
};

const listMessagesEndpoint = defineGoogleApiEndpoint<
  {
    maxResults: number;
    pageToken?: string;
    labelIds?: string[];
    includeSpamTrash?: boolean;
  },
  typeof listMessagesResponseSchema
>({
  path: () => "/gmail/v1/users/me/messages",
  responseSchema: listMessagesResponseSchema,
  query: (params) => ({
    maxResults: params.maxResults,
    pageToken: params.pageToken,
    labelIds: params.labelIds,
    includeSpamTrash: params.includeSpamTrash,
  }),
});

const getMessageEndpoint = defineGoogleApiEndpoint<
  {
    messageId: string;
    format?: string;
    metadataHeaders?: string[];
  },
  typeof gmailMessageSchema
>({
  path: (params) => `/gmail/v1/users/me/messages/${encodeURIComponent(params.messageId)}`,
  responseSchema: gmailMessageSchema,
  query: (params) => ({
    format: params.format,
    metadataHeaders: params.metadataHeaders,
  }),
});

const getThreadEndpoint = defineGoogleApiEndpoint<
  {
    threadId: string;
    format?: string;
  },
  typeof gmailThreadSchema
>({
  path: (params) => `/gmail/v1/users/me/threads/${encodeURIComponent(params.threadId)}`,
  responseSchema: gmailThreadSchema,
  query: (params) => ({
    format: params.format,
  }),
});

const modifyMessageEndpoint = defineGoogleApiEndpoint<
  {
    messageId: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  },
  typeof gmailMessageSchema
>({
  path: (params) => `/gmail/v1/users/me/messages/${encodeURIComponent(params.messageId)}/modify`,
  responseSchema: gmailMessageSchema,
  method: "POST",
  body: (params) => ({
    addLabelIds: params.addLabelIds,
    removeLabelIds: params.removeLabelIds,
  }),
});

export const gmailApi = {
  listMessages: async (
    params?: {
      maxResults?: number;
      pageToken?: string;
      labelIds?: string[];
      includeSpamTrash?: boolean;
    },
    options?: GmailRequestOptions,
  ) => {
    return await requestGmailEndpoint(
      listMessagesEndpoint,
      {
        maxResults: params?.maxResults ?? 20,
        pageToken: params?.pageToken,
        labelIds: params?.labelIds,
        includeSpamTrash: params?.includeSpamTrash,
      },
      options,
    );
  },
  getMessage: async (
    messageId: string,
    params?: {
      format?: string;
      metadataHeaders?: string[];
    },
    options?: GmailRequestOptions,
  ) => {
    return await requestGmailEndpoint(
      getMessageEndpoint,
      {
        messageId,
        format: params?.format,
        metadataHeaders: params?.metadataHeaders,
      },
      options,
    );
  },
  getThread: async (
    threadId: string,
    params?: {
      format?: string;
    },
    options?: GmailRequestOptions,
  ) => {
    return await requestGmailEndpoint(
      getThreadEndpoint,
      {
        threadId,
        format: params?.format,
      },
      options,
    );
  },
  modifyMessage: async (
    messageId: string,
    params?: {
      addLabelIds?: string[];
      removeLabelIds?: string[];
    },
    options?: GmailRequestOptions,
  ) => {
    return await requestGmailEndpoint(
      modifyMessageEndpoint,
      {
        messageId,
        addLabelIds: params?.addLabelIds,
        removeLabelIds: params?.removeLabelIds,
      },
      options,
    );
  },
};
