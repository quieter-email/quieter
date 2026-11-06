import { ORPCError } from "@orpc/server";

import { ConnectorHttpError } from "./runtime";

export type MicrosoftGraphAuth = {
  accessToken: string;
  signal?: AbortSignal;
};

export const requestMicrosoftGraph = async (
  input: MicrosoftGraphAuth & {
    body?: unknown;
    method?: "POST" | "PATCH" | "DELETE";
    path: string;
    prefer?: string;
    version?: string;
    allowDownloadRedirect?: boolean;
  }
) => {
  const url = new URL(input.path, "https://graph.microsoft.com/v1.0/");
  if (
    url.origin !== "https://graph.microsoft.com" ||
    !url.pathname.startsWith("/v1.0/me/") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid account resource.",
    });
  }
  const response = await fetch(url, {
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      ...(input.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(input.prefer ? { Prefer: input.prefer } : {}),
      ...(input.version ? { "If-Match": input.version } : {}),
    },
    method: input.method,
    redirect: "manual",
    signal: input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  if (
    !response.ok &&
    !(input.allowDownloadRedirect === true && response.status === 302)
  ) {
    await response.body?.cancel();
    throw new ConnectorHttpError(
      "The connected account request failed.",
      response.status
    );
  }
  return response;
};

export const readBoundedMicrosoftContent = async (
  response: Response,
  maxBytes: number
) => {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new ORPCError("BAD_REQUEST", {
      message: "This file is too large to read here.",
    });
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let content = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This file is too large to read here.",
        });
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
    return content + decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
};
