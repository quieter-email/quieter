import { APICallError } from "ai";
import type { LanguageModelMiddleware } from "ai";

type StreamResult = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>
>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

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
  wrapStream: async ({ doStream }) => {
    const result = await doStream();
    const reader = result.stream.getReader();
    const prefix: StreamPart[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        const part = next.value;
        if (part.type === "error") {
          throw normalizeStreamError(part.error, result.response?.headers);
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
      await reader.cancel().catch(() => {
        // Preserve the provider failure if cancelling its stream also fails.
      });
      reader.releaseLock();
      throw error;
    }
    return {
      ...result,
      stream: new ReadableStream<StreamPart>({
        async cancel(reason) {
          await reader.cancel(reason);
          reader.releaseLock();
        },
        async pull(controller) {
          const buffered = prefix.shift();
          if (buffered !== undefined) {
            controller.enqueue(buffered);
            return;
          }
          try {
            const next = await reader.read();
            if (next.done) {
              reader.releaseLock();
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
            reader.releaseLock();
            controller.error(error);
          }
        },
      }),
    };
  },
};
