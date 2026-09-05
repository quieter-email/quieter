import { generateText, isStepCount, Output } from "ai";
import type { ToolSet } from "ai";
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
 * One structured generation against a chat model. The schema is enforced
 * through the AI SDK output parser, and usage is reported once with OpenRouter
 * cost accounting included.
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
  const result = await generateText({
    ...(input.abortSignal === undefined
      ? {}
      : { abortSignal: input.abortSignal }),
    instructions: input.system,
    maxOutputTokens: input.maxOutputTokens,
    model: createChatModel(input.model ?? defaultChatModel, {
      prioritizeLatency: input.prioritizeLatency,
    }),
    ...reasoningProviderOptions(input.reasoningEffort),
    output: Output.object({ schema: input.schema }),
    prompt: input.prompt,
  });
  input.onUsage?.(summarizeAiUsage({ steps: result.steps }));
  return result.output;
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

/**
 * Agentic generation: the model may call tools for up to `maxSteps` steps and
 * must finish with a value matching the schema. Structured output counts as
 * its own step, so callers budget accordingly.
 */
export const runStructuredAgentGeneration = async <TOutput>(input: {
  abortSignal?: AbortSignal;
  maxOutputTokens: number;
  maxSteps: number;
  model?: ChatModel;
  onUsage?: (usage: AiUsageReport) => void;
  prompt: string;
  schema: z.ZodType<TOutput>;
  system: string;
  tools: ToolSet;
}): Promise<TOutput> => {
  const result = await generateText({
    ...(input.abortSignal === undefined
      ? {}
      : { abortSignal: input.abortSignal }),
    instructions: input.system,
    maxOutputTokens: input.maxOutputTokens,
    model: createChatModel(input.model ?? defaultChatModel),
    output: Output.object({ schema: input.schema }),
    prompt: input.prompt,
    stopWhen: isStepCount(input.maxSteps),
    tools: input.tools,
  });
  input.onUsage?.(summarizeAiUsage({ steps: result.steps }));
  return result.output;
};
