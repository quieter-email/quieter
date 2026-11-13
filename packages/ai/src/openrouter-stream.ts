import { APICallError } from "ai";
import type { LanguageModelMiddleware } from "ai";

import { createOpenRouterToolInputTransform } from "./openrouter-tool-input";

type StreamResult = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>
>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

const PROVIDER_START_TIMEOUT_MS = 60_000;
const MAX_PREFIX_PARTS = 128;

const normalizeStreamError = (
  error: unknown,
  responseHeaders: Record<string, string> | undefined
): unknown => {
  if (error === null || typeof error !== "object" || error instanceof Error) {
    return error;
  }
  const code: unknown = Reflect.get(error, "code");
  const message: unknown = Reflect.get(error, "message");
  if (typeof code !== "number" || typeof message !== "string") {
    return error;
  }
  return new APICallError({
    message,
    requestBodyValues: {},
    responseHeaders,
    statusCode: code,
    url: "https://openrouter.ai/api/v1/chat/completions",
  });
};

// OpenRouter can send an HTTP 200 SSE error before generation starts. Raising
// it from doStream lets the SDK retry with backoff, before tools can execute.
export const openRouterStreamMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",
  wrapStream: async ({ model, params }) => {
    params.abortSignal?.throwIfAborted();
    const requestAbort = new AbortController();
    const signal = params.abortSignal
      ? AbortSignal.any([params.abortSignal, requestAbort.signal])
      : requestAbort.signal;
    const aborted = Promise.withResolvers<never>();
    const onAbort = () => {
      aborted.reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // The SDK starts its first-chunk clock only after this wrapper returns.
    const deadline = setTimeout(() => {
      requestAbort.abort(
        new DOMException(
          "The assistant took too long to respond.",
          "TimeoutError"
        )
      );
    }, PROVIDER_START_TIMEOUT_MS);
    let result: StreamResult;
    let reader: ReadableStreamDefaultReader<StreamPart> | undefined;
    const prefix: StreamPart[] = [];
    try {
      result = await Promise.race([
        model
          .doStream({
            ...params,
            abortSignal: signal,
            includeRawChunks: true,
          })
          .then(async (response) => {
            if (signal.aborted) {
              try {
                await response.stream.cancel(signal.reason);
              } catch {
                // Preserve the original timeout or cancellation reason.
              }
              signal.throwIfAborted();
            }
            return response;
          }),
        aborted.promise,
      ]);
      reader = result.stream
        .pipeThrough(
          createOpenRouterToolInputTransform({
            includeRawChunks: params.includeRawChunks,
          }),
          { signal }
        )
        .getReader();
      while (true) {
        const next = await Promise.race([reader.read(), aborted.promise]);
        if (next.done) {
          break;
        }
        const part = next.value;
        if (part.type === "error") {
          throw normalizeStreamError(part.error, result.response?.headers);
        }
        if (prefix.length >= MAX_PREFIX_PARTS) {
          throw new Error(
            "The assistant returned too much data before responding."
          );
        }
        prefix.push(part);
        if (
          part.type !== "stream-start" &&
          part.type !== "response-metadata" &&
          part.type !== "raw"
        ) {
          break;
        }
      }
    } catch (error) {
      const failure: unknown = signal.aborted ? signal.reason : error;
      requestAbort.abort(failure);
      // oxlint-disable-next-line promise/prefer-await-to-then -- A stalled transport cancellation must not delay the failure.
      void reader?.cancel(failure).catch(() => {
        // Preserve the provider failure if cancelling its stream also fails.
      });
      reader?.releaseLock();
      throw failure;
    } finally {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(deadline);
    }
    const streamReader = reader;
    return {
      ...result,
      stream: new ReadableStream<StreamPart>({
        async cancel(reason) {
          const cancelled = streamReader.cancel(reason);
          requestAbort.abort(reason);
          try {
            await cancelled;
          } catch (error) {
            if (error !== signal.reason) {
              throw error;
            }
          } finally {
            streamReader.releaseLock();
          }
        },
        async pull(controller) {
          const buffered = prefix.shift();
          if (buffered !== undefined) {
            controller.enqueue(buffered);
            return;
          }
          try {
            const next = await streamReader.read();
            if (next.done) {
              streamReader.releaseLock();
              controller.close();
              return;
            }
            const part = next.value;
            controller.enqueue(
              part.type === "error"
                ? {
                    ...part,
                    error: normalizeStreamError(
                      part.error,
                      result.response?.headers
                    ),
                  }
                : part
            );
          } catch (error) {
            streamReader.releaseLock();
            controller.enqueue({
              error: normalizeStreamError(error, result.response?.headers),
              type: "error",
            });
            controller.close();
          }
        },
      }),
    };
  },
};
