import { createChatSuggestionTool } from "@quieter/ai/chat-agent";
import {
  isStepCount,
  readUIMessageStream,
  simulateReadableStream,
  streamText,
  tool,
  toUIMessageStream,
} from "ai";
import type { TextStreamPart, ToolSet, UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { interruptedChatParts } from "../src/chat/continuation";
import {
  chatReplyInterruption,
  filterChatToolInputDrafts,
} from "../src/chat/reply-stream";

type ModelStreamPart =
  Awaited<
    ReturnType<MockLanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const modelStep = (...parts: ModelStreamPart[]) => ({
  stream: simulateReadableStream({ chunks: parts }),
});

const finish = (
  reason: Extract<
    ModelStreamPart,
    { type: "finish" }
  >["finishReason"]["unified"]
): ModelStreamPart => ({
  finishReason: { raw: undefined, unified: reason },
  type: "finish",
  usage: {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
    outputTokens: { reasoning: 1, text: 0, total: 1 },
  },
});

const visibleText = (message: UIMessage | undefined) =>
  message?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean) ?? [];

const readReply = async <TOOLS extends ToolSet>(
  stream: ReadableStream<TextStreamPart<TOOLS>>
) => {
  let savedMessage: UIMessage | undefined;
  let interruption: string | null = null;
  const uiStream = toUIMessageStream({
    generateMessageId: () => "reply-test",
    onEnd: ({ responseMessage, finishReason }) => {
      interruption = chatReplyInterruption(responseMessage.parts, finishReason);
      savedMessage = responseMessage;
    },
    stream: stream.pipeThrough(filterChatToolInputDrafts()),
  });
  const snapshots = await Array.fromAsync(
    readUIMessageStream({ stream: uiStream })
  );
  return { interruption, savedMessage, visibleMessage: snapshots.at(-1) };
};

