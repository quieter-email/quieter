import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, streamText, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
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
  test("cancels a stalled response body through the real provider adapter", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn<(reason: unknown) => void>();
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            cancel,
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({
                    ...completion,
                    choices: [{ delta: {}, finish_reason: null, index: 0 }],
                  })}\n\n`
                )
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      );
      const errors: unknown[] = [];
      const result = streamText({
        model: wrapLanguageModel({
          middleware: openRouterStreamMiddleware,
          model: createOpenRouter({ apiKey: "fixture", fetch }).chat(
            "openai/gpt-5.6-luna"
          ),
        }),
        onError: ({ error }) => errors.push(error),
        prompt: "Say OK",
        timeout: { firstChunkMs: 1000 },
      });
      const consuming = result.consumeStream();
      await vi.waitUntil(() => fetch.mock.calls.length > 0);
      await vi.runAllTimersAsync();
      await consuming;
      expect(errors).toContainEqual(
        expect.objectContaining({ name: "TimeoutError" })
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test("settles Stop even when provider setup ignores cancellation and cancels its late response", async () => {
    const abort = new AbortController();
    const cancellation = new Error("User stopped this exchange.");
    let respond:
      | ((response: { stream: ReadableStream<never> }) => void)
      | undefined;
    const model = wrapLanguageModel({
      middleware: openRouterStreamMiddleware,
      model: new MockLanguageModelV4({
        doStream: async () =>
          // oxlint-disable-next-line promise/avoid-new -- Provider setup deliberately ignores cancellation and resolves later.
          await new Promise<{ stream: ReadableStream<never> }>((resolve) => {
            respond = resolve;
          }),
      }),
    });
    const response = model.doStream({ abortSignal: abort.signal, prompt: [] });
    await vi.waitUntil(() => respond !== undefined);
    abort.abort(cancellation);
    await expect(response).rejects.toBe(cancellation);
    const cancel = vi.fn<(reason: unknown) => void>();
    const stream = new ReadableStream<never>({ cancel });
    respond?.({ stream });
    await vi.waitUntil(() => cancel.mock.calls.length > 0);
    expect(cancel).toHaveBeenCalledWith(cancellation);
    expect(stream.locked).toBeFalsy();
  });

  test("cancels an active response without reporting a provider failure", async () => {
    const abort = new AbortController();
    const cancel = vi.fn<(reason: unknown) => void>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel,
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(completion)}\n\n`
              )
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } }
      )
    );
    const onAbort = vi.fn<() => void>();
    const onError = vi.fn<(event: { error: unknown }) => void>();
    const result = streamText({
      abortSignal: abort.signal,
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: createOpenRouter({ apiKey: "fixture", fetch }).chat(
          "openai/gpt-5.6-luna"
        ),
      }),
      onAbort,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") {
          abort.abort();
        }
      },
      onError,
      prompt: "Say OK",
    });
    await result.consumeStream();
    expect(onAbort).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    await vi.waitUntil(() => cancel.mock.calls.length > 0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  test.each(["handshake", "metadata"] as const)(
    "times out a stalled %s before the SDK first-chunk timer starts",
    async (stage) => {
      vi.useFakeTimers();
      try {
        const signals: AbortSignal[] = [];
        const errors: unknown[] = [];
        const model = new MockLanguageModelV4({
          doStream: async ({ abortSignal }) => {
            if (!abortSignal) {
              throw new Error("Provider requests must carry cancellation.");
            }
            signals.push(abortSignal);
            if (stage === "handshake") {
              // oxlint-disable-next-line promise/avoid-new -- The synthetic provider settles only when its request is aborted.
              return await new Promise<never>((_resolve, reject) => {
                abortSignal.addEventListener("abort", () => {
                  reject(new DOMException("Request aborted.", "AbortError"));
                });
              });
            }
            return {
              stream: new ReadableStream({
                start(controller) {
                  controller.enqueue({ type: "stream-start", warnings: [] });
                  controller.enqueue({
                    id: "fixture",
                    type: "response-metadata",
                  });
                  abortSignal.addEventListener("abort", () => {
                    controller.error(abortSignal.reason);
                  });
                },
              }),
            };
          },
        });
        const result = streamText({
          model: wrapLanguageModel({
            middleware: openRouterStreamMiddleware,
            model,
          }),
          onError: ({ error }) => errors.push(error),
          prompt: "Say OK",
          timeout: { firstChunkMs: 1000 },
        });
        const consuming = result.consumeStream();
        await vi.waitUntil(() => signals.length > 0);
        const [signal] = signals;
        await vi.runAllTimersAsync();
        await consuming;
        expect(signal?.aborted).toBeTruthy();
        expect(errors).toContainEqual(
          expect.objectContaining({ name: "TimeoutError" })
        );
        expect(model.doStreamCalls).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  test("preserves cancellation while waiting for provider output", async () => {
    const cancellation = new Error("User stopped this exchange.");
    const abort = new AbortController();
    let providerStarted = false;
    const model = wrapLanguageModel({
      middleware: openRouterStreamMiddleware,
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          providerStarted = true;
          // oxlint-disable-next-line promise/avoid-new -- The synthetic provider settles only when its request is aborted.
          return await new Promise<never>((_resolve, reject) => {
            abortSignal?.addEventListener("abort", () => {
              reject(new DOMException("Request aborted.", "AbortError"));
            });
          });
        },
      }),
    });
    const response = model.doStream({ abortSignal: abort.signal, prompt: [] });
    await vi.waitUntil(() => providerStarted);
    abort.abort(cancellation);
    await expect(response).rejects.toBe(cancellation);
  });

  test("clears the startup deadline once generation begins", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const model = wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: new MockLanguageModelV4({
          doStream: async ({ abortSignal }) => {
            if (!abortSignal) {
              throw new Error("Provider requests must carry cancellation.");
            }
            signals.push(abortSignal);
            return await Promise.resolve({
              stream: new ReadableStream({
                start(controller) {
                  controller.enqueue({ type: "stream-start", warnings: [] });
                  controller.enqueue({ id: "answer", type: "text-start" });
                  controller.enqueue({
                    delta: "OK",
                    id: "answer",
                    type: "text-delta",
                  });
                  controller.close();
                },
              }),
            });
          },
        }),
      });
      const response = await model.doStream({ prompt: [] });
      await vi.waitUntil(() => signals.length > 0);
      const [signal] = signals;
      await vi.runAllTimersAsync();
      expect(signal?.aborted).toBeFalsy();
      const parts = [];
      for await (const part of response.stream) {
        parts.push(part);
      }
      expect(parts).toContainEqual(
        expect.objectContaining({ delta: "OK", type: "text-delta" })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("bounds a provider that keeps sending metadata without output", async () => {
    const signals: AbortSignal[] = [];
    const model = wrapLanguageModel({
      middleware: openRouterStreamMiddleware,
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          if (!abortSignal) {
            throw new Error("Provider requests must carry cancellation.");
          }
          signals.push(abortSignal);
          return await Promise.resolve({
            stream: new ReadableStream({
              pull(controller) {
                controller.enqueue({
                  id: "fixture",
                  type: "response-metadata",
                });
              },
            }),
          });
        },
      }),
    });
    await expect(model.doStream({ prompt: [] })).rejects.toThrow(
      /before responding/u
    );
    const [signal] = signals;
    expect(signal?.aborted).toBeTruthy();
  });

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
