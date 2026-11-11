import { createChatSuggestionTool } from "@quieter/ai/chat-agent";
import type { ChatMessagePart } from "@quieter/database/schema";
import { isLoopFinished, simulateReadableStream, streamText, tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createChatStepProgress } from "../src/chat/step-progress";

type ModelStreamPart =
  Awaited<
    ReturnType<MockLanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const modelStep = (
  finishReason: "stop" | "tool-calls",
  ...parts: ModelStreamPart[]
) => ({
  stream: simulateReadableStream<ModelStreamPart>({
    chunks: [
      ...parts,
      {
        finishReason: { raw: undefined, unified: finishReason },
        type: "finish",
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
          outputTokens: { reasoning: 0, text: 1, total: 1 },
        },
      },
    ],
  }),
});

const answer = (text: string) =>
  modelStep(
    "stop",
    { id: "answer", type: "text-start" },
    { delta: text, id: "answer", type: "text-delta" },
    { id: "answer", type: "text-end" }
  );

const searchPage = (page: number, callId: string): ModelStreamPart => ({
  input: JSON.stringify({ page }),
  toolCallId: callId,
  toolName: "search_gmail",
  type: "tool-call",
});

const modelWithEarlySummary = (steps: ReturnType<typeof modelStep>[]) => {
  const working = new MockLanguageModelV4({ doStream: steps });
  const summarizing = new MockLanguageModelV4({
    doStream: answer("I could not find more mail."),
  });
  return new MockLanguageModelV4({
    doStream: async (options) =>
      await (
        options.toolChoice?.type === "none" ? summarizing : working
      ).doStream(options),
  });
};

const runChat = async (
  model: MockLanguageModelV4,
  tools: ToolSet,
  previousParts?: readonly ChatMessagePart[]
) => {
  const progress = createChatStepProgress(
    new Set(["modify_mail"]),
    previousParts
  );
  const result = streamText({
    abortSignal: AbortSignal.timeout(2000),
    model,
    onStepEnd: progress.recordStep,
    prepareStep: () =>
      progress.shouldWrapUp ? { toolChoice: "none" } : undefined,
    prompt: "Process the mail search results and report what happened.",
    stopWhen: isLoopFinished(),
    tools,
  });
  await result.consumeStream();
  return await result.text;
};

describe("chat step progress", () => {
  test("reads all pages when useful tool work continues past six rounds", async () => {
    const pages = [1, 2, 3, 4, 5, 6, 7, 8];
    const read = new Set<number>();
    const text = await runChat(
      new MockLanguageModelV4({
        doStream: [
          ...pages.map((page) =>
            modelStep("tool-calls", searchPage(page, `page-${page}`))
          ),
          answer("I read all the pages."),
        ],
      }),
      {
        search_gmail: tool({
          execute: ({ page }) => {
            read.add(page);
            return { messages: [`mail-${page}`] };
          },
          inputSchema: z.object({ page: z.number() }),
        }),
      }
    );

    expect([...read]).toStrictEqual(pages);
    expect(text).toMatch(/read all the pages/u);
  });

  test("summarizes a repeated search with changing timestamps and suggestions", async () => {
    let reads = 0;
    const text = await runChat(
      modelWithEarlySummary(
        Array.from({ length: 8 }, (_, index) =>
          modelStep("tool-calls", searchPage(1, `repeat-${index}`), {
            input: JSON.stringify({
              suggestions: [
                { label: `Mail ${index}`, text: `Show mail ${index}` },
              ],
            }),
            toolCallId: `suggestion-${index}`,
            toolName: "suggest_replies",
            type: "tool-call",
          })
        )
      ),
      {
        ...createChatSuggestionTool(),
        search_gmail: tool({
          execute: () => {
            reads += 1;
            return {
              fetchedAt: new Date(reads).toISOString(),
              messages: ["same-mail"],
            };
          },
          inputSchema: z.object({ page: z.number() }),
        }),
      }
    );

    expect(reads).toBeGreaterThan(1);
    expect(text).toMatch(/could not find more mail/u);
  });

  test("allows the same read again after a confirmed change", async () => {
    let didChange = false;
    const readAfterChange = new Set<number>();
    const text = await runChat(
      modelWithEarlySummary([
        modelStep("tool-calls", searchPage(1, "before")),
        modelStep("tool-calls", {
          input: '{"id":"mail-1"}',
          toolCallId: "write",
          toolName: "modify_mail",
          type: "tool-call",
        }),
        modelStep("tool-calls", searchPage(1, "after")),
        modelStep("tool-calls", searchPage(1, "verify")),
        modelStep("tool-calls", searchPage(2, "next-page")),
        answer("I checked the mailbox after the change."),
      ]),
      {
        modify_mail: tool({
          execute: () => {
            didChange = true;
            return { status: "success" };
          },
          inputSchema: z.object({ id: z.string() }),
        }),
        search_gmail: tool({
          execute: ({ page }) => {
            if (didChange) {
              readAfterChange.add(page);
            }
            return { messages: [`mail-${page}`] };
          },
          inputSchema: z.object({ page: z.number() }),
        }),
      }
    );

    expect([...readAfterChange]).toStrictEqual([1, 2]);
    expect(text).toMatch(/checked the mailbox after the change/u);
  });

  test.each([
    { lastThread: "first", report: /could not find more mail/u },
    { lastThread: "second", report: /read the current message/u },
  ])(
    "carries progress into a continuation with thread $lastThread",
    async ({ lastThread, report }) => {
      const previousParts = ["first", "first", "first", lastThread].flatMap(
        (selectedThreadId, index) => [
          { type: "step-start" },
          {
            input: {},
            output: { generation: 1, mailboxId: "mailbox", selectedThreadId },
            state: "output-available",
            toolCallId: `workspace-${index}`,
            type: "tool-get_workspace",
          },
        ]
      );
      const text = await runChat(
        modelWithEarlySummary([answer("I read the current message.")]),
        { get_workspace: tool({ inputSchema: z.object({}) }) },
        previousParts
      );

      expect(text).toMatch(report);
    }
  );
});