describe("chat reply stream", () => {
  test.each(["stop", "eof"] as const)(
    "does not complete a search followed by an empty %s step",
    async (ending) => {
      const result = streamText({
        model: new MockLanguageModelV4({
          doStream: [
            modelStep(
              {
                input: "{}",
                toolCallId: "search",
                toolName: "search_gmail",
                type: "tool-call",
              },
              finish("tool-calls")
            ),
            modelStep(...(ending === "stop" ? [finish("stop")] : [])),
          ],
        }),
        prompt: "Find the test message.",
        stopWhen: isStepCount(2),
        tools: {
          search_gmail: tool({
            execute: () => ({ ids: ["mail-1"] }),
            inputSchema: z.object({}),
          }),
        },
      });
      const { interruption, savedMessage } = await readReply(result.stream);
      expect(interruption).not.toBeNull();
      expect(savedMessage?.parts).toContainEqual(
        expect.objectContaining({
          state: "output-available",
          toolCallId: "search",
        })
      );
    }
  );

  test("accepts a completed tool-only final step", async () => {
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: modelStep(
          {
            input: "{}",
            toolCallId: "search",
            toolName: "search_gmail",
            type: "tool-call",
          },
          finish("tool-calls")
        ),
      }),
      prompt: "Find the test message.",
      tools: {
        search_gmail: tool({
          execute: () => ({ ids: ["mail-1"] }),
          inputSchema: z.object({}),
        }),
      },
    });
    const { interruption, savedMessage } = await readReply(result.stream);
    expect(interruption).toBeNull();
    expect(savedMessage?.parts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        toolCallId: "search",
      })
    );
  });

  test("persists partial text and a cutoff status after the output limit", async () => {
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: modelStep(
          { id: "partial", type: "text-start" },
          {
            delta: "I found the first message, and",
            id: "partial",
            type: "text-delta",
          },
          { id: "partial", type: "text-end" },
          finish("length")
        ),
      }),
      prompt: "Find the test messages.",
    });
    const { interruption, savedMessage } = await readReply(result.stream);
    expect(interruption).not.toBeNull();
    const persisted = interruptedChatParts({
      errorText: interruption ?? "",
      persistedParts: [],
      retryable: true,
      streamedParts: savedMessage?.parts ?? [],
    });
    expect(persisted).toContainEqual(
      expect.objectContaining({
        text: "I found the first message, and",
        type: "text",
      })
    );
    expect(
      persisted.find((part) => part.type === "data-chat-interruption")?.data
    ).toMatch(/length limit/iu);
    expect(
      persisted.some((part) => part.type === "data-foreground-failed")
    ).toBeFalsy();
  });

  test("keeps completed results and drops an unfinished tool draft", async () => {
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: [
          modelStep(
            {
              id: "search",
              toolName: "search_gmail",
              type: "tool-input-start",
            },
            { delta: "{}", id: "search", type: "tool-input-delta" },
            { id: "search", type: "tool-input-end" },
            {
              input: "{}",
              toolCallId: "search",
              toolName: "search_gmail",
              type: "tool-call",
            },
            finish("tool-calls")
          ),
          modelStep(
            {
              id: "unfinished",
              toolName: "modify_mail_batch",
              type: "tool-input-start",
            },
            {
              delta: '{"ids":["mail',
              id: "unfinished",
              type: "tool-input-delta",
            },
            finish("length")
          ),
        ],
      }),
      prompt: "Trash all latency tests.",
      stopWhen: isStepCount(2),
      tools: {
        modify_mail_batch: tool({
          execute: ({ ids }) => ({ moved: ids }),
          inputSchema: z.object({ ids: z.array(z.string()) }),
        }),
        search_gmail: tool({
          execute: () => ({ ids: ["mail-1", "mail-2"] }),
          inputSchema: z.object({}),
        }),
      },
    });
    const { interruption, savedMessage, visibleMessage } = await readReply(
      result.stream
    );

    expect(interruption).toMatch(/length limit/iu);

    expect(visibleMessage?.parts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        toolCallId: "search",
      })
    );
    expect(visibleMessage?.parts).not.toContainEqual(
      expect.objectContaining({ toolCallId: "unfinished" })
    );
    expect(savedMessage?.parts).not.toContainEqual(
      expect.objectContaining({ toolCallId: "unfinished" })
    );
  });

  test("marks a completed search followed only by reasoning as interrupted", async () => {
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: [
          modelStep(
            { id: "preamble", type: "text-start" },
            {
              delta: "I will search for those messages.",
              id: "preamble",
              type: "text-delta",
            },
            { id: "preamble", type: "text-end" },
            {
              input: '{"query":"latency tests"}',
              toolCallId: "search-1",
              toolName: "search_gmail",
              type: "tool-call",
            },
            finish("tool-calls")
          ),
          modelStep(
            { id: "thought-1", type: "reasoning-start" },
            {
              delta: "Internal reasoning about the search results.",
              id: "thought-1",
              type: "reasoning-delta",
            },
            { id: "thought-1", type: "reasoning-end" },
            finish("stop")
          ),
        ],
      }),
      prompt: "Find latency tests.",
      stopWhen: isStepCount(2),
      tools: {
        search_gmail: tool({
          execute: ({ query }) => ({
            category: "inbox",
            fetchedAt: new Date().toISOString(),
            messages: [
              {
                id: "mail-1",
                subject: "Latency test 1",
                threadId: "thread-1",
              },
              {
                id: "mail-2",
                subject: "Latency test 2",
                threadId: "thread-2",
              },
            ],
            query,
            status: "success",
          }),
          inputSchema: z.object({ query: z.string() }),
        }),
      },
    });
    const { interruption, savedMessage, visibleMessage } = await readReply(
      result.stream
    );

    expect(interruption).not.toBeNull();

    expect(visibleMessage?.parts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        type: "tool-search_gmail",
      })
    );
    expect(savedMessage?.parts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        type: "tool-search_gmail",
      })
    );
    expect(visibleText(visibleMessage)).toContain(
      "I will search for those messages."
    );
    expect(visibleText(savedMessage)).toContain(
      "I will search for those messages."
    );
  });

  test("keeps an answer followed only by optional suggestions", async () => {
    const answer = "There are two latency tests.";
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: [
          modelStep(
            { id: "answer", type: "text-start" },
            { delta: answer, id: "answer", type: "text-delta" },
            { id: "answer", type: "text-end" },
            {
              input: JSON.stringify({
                suggestions: [{ label: "Open both", text: "Open both tests." }],
              }),
              toolCallId: "suggestions",
              toolName: "suggest_replies",
              type: "tool-call",
            },
            finish("tool-calls")
          ),
          modelStep(finish("stop")),
        ],
      }),
      prompt: "How many latency tests are there?",
      stopWhen: isStepCount(2),
      tools: createChatSuggestionTool(),
    });
    const { interruption, visibleMessage } = await readReply(result.stream);

    expect(interruption).toBeNull();
    expect(visibleText(visibleMessage)).toStrictEqual([answer]);
  });

  test.each([
    {
      approval: "not-applicable",
      state: "input-available",
      toolName: "navigate",
    },
    {
      approval: "user-approval",
      state: "approval-requested",
      toolName: "change_event",
    },
  ] as const)(
    "keeps $toolName waiting for the browser",
    async ({ approval, state, toolName }) => {
      const result = streamText({
        model: new MockLanguageModelV4({
          doStream: modelStep(
            {
              input: "{}",
              toolCallId: "pending-1",
              toolName,
              type: "tool-call",
            },
            finish("tool-calls")
          ),
        }),
        prompt: "Open the workspace or change the event.",
        toolApproval: () => approval,
        tools: {
          change_event: tool({
            execute: () => ({ status: "success" }),
            inputSchema: z.object({}),
          }),
          navigate: tool({ inputSchema: z.object({}) }),
        },
      });
      const { interruption, savedMessage, visibleMessage } = await readReply(
        result.stream
      );

      expect(interruption).toBeNull();
      expect(visibleMessage?.parts).toContainEqual(
        expect.objectContaining({ state, type: `tool-${toolName}` })
      );
      expect(visibleText(visibleMessage)).toHaveLength(0);
      expect(visibleText(savedMessage)).toHaveLength(0);
    }
  );
});
