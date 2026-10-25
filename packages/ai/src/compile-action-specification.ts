import { generateText, jsonSchema, Output, zodSchema } from "ai";

import { actionSpecificationSchema } from "./action-specification";
import type { ActionSpecification } from "./action-specification";
import type { ChatModel } from "./chat-models";
import { summarizeAiUsage } from "./chat-usage";
import type { AiUsageReport } from "./chat-usage";
import { createChatModel } from "./openrouter";

const replaceExclusiveUnions = (value: unknown) => {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if ("oneOf" in value) {
    Reflect.set(value, "anyOf", value.oneOf);
    Reflect.deleteProperty(value, "oneOf");
  }
  for (const nested of Object.values(value)) {
    replaceExclusiveUnions(nested);
  }
};

export const actionGenerationSchema = jsonSchema<ActionSpecification>(
  async () => {
    const schema = structuredClone(
      await zodSchema(actionSpecificationSchema).jsonSchema
    );
    replaceExclusiveUnions(schema);
    return schema;
  },
  {
    validate: (value) => {
      const parsed = actionSpecificationSchema.safeParse(value);
      return parsed.success
        ? { success: true, value: parsed.data }
        : { error: parsed.error, success: false };
    },
  }
);

export const compileActionSpecification = async (input: {
  abortSignal: AbortSignal;
  model: ChatModel;
  onUsage: (usage: AiUsageReport) => void;
  prompt: string;
  system: string;
}) => {
  const result = await generateText({
    abortSignal: input.abortSignal,
    instructions: input.system,
    maxOutputTokens: 6000,
    maxRetries: 0,
    model: createChatModel(input.model),
    onEnd: ({ steps }) => {
      input.onUsage(summarizeAiUsage({ steps }));
    },
    output: Output.object({ schema: actionGenerationSchema }),
    prompt: input.prompt,
  });
  return actionSpecificationSchema.parse(result.output);
};
