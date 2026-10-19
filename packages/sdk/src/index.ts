import { controlOperations } from "@quieter/mail/control";
import type {
  ControlInput,
  ControlOperation,
  ControlOutput,
} from "@quieter/mail/control";
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
  readonly audiences = {
    create: async (
      input: ControlInput<"audiences.create">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.create">> =>
      await this.control("audiences.create", input, options),
    createSegment: async (
      input: ControlInput<"audiences.createSegment">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.createSegment">> =>
      await this.control("audiences.createSegment", input, options),
    deleteSegment: async (
      input: ControlInput<"audiences.deleteSegment">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.deleteSegment">> =>
      await this.control("audiences.deleteSegment", input, options),
    get: async (
      input: ControlInput<"audiences.get">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.get">> =>
      await this.control("audiences.get", input, options),
    importContacts: async (
      input: ControlInput<"audiences.importContacts">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.importContacts">> =>
      await this.control("audiences.importContacts", input, options),
    list: async (
      input: ControlInput<"audiences.list"> = {},
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.list">> =>
      await this.control("audiences.list", input, options),
    listContacts: async (
      input: ControlInput<"audiences.listContacts">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.listContacts">> =>
      await this.control("audiences.listContacts", input, options),
    listHistory: async (
      input: ControlInput<"audiences.listHistory">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.listHistory">> =>
      await this.control("audiences.listHistory", input, options),
    listSegments: async (
      input: ControlInput<"audiences.listSegments">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.listSegments">> =>
      await this.control("audiences.listSegments", input, options),
    registerContact: async (
      input: ControlInput<"audiences.registerContact">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.registerContact">> =>
      await this.control("audiences.registerContact", input, options),
    removeContact: async (
      input: ControlInput<"audiences.removeContact">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.removeContact">> =>
      await this.control("audiences.removeContact", input, options),
    resubscribeContact: async (
      input: ControlInput<"audiences.resubscribeContact">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.resubscribeContact">> =>
      await this.control("audiences.resubscribeContact", input, options),
    setSuppression: async (
      input: ControlInput<"audiences.setSuppression">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.setSuppression">> =>
      await this.control("audiences.setSuppression", input, options),
    unsubscribeContact: async (
      input: ControlInput<"audiences.unsubscribeContact">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.unsubscribeContact">> =>
      await this.control("audiences.unsubscribeContact", input, options),
    update: async (
      input: ControlInput<"audiences.update">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.update">> =>
      await this.control("audiences.update", input, options),
    updateContact: async (
      input: ControlInput<"audiences.updateContact">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.updateContact">> =>
      await this.control("audiences.updateContact", input, options),
    updateSegment: async (
      input: ControlInput<"audiences.updateSegment">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"audiences.updateSegment">> =>
      await this.control("audiences.updateSegment", input, options),
  };
  readonly campaigns = {
    cancel: async (
      input: ControlInput<"campaigns.cancel">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.cancel">> =>
      await this.control("campaigns.cancel", input, options),
    create: async (
      input: ControlInput<"campaigns.create">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.create">> =>
      await this.control("campaigns.create", input, options),
    get: async (
      input: ControlInput<"campaigns.get">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.get">> =>
      await this.control("campaigns.get", input, options),
    list: async (
      input: ControlInput<"campaigns.list"> = {},
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.list">> =>
      await this.control("campaigns.list", input, options),
    preview: async (
      input: ControlInput<"campaigns.preview">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.preview">> =>
      await this.control("campaigns.preview", input, options),
    retry: async (
      input: ControlInput<"campaigns.retry">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.retry">> =>
      await this.control("campaigns.retry", input, options),
    send: async (
      input: ControlInput<"campaigns.send">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.send">> =>
      await this.control("campaigns.send", input, options),
    update: async (
      input: ControlInput<"campaigns.update">,
      options?: QuieterRequestOptions
    ): Promise<ControlOutput<"campaigns.update">> =>
      await this.control("campaigns.update", input, options),
  };
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

  async control<K extends ControlOperation>(
    operation: K,
    input: ControlInput<K>,
    options: QuieterRequestOptions = {}
  ): Promise<ControlOutput<K>> {
    const contract = controlOperations[operation];
    const parsed = contract.input.parse(input);
    return await this.#request<ControlOutput<K>>(
      "api/v1/control",
      z.custom<ControlOutput<K>>(
        (value) => contract.output.safeParse(value).success
      ),
      {
        body: JSON.stringify({ input: parsed, operation }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: options.signal,
      }
    );
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
