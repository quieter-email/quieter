import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { isLoopFinished, streamText, tool, wrapLanguageModel } from "ai";
import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { openRouterStreamMiddleware } from "../src/openrouter-stream";

const completion = (delta: unknown, finishReason: string | null = null) => ({
  choices: [{ delta, finish_reason: finishReason, index: 0 }],
  created: 1,
  id: "fixture-completion",
  model: "openai/gpt-5.6-luna",
  object: "chat.completion.chunk",
});

const providerResponse = (...chunks: unknown[]) =>
  new Response(
    [
      ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
      "data: [DONE]\n\n",
    ].join(""),
    { headers: { "content-type": "text/event-stream" } }
  );

const toolDelta = (input: string, index = 0, id = "fixture-call") => ({
  function: { arguments: input, name: "search_gmail" },
  id,
  index,
  type: "function",
});

describe("OpenRouter tool input integrity", () => {
  test.each(["optional", "required"] as const)(
    "rejects truncated %s input before execution or another model turn",
    async (inputKind) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          providerResponse(
            completion({ tool_calls: [toolDelta('{"query":"unfinished')] })
          )
        )
        .mockResolvedValue(
          providerResponse(completion({ content: "Done" }, "stop"))
        );
      const execute = vi.fn<() => { messages: string[] }>(() => ({
        messages: [],
      }));
      const errors: unknown[] = [];
      const provider = createOpenRouter({ apiKey: "fixture", fetch });
      const result = streamText({
        model: wrapLanguageModel({
          middleware: openRouterStreamMiddleware,
          model: provider.chat("openai/gpt-5.6-luna"),
        }),
        onError: ({ error }) => errors.push(error),
        prompt: "Find messages",
        stopWhen: isLoopFinished(),
        tools: {
          search_gmail: tool({
            execute,
            inputSchema: z.object({
              query:
                inputKind === "optional" ? z.string().optional() : z.string(),
            }),
          }),
        },
      });
      await result.consumeStream();
      expect(execute).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
      expect(errors[0]).toHaveProperty(
        "message",
        expect.stringMatching(/incomplete tool input/u)
      );
    }
  );

  test.each(["stop", "tool_calls"])(
    "rejects incomplete input even when the provider finishes with %s",
    async (finishReason) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          providerResponse(
            completion({ tool_calls: [toolDelta('{"query":')] }),
            completion({}, finishReason)
          )
        );
      const execute = vi.fn<() => { messages: string[] }>(() => ({
        messages: [],
      }));
      const errors: unknown[] = [];
      const result = streamText({
        model: wrapLanguageModel({
          middleware: openRouterStreamMiddleware,
          model: createOpenRouter({ apiKey: "fixture", fetch }).chat(
            "openai/gpt-5.6-luna"
          ),
        }),
        onError: ({ error }) => errors.push(error),
        prompt: "Find messages",
        stopWhen: isLoopFinished(),
        tools: {
          search_gmail: tool({
            execute,
            inputSchema: z.object({ query: z.string().optional() }),
          }),
        },
      });
      await result.consumeStream();
      expect(execute).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
      expect(errors[0]).toHaveProperty(
        "message",
        expect.stringMatching(/incomplete tool input/u)
      );
    }
  );

  test("preserves fragmented parallel calls with duplicate provider IDs and sparse indexes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        providerResponse(
          completion({
            tool_calls: [
              toolDelta('{"query":"first', 0),
              toolDelta('{"query":"second', 2),
            ],
          }),
          completion({ tool_calls: [{ function: { arguments: '"}' } }] }),
          completion({
            tool_calls: [{ function: { arguments: '"}' }, index: 0 }],
          }),
          completion({}, "tool_calls")
        )
      )
      .mockResolvedValueOnce(
        providerResponse(completion({ content: "Found both." }, "stop"))
      );
    const inputs: string[] = [];
    const onError = vi.fn<(event: { error: unknown }) => void>();
    const result = streamText({
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: createOpenRouter({ apiKey: "fixture", fetch }).chat(
          "openai/gpt-5.6-luna"
        ),
      }),
      onError,
      prompt: "Find messages",
      stopWhen: isLoopFinished(),
      tools: {
        search_gmail: tool({
          execute: ({ query }) => {
            inputs.push(query);
            return { messages: [] };
          },
          inputSchema: z.object({ query: z.string() }),
        }),
      },
    });
    await result.consumeStream();
    expect(inputs).toContain("first");
    expect(inputs).toContain("second");
    expect(inputs).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(result.text).resolves.toBe("Found both.");
    expect(onError).not.toHaveBeenCalled();
  });

  test("preserves a provider failure after partial input", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      providerResponse(
        completion({ tool_calls: [toolDelta('{"query":"unfinished')] }),
        completion({
          tool_calls: [{ function: { arguments: " input" }, index: 0 }],
        }),
        { error: { code: 503, message: "Upstream unavailable." } }
      )
    );
    const execute = vi.fn<() => { messages: string[] }>(() => ({
      messages: [],
    }));
    const errors: unknown[] = [];
    const result = streamText({
      model: wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: createOpenRouter({ apiKey: "fixture", fetch }).chat(
          "openai/gpt-5.6-luna"
        ),
      }),
      onError: ({ error }) => errors.push(error),
      prompt: "Find messages",
      stopWhen: isLoopFinished(),
      tools: {
        search_gmail: tool({
          execute,
          inputSchema: z.object({ query: z.string().optional() }),
        }),
      },
    });
    await result.consumeStream();
    expect(execute).not.toHaveBeenCalled();
    expect(errors).toContainEqual(expect.objectContaining({ statusCode: 503 }));
  });

  test.each(["length", "content_filter"])(
    "preserves %s cutoffs without executing partial input",
    async (finishReason) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          providerResponse(
            completion({ tool_calls: [toolDelta('{"query":"unfinished')] }),
            completion({}, finishReason)
          )
        );
      const execute = vi.fn<() => { messages: string[] }>(() => ({
        messages: [],
      }));
      const onError = vi.fn<(event: { error: unknown }) => void>();
      const result = streamText({
        model: wrapLanguageModel({
          middleware: openRouterStreamMiddleware,
          model: createOpenRouter({ apiKey: "fixture", fetch }).chat(
            "openai/gpt-5.6-luna"
          ),
        }),
        onError,
        prompt: "Find messages",
        stopWhen: isLoopFinished(),
        tools: {
          search_gmail: tool({
            execute,
            inputSchema: z.object({ query: z.string().optional() }),
          }),
        },
      });
      await result.consumeStream();
      expect(execute).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
      await expect(result.finishReason).resolves.toBe(
        finishReason.replace("_", "-")
      );
      expect(onError).not.toHaveBeenCalled();
    }
  );

  test.each([false, true])(
    "exposes raw chunks only when requested with includeRawChunks=%s",
    async (includeRawChunks) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          providerResponse(
            completion({ tool_calls: [toolDelta("{}")] }),
            completion({}, "tool_calls")
          )
        );
      const model = wrapLanguageModel({
        middleware: openRouterStreamMiddleware,
        model: createOpenRouter({ apiKey: "fixture", fetch }).chat(
          "openai/gpt-5.6-luna"
        ),
      });
      const { stream } = await model.doStream({ includeRawChunks, prompt: [] });
      const parts = [];
      for await (const part of stream) {
        parts.push(part);
      }
      expect(parts.some((part) => part.type === "raw")).toBe(includeRawChunks);
      expect(parts).toContainEqual(
        expect.objectContaining({ input: "{}", type: "tool-call" })
      );
    }
  );
});
