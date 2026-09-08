import {
  messageDeliverySchema,
  recipientSuppressionListSchema,
  sendMessageResultSchema,
} from "@quieter/mail/delivery";
import type {
  DeliveryEvent,
  DeliveryStatus,
  MessageDelivery,
  RecipientSuppression,
} from "@quieter/mail/delivery";
import type {
  SendHeader,
  SendMessageRequest,
  SendMessageResult,
} from "@quieter/mail/send";
import { z } from "zod";

import { QuieterApiError } from "./api-error";

export { QuieterApiError } from "./api-error";
export type QuieterAddress = SendMessageRequest["to"];
export type QuieterHeader = SendHeader;
export type QuieterTag = NonNullable<SendMessageRequest["tags"]>[number];
export type QuieterSendResult = SendMessageResult;
export type QuieterDeliveryStatus = DeliveryStatus;
export type QuieterDeliveryEvent = DeliveryEvent;
export type QuieterMessageDelivery = MessageDelivery;
export type QuieterRecipientSuppression = RecipientSuppression;

export type QuieterAttachment = Omit<
  NonNullable<SendMessageRequest["attachments"]>[number],
  "content"
> & {
  content: string | Uint8Array | ArrayBuffer | Blob;
  contentEncoding?: "base64" | "raw";
};
export type QuieterSendInput = Omit<SendMessageRequest, "attachments"> & {
  attachments?: QuieterAttachment[];
};
export type QuieterSendBaseInput = Omit<QuieterSendInput, "html">;
export type QuieterSendOptions = {
  idempotencyKey?: string;
  signal?: AbortSignal;
};
export type QuieterRequestOptions = { signal?: AbortSignal };
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

export class Quieter {
  readonly #apiKey: string;
  readonly baseUrl: string;
  readonly #fetch: QuieterFetch;

  constructor(options: QuieterOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("Quieter requires an apiKey.");
    }
    this.#apiKey = options.apiKey;
    const baseUrl = new URL(options.baseUrl ?? "https://quieter.email");
    if (!baseUrl.pathname.endsWith("/")) {
      baseUrl.pathname += "/";
    }
    this.baseUrl = baseUrl.href;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (fetchImpl === undefined) {
      throw new Error("Quieter requires a fetch implementation.");
    }
    this.#fetch = fetchImpl;
  }

  async #request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {}
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${this.#apiKey}`);
    const response = await this.#fetch(new URL(path, this.baseUrl), {
      method: "GET",
      ...init,
      headers,
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z
        .object({
          error: z.string().optional(),
          issues: z.unknown().optional(),
        })
        .safeParse(json).data;
      throw new QuieterApiError({
        issues: error?.issues,
        message: error?.error ?? `Quieter API returned ${response.status}.`,
        response: json,
        status: response.status,
      });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new QuieterApiError({
        message: "Quieter API returned an unexpected response.",
        response: json,
        status: response.status,
      });
    }
    return parsed.data;
  }

  async getMessage(
    messageId: string,
    options: QuieterRequestOptions = {}
  ): Promise<QuieterMessageDelivery> {
    const normalized = messageId.trim();
    if (!normalized) {
      throw new Error("Quieter requires a messageId.");
    }
    return await this.#request(
      `api/v1/messages/${encodeURIComponent(normalized)}`,
      messageDeliverySchema,
      options
    );
  }

  async listSuppressions(
    options: QuieterListSuppressionsOptions = {}
  ): Promise<QuieterRecipientSuppression[]> {
    const path = new URL("api/v1/suppressions", this.baseUrl);
    if (options.limit !== undefined) {
      path.searchParams.set("limit", String(options.limit));
    }
    const result = await this.#request(
      path.href,
      recipientSuppressionListSchema,
      { signal: options.signal }
    );
    return result.data;
  }

  async send(
    input: QuieterSendInput,
    options: QuieterSendOptions = {}
  ): Promise<QuieterSendResult> {
    const attachments = await Promise.all(
      (input.attachments ?? []).map(
        async ({ content, contentEncoding, ...attachment }) => {
          if (typeof content === "string" && contentEncoding !== "raw") {
            return { ...attachment, content };
          }
          let bytes: Uint8Array;
          if (typeof content === "string") {
            bytes = new TextEncoder().encode(content);
          } else if (content instanceof Uint8Array) {
            bytes = content;
          } else if (content instanceof ArrayBuffer) {
            bytes = new Uint8Array(content);
          } else {
            bytes = new Uint8Array(await content.arrayBuffer());
          }
          let binary = "";
          for (const byte of bytes) {
            binary += String.fromCodePoint(byte);
          }
          return { ...attachment, content: btoa(binary) };
        }
      )
    );
    const idempotencyKey = input.idempotencyKey ?? options.idempotencyKey;
    return await this.#request("api/v1/send", sendMessageResultSchema, {
      body: JSON.stringify({ ...input, attachments, idempotencyKey }),
      headers: {
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      method: "POST",
      signal: options.signal,
    });
  }
}
