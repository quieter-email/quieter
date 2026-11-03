import { ConnectorHttpError } from "./runtime";

export type TaskToolDescriptor = {
  description: string;
  effect: "read" | "write";
  inputSchema: unknown;
  name: string;
};

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const providerErrorMessages: Record<number, string> = {
  401: "Reconnect this account and try again.",
  403: "This account does not have permission for that action.",
  404: "That item is no longer available.",
  429: "The service is busy. Please retry shortly.",
};

export const requestTaskProvider = async (input: {
  accessToken: string;
  baseUrl: string;
  body?: Record<string, unknown>;
  method?: "GET" | "POST" | "PUT";
  path: string;
  signal?: AbortSignal;
}): Promise<unknown> => {
  const signal = AbortSignal.any(
    input.signal
      ? [input.signal, AbortSignal.timeout(15_000)]
      : [AbortSignal.timeout(15_000)]
  );
  const response = await fetch(new URL(input.path, input.baseUrl), {
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    method: input.method ?? "GET",
    signal,
  });

  if (!response.ok) {
    await response.body?.cancel();
    const message =
      providerErrorMessages[response.status] ??
      "The service could not complete that request.";
    throw new ConnectorHttpError(message, response.status);
  }

  if (response.status === 204) {
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("The service returned an empty response.");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Bound the response before parsing it.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(
          "The service returned too much data. Narrow the request."
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (text === "") {
    return null;
  }
  const parsed: unknown = JSON.parse(text);
  return parsed;
};

export const boundTaskToolOutput = (value: unknown): unknown => {
  const serialized = JSON.stringify(value) ?? "";
  return serialized.length <= MAX_TOOL_OUTPUT_CHARS
    ? value
    : { preview: serialized.slice(0, MAX_TOOL_OUTPUT_CHARS), truncated: true };
};
