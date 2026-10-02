import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, streamText, wrapLanguageModel } from "ai";
import { describe, expect, test, vi } from "vite-plus/test";

import { isTransientAiProviderError } from "../src/errors";
import { openRouterStreamMiddleware } from "../src/openrouter-stream";

const completion = {
  choices: [{ delta: { content: "OK" }, finish_reason: null, index: 0 }],
  created: 1,
  id: "fixture-completion",
  model: "openai/gpt-5.6-luna",
  object: "chat.completion.chunk",
};

const providerResponse = (...chunks: unknown[]) =>
  new Response(
    [
      ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
      "data: [DONE]\n\n",
    ].join(""),
    {
      headers: { "content-type": "text/event-stream", "retry-after-ms": "0" },
    }
  );

describe("OpenRouter streamed errors", () => {
  test("retries an HTTP 200 rate-limit payload before output with the real provider adapter", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        providerResponse({
          error: { code: 429, message: "Temporarily rate-limited upstream." },
        })
      )
      .mockResolvedValueOnce(
        providerResponse(completion, {
          ...completion,
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
        })
      );
    const provider = createOpenRouter({ apiKey: "fixture", fetch });
    const onError = vi.fn<(event: { error: unknown }) => void>();
    const result = streamText({
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: provider.chat("openai/gpt-5.6-luna"),
      }),
      onError,
      prompt: "Say OK",
    });
    await result.consumeStream();
    await expect(result.text).resolves.toBe("OK");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  test("bounds retries and preserves the underlying status on exhaustion", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = providerResponse({
        error: {
          code: 429,
          message: "Temporarily rate-limited upstream.",
        },
      });
      return await Promise.resolve(response);
    });
    const provider = createOpenRouter({ apiKey: "fixture", fetch });
    const errors: unknown[] = [];
    const result = streamText({
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: provider.chat("openai/gpt-5.6-luna"),
      }),
      onError: ({ error }) => {
        errors.push(error);
      },
      prompt: "Say OK",
    });
    await result.consumeStream();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(1);
    expect(isTransientAiProviderError(errors[0])).toBeTruthy();
  });

  test("does not replay a response after output has started", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      providerResponse(completion, {
        error: {
          code: 503,
          message: "Upstream unavailable.",
        },
      })
    );
    const provider = createOpenRouter({ apiKey: "fixture", fetch });
    const errors: unknown[] = [];
    const result = streamText({
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: provider.chat("openai/gpt-5.6-luna"),
      }),
      onError: ({ error }) => {
        errors.push(error);
      },
      prompt: "Say OK",
    });
    await result.consumeStream();
    expect(fetch).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(APICallError.isInstance(errors[0])).toBeTruthy();
    expect(errors[0]).toMatchObject({ statusCode: 503 });
  });

  test("does not retry permanent provider failures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      providerResponse({
        error: {
          code: 400,
          message: "Invalid provider request.",
        },
      })
    );
    const provider = createOpenRouter({ apiKey: "fixture", fetch });
    const errors: unknown[] = [];
    const result = streamText({
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: provider.chat("openai/gpt-5.6-luna"),
      }),
      onError: ({ error }) => {
        errors.push(error);
      },
      prompt: "Say OK",
    });
    await result.consumeStream();
    expect(fetch).toHaveBeenCalledOnce();
    expect(errors[0]).toMatchObject({ statusCode: 400 });
    expect(isTransientAiProviderError(errors[0])).toBeFalsy();
  });

  test("does not retry after a tool call starts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      providerResponse(
        {
          ...completion,
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: {
                      arguments: "{}",
                      name: "get_workspace",
                    },
                    id: "tool-call",
                    index: 0,
                    type: "function",
                  },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
        },
        {
          error: {
            code: 429,
            message: "Rate limited after a tool call.",
          },
        }
      )
    );
    const provider = createOpenRouter({ apiKey: "fixture", fetch });
    const model = wrapLanguageModel({
      middleware: openRouterStreamMiddleware,
      model: provider.chat("openai/gpt-5.6-luna"),
    });
    const result = await model.doStream({
      prompt: [
        { content: [{ text: "Read workspace", type: "text" }], role: "user" },
      ],
    });
    const parts = [];
    for await (const part of result.stream) {
      parts.push(part);
    }
    expect(parts).toContainEqual(
      expect.objectContaining({ type: "tool-input-start" })
    );
    expect(parts.find((part) => part.type === "error")?.error).toMatchObject({
      statusCode: 429,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("stops retry backoff when the user cancels", async () => {
    const abort = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = providerResponse({
        error: { code: 429, message: "Rate limited." },
      });
      response.headers.set("retry-after-ms", "10000");
      setTimeout(() => {
        abort.abort();
      }, 10);
      return await Promise.resolve(response);
    });
    const provider = createOpenRouter({ apiKey: "fixture", fetch });
    const result = streamText({
      abortSignal: abort.signal,
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: provider.chat("openai/gpt-5.6-luna"),
      }),
      prompt: "Say OK",
    });
    await result.consumeStream();
    expect(fetch).toHaveBeenCalledOnce();
    expect(abort.signal.aborted).toBeTruthy();
  });
});
