import { render } from "@react-email/render";
import type { ReactElement } from "react";

import { QuieterApiError } from "./api-error";

export { QuieterApiError } from "./api-error";

export type QuieterAddress = string | string[];

export type QuieterAttachment = {
  content: string | Uint8Array | ArrayBuffer | Blob;
  contentEncoding?: "base64" | "raw";
  contentId?: string;
  contentType?: string;
  disposition?: "attachment" | "inline";
  filename: string;
};

export type QuieterHeader = {
  name: string;
  value: string;
};

export type QuieterTag = {
  name: string;
  value: string;
};

export type QuieterSendBaseInput = {
  attachments?: QuieterAttachment[];
  bcc?: QuieterAddress;
  cc?: QuieterAddress;
  from: string;
  headers?: Record<string, string> | QuieterHeader[];
  idempotencyKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
  replyTo?: QuieterAddress;
  subject: string;
  tags?: QuieterTag[];
  text: string;
  to: QuieterAddress;
};

export type QuieterSendInput =
  | (QuieterSendBaseInput & {
      html: string;
      react?: never;
    })
  | (QuieterSendBaseInput & {
      html?: never;
      react: ReactElement;
    })
  | (QuieterSendBaseInput & {
      html?: never;
      react?: never;
    });

export type QuieterSendOptions = {
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export type QuieterSendResult = {
  idempotent?: boolean;
  messageId: string | null;
  sent: true;
};

export type QuieterDeliveryStatus =
  | "bounced"
  | "complained"
  | "delayed"
  | "delivered"
  | "queued"
  | "rejected"
  | "sent";

export type QuieterDeliveryEvent = {
  diagnosticCode: string | null;
  eventType: QuieterDeliveryStatus | "opened" | "unsubscribed";
  occurredAt: string;
  providerStatus: string | null;
  reason: string | null;
  recipient: string;
};

export type QuieterMessageDelivery = {
  events: QuieterDeliveryEvent[];
  messageId: string;
  recipients: {
    lastEventAt: string;
    recipient: string;
    status: QuieterDeliveryStatus;
  }[];
};

export type QuieterRecipientSuppression = {
  createdAt: string;
  reason: "bounce" | "complaint" | "manual" | "unsubscribe";
  recipient: string;
  sourceProviderMessageId: string | null;
};

export type QuieterRequestOptions = {
  signal?: AbortSignal;
};

export type QuieterListSuppressionsOptions = QuieterRequestOptions & {
  limit?: number;
};

export type QuieterFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type QuieterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: QuieterFetch;
};

type SendRequest = Omit<QuieterSendInput, "attachments" | "react"> & {
  attachments?: (Omit<QuieterAttachment, "content" | "contentEncoding"> & {
    content: string;
  })[];
};

type ApiErrorBody = {
  error?: string;
  issues?: unknown;
};

const isSendResult = (value: unknown): value is QuieterSendResult =>
  typeof value === "object" &&
  value !== null &&
  "sent" in value &&
  value.sent === true;

const isMessageDelivery = (value: unknown): value is QuieterMessageDelivery =>
  typeof value === "object" &&
  value !== null &&
  "messageId" in value &&
  typeof value.messageId === "string" &&
  "recipients" in value &&
  Array.isArray(value.recipients) &&
  "events" in value &&
  Array.isArray(value.events);

const isSuppressionList = (
  value: unknown
): value is { data: QuieterRecipientSuppression[] } =>
  typeof value === "object" &&
  value !== null &&
  "data" in value &&
  Array.isArray(value.data);

const SEND_PATH = "/api/v1/send";
const MESSAGE_PATH = "/api/v1/messages/";
const SUPPRESSIONS_PATH = "/api/v1/suppressions";
const DEFAULT_BASE_URL = "https://quieter.email";

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const encodeAttachmentContent = async (
  content: QuieterAttachment["content"],
  encoding: QuieterAttachment["contentEncoding"] = "base64"
) => {
  if (typeof content === "string") {
    return encoding === "raw"
      ? bytesToBase64(new TextEncoder().encode(content))
      : content;
  }

  if (content instanceof Uint8Array) {
    return bytesToBase64(content);
  }

  if (content instanceof ArrayBuffer) {
    return bytesToBase64(new Uint8Array(content));
  }

  return bytesToBase64(new Uint8Array(await content.arrayBuffer()));
};

