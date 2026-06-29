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

export type QuieterSendInput = {
  attachments?: QuieterAttachment[];
  bcc?: QuieterAddress;
  cc?: QuieterAddress;
  from: string;
  headers?: Record<string, string> | QuieterHeader[];
  html?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
  react?: unknown;
  replyTo?: QuieterAddress;
  subject: string;
  tags?: QuieterTag[];
  text?: string;
  to: QuieterAddress;
};

export type QuieterSendOptions = {
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export type QuieterSendResult = {
  idempotent?: boolean;
  messageId: string | null;
  sent: true;
};

export type QuieterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type SendRequest = Omit<QuieterSendInput, "attachments" | "react"> & {
  attachments?: Array<Omit<QuieterAttachment, "content"> & { content: string }>;
};

type ErrorResponse = {
  error?: unknown;
  issues?: unknown;
};

const SEND_PATH = "/api/v1/send";
const DEFAULT_BASE_URL = "https://quieter.email";

export class QuieterApiError extends Error {
  readonly issues?: unknown;
  readonly response?: unknown;
  readonly status: number;

  constructor(input: { issues?: unknown; message: string; response?: unknown; status: number }) {
    super(input.message);
    this.name = "QuieterApiError";
    this.issues = input.issues;
    this.response = input.response;
    this.status = input.status;
  }
}

export class Quieter {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof fetch;

  constructor(options: QuieterOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("Quieter requires an apiKey.");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetch = options.fetch ?? globalThis.fetch;

    if (!this.fetch) {
      throw new Error("Quieter requires a fetch implementation.");
    }
  }

  async send(
    input: QuieterSendInput,
    options: QuieterSendOptions = {},
  ): Promise<QuieterSendResult> {
    const request = await normalizeSendInput(input, options);
    const response = await this.fetch(new URL(SEND_PATH, this.baseUrl), {
      body: JSON.stringify(request),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      method: "POST",
      signal: options.signal,
    });
    const json = await readJson(response);

    if (!response.ok) {
      const error = isRecord(json) ? (json as ErrorResponse) : {};
      throw new QuieterApiError({
        issues: error.issues,
        message:
          typeof error.error === "string"
            ? error.error
            : `Quieter API returned ${response.status}.`,
        response: json,
        status: response.status,
      });
    }

    if (!isSendResult(json)) {
      throw new QuieterApiError({
        message: "Quieter API returned an unexpected response.",
        response: json,
        status: response.status,
      });
    }

    return json;
  }
}

export const normalizeSendInput = async (
  input: QuieterSendInput,
  options: QuieterSendOptions = {},
): Promise<SendRequest> => {
  const rendered = input.react ? await renderReactEmail(input.react, input.text) : null;
  const { react: _react, ...request } = input;

  return {
    ...request,
    attachments: await Promise.all((input.attachments ?? []).map(normalizeAttachment)),
    html: rendered?.html ?? input.html,
    idempotencyKey: input.idempotencyKey ?? options.idempotencyKey,
    text: input.text ?? rendered?.text,
  };
};

const normalizeAttachment = async (
  attachment: QuieterAttachment,
): Promise<Omit<QuieterAttachment, "content"> & { content: string }> => ({
  ...attachment,
  content: await encodeAttachmentContent(attachment.content, attachment.contentEncoding),
});

export const encodeAttachmentContent = async (
  content: QuieterAttachment["content"],
  encoding: QuieterAttachment["contentEncoding"] = "base64",
) => {
  if (typeof content === "string") {
    return encoding === "raw" ? bytesToBase64(new TextEncoder().encode(content)) : content;
  }

  if (content instanceof Uint8Array) {
    return bytesToBase64(content);
  }

  if (content instanceof ArrayBuffer) {
    return bytesToBase64(new Uint8Array(content));
  }

  return bytesToBase64(new Uint8Array(await content.arrayBuffer()));
};

const renderReactEmail = async (react: unknown, text: string | undefined) => {
  const { render } = (await import("@react-email/render")) as {
    render: (element: unknown, options?: { plainText?: boolean }) => Promise<string> | string;
  };
  const html = await render(react);

  return {
    html,
    text: text ?? (await render(react, { plainText: true })),
  };
};

const normalizeBaseUrl = (baseUrl: string) => {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url.href;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const readJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isSendResult = (value: unknown): value is QuieterSendResult =>
  isRecord(value) &&
  value.sent === true &&
  ("messageId" in value ? typeof value.messageId === "string" || value.messageId === null : false);
