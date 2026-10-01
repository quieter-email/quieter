import { generateText, NoOutputGeneratedError, Output } from "ai";
import type { z } from "zod";

import { defaultChatModel } from "./chat-models";
import type { ChatModel } from "./chat-models";
import type { AiUsageReport } from "./chat-usage";
import { summarizeAiUsage } from "./chat-usage";
import { createChatModel } from "./openrouter";

const reasoningProviderOptions = (
  effort: "minimal" | "low" | "medium" | "high" | undefined
) =>
  effort === undefined
    ? {}
    : {
        providerOptions: {
          openrouter: {
            reasoning: {
              effort,
            },
          },
        },
      };

/**
 * Structured generation with one retry for empty output. The schema is enforced
 * through the AI SDK output parser, and usage across completed attempts is
 * reported once with OpenRouter cost accounting included.
 */
export const runStructuredGeneration = async <TOutput>(input: {
  abortSignal?: AbortSignal;
  maxOutputTokens: number;
  model?: ChatModel;
  onUsage?: (usage: AiUsageReport) => void;
  prioritizeLatency?: boolean;
  prompt: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  schema: z.ZodType<TOutput>;
  system: string;
}): Promise<TOutput> => {
  const steps: Parameters<typeof summarizeAiUsage>[0]["steps"][number][] = [];
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await generateText({
          ...(input.abortSignal === undefined
            ? {}
            : { abortSignal: input.abortSignal }),
          instructions: input.system,
          maxOutputTokens: input.maxOutputTokens,
          model: createChatModel(input.model ?? defaultChatModel, {
            prioritizeLatency: input.prioritizeLatency,
          }),
          onEnd: ({ steps: attemptSteps }) => {
            steps.push(...attemptSteps);
          },
          ...reasoningProviderOptions(input.reasoningEffort),
          output: Output.object({ schema: input.schema }),
          prompt: input.prompt,
        });
        return result.output;
      } catch (error) {
        if (
          attempt > 0 ||
          input.abortSignal?.aborted === true ||
          !NoOutputGeneratedError.isInstance(error)
        ) {
          throw error;
        }
      }
    }
  } finally {
    if (steps.length > 0) {
      input.onUsage?.(summarizeAiUsage({ steps }));
    }
  }
};

/** Plain-text generation variant for prompts that return prose. */
export const runTextGeneration = async (input: {
  abortSignal?: AbortSignal;
  maxOutputTokens: number;
  model?: ChatModel;
  onUsage?: (usage: AiUsageReport) => void;
  prompt: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  system: string;
}): Promise<string> => {
  const result = await generateText({
    ...(input.abortSignal === undefined
      ? {}
      : { abortSignal: input.abortSignal }),
    instructions: input.system,
    maxOutputTokens: input.maxOutputTokens,
    model: createChatModel(input.model ?? defaultChatModel),
    ...reasoningProviderOptions(input.reasoningEffort),
    prompt: input.prompt,
  });
  input.onUsage?.(summarizeAiUsage({ steps: result.steps }));
  return result.text;
};