const normalizeSendInput = async (
  input: QuieterSendInput,
  options: QuieterSendOptions = {}
): Promise<SendRequest> => {
  const { react: _react, ...request } = input;

  return {
    ...request,
    attachments: await Promise.all(
      (input.attachments ?? []).map(
        async ({ content, contentEncoding, ...attachment }) => ({
          ...attachment,
          content: await encodeAttachmentContent(content, contentEncoding),
        })
      )
    ),
    html: input.react ? await render(input.react) : input.html,
    idempotencyKey: input.idempotencyKey ?? options.idempotencyKey,
    text: input.text,
  };
};

const isApiErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === "object" && value !== null;

export class Quieter {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: QuieterFetch;

  constructor(options: QuieterOptions) {
    if (options.apiKey === undefined || options.apiKey.trim() === "") {
      throw new Error("Quieter requires an apiKey.");
    }

    this.apiKey = options.apiKey;
    const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    baseUrl.pathname = baseUrl.pathname.endsWith("/")
      ? baseUrl.pathname
      : `${baseUrl.pathname}/`;
    this.baseUrl = baseUrl.href;
    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (fetchImpl === undefined) {
      throw new Error("Quieter requires a fetch implementation.");
    }

    this.fetch = fetchImpl;
  }

  private async getJson(path: string, signal?: AbortSignal) {
    const response = await this.fetch(new URL(path, this.baseUrl), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      method: "GET",
      signal,
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = isApiErrorBody(json) ? json : null;
      throw new QuieterApiError({
        issues: error?.issues,
        message: error?.error ?? `Quieter API returned ${response.status}.`,
        response: json,
        status: response.status,
      });
    }
    return { json, status: response.status };
  }

  async getMessage(
    messageId: string,
    options: QuieterRequestOptions = {}
  ): Promise<QuieterMessageDelivery> {
    const normalizedMessageId = messageId.trim();
    if (normalizedMessageId === "") {
      throw new Error("Quieter requires a messageId.");
    }
    const { json, status } = await this.getJson(
      `${MESSAGE_PATH}${encodeURIComponent(normalizedMessageId)}`,
      options.signal
    );
    if (!isMessageDelivery(json)) {
      throw new QuieterApiError({
        message: "Quieter API returned an unexpected response.",
        response: json,
        status,
      });
    }
    return json;
  }

  async listSuppressions(
    options: QuieterListSuppressionsOptions = {}
  ): Promise<QuieterRecipientSuppression[]> {
    const path = new URL(SUPPRESSIONS_PATH, this.baseUrl);
    if (options.limit !== undefined) {
      path.searchParams.set("limit", String(options.limit));
    }
    const { json, status } = await this.getJson(path.href, options.signal);
    if (!isSuppressionList(json)) {
      throw new QuieterApiError({
        message: "Quieter API returned an unexpected response.",
        response: json,
        status,
      });
    }
    return json.data;
  }

  async send(
    input: QuieterSendInput,
    options: QuieterSendOptions = {}
  ): Promise<QuieterSendResult> {
    const request = await normalizeSendInput(input, {
      idempotencyKey: input.idempotencyKey ?? options.idempotencyKey,
    });
    const response = await this.fetch(new URL(SEND_PATH, this.baseUrl), {
      body: JSON.stringify(request),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(request.idempotencyKey !== null &&
        request.idempotencyKey !== undefined &&
        request.idempotencyKey !== ""
          ? { "idempotency-key": request.idempotencyKey }
          : {}),
      },
      method: "POST",
      signal: options.signal,
    });
    const json: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error = isApiErrorBody(json) ? json : null;
      throw new QuieterApiError({
        issues: error?.issues,
        message: error?.error ?? `Quieter API returned ${response.status}.`,
        response: json,
        status: response.status,
      });
    }

    if (!isSendResult(json)) {
      throw new QuieterApiError({
        message: `Quieter API returned an unexpected response.`,
        response: json,
        status: response.status,
      });
    }

    return json;
  }
}

export { encodeAttachmentContent, normalizeSendInput };
