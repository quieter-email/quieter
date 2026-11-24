import { z } from "zod";

export const chatModels = [
  {
    group: "anthropic",
    label: "Claude Haiku 5.5",
    shortLabel: "Haiku",
    value: "anthropic/claude-haiku-5.5",
    versions: ["~anthropic/claude-haiku-latest", "anthropic/claude-haiku-4.5"],
  },
  {
    group: "anthropic",
    label: "Claude Sonnet 5.5",
    shortLabel: "Sonnet",
    value: "anthropic/claude-sonnet-5.5",
    versions: ["~anthropic/claude-sonnet-latest", "anthropic/claude-sonnet-5"],
  },
  {
    group: "anthropic",
    label: "Claude Opus 5.5",
    shortLabel: "Opus",
    value: "anthropic/claude-opus-5.5",
    versions: ["~anthropic/claude-opus-latest", "anthropic/claude-opus-5"],
  },
  {
    group: "openai",
    label: "GPT-6 Luna",
    shortLabel: "Luna",
    value: "openai/gpt-6-luna",
    versions: ["~openai/gpt-luna-latest", "openai/gpt-5.6-luna"],
  },
  {
    group: "openai",
    label: "GPT-6.1 Terra",
    shortLabel: "Terra",
    value: "openai/gpt-6.1-terra",
    versions: ["~openai/gpt-terra-latest", "openai/gpt-5.6-terra"],
  },
  {
    group: "openai",
    label: "GPT-6.2 Sol",
    shortLabel: "Sol",
    value: "openai/gpt-6.2-sol",
    versions: ["~openai/gpt-sol-latest", "openai/gpt-5.6-sol"],
  },
  {
    group: "openai",
    label: "GPT-6.2 Astra",
    shortLabel: "Astra",
    value: "openai/gpt-6.2-astra",
    versions: ["~openai/gpt-astra-latest"],
  },
  {
    group: "google",
    label: "Gemini 4 Hydrogen",
    shortLabel: "Hydrogen",
    value: "google/gemini-4-hydrogen",
    versions: [
      "~google/gemini-flash-latest",
      "google/gemini-3.6-flash",
      "google/gemini-3.7-flash",
      "google/gemini-3.5-flash-lite",
      "google/gemini-3.1-flash-lite",
      "google/gemini-2.5-flash-lite",
    ],
  },
  {
    group: "google",
    label: "Gemini 4 Neon",
    shortLabel: "Neon",
    value: "google/gemini-4-neon",
    versions: [],
  },
  {
    group: "google",
    label: "Gemini 4 Carbon",
    shortLabel: "Carbon",
    value: "google/gemini-4-carbon",
    versions: ["~google/gemini-pro-latest", "google/gemini-3.1-pro-preview"],
  },
  {
    group: "google",
    label: "Gemini 4 Argon",
    shortLabel: "Argon",
    value: "google/gemini-4-argon",
    versions: [],
  },
] as const;

export type ChatModelGroup = (typeof chatModels)[number]["group"];
export const chatModelGroups: readonly ChatModelGroup[] = [
  ...new Set(chatModels.map(({ group }) => group)),
];

// Pinned versions remain valid for configured background and verification work.
export const chatModelSchema = z.enum(
  chatModels.flatMap(({ value, versions }) => [value, ...versions])
);
export type ChatModel = z.infer<typeof chatModelSchema>;

export const retiredChatModelSchema = z.enum([
  "~anthropic/claude-fable-latest",
  "~deepseek/deepseek-flash-latest",
  "deepseek/deepseek-v4-flash",
  "~deepseek/deepseek-pro-latest",
  "deepseek/deepseek-v4-pro",
  "~z-ai/glm-flash-latest",
  "~z-ai/glm-latest",
  "z-ai/glm-5.2",
  "~moonshotai/kimi-latest",
  "moonshotai/kimi-k3",
]);
export const recordedChatModelSchema = chatModelSchema.or(
  retiredChatModelSchema
);

const MODEL_FALLBACK_ORDER: readonly ChatModel[] = [
  "openai/gpt-5.6-luna",
  "anthropic/claude-haiku-4.5",
  "google/gemini-3.5-flash-lite",
];

export const resolveModelFallbacks = (model: ChatModel): ChatModel[] => {
  if (model.startsWith("~")) {
    return [];
  }
  return (
    model === "google/gemini-2.5-flash-lite"
      ? (["google/gemini-3.1-flash-lite", ...MODEL_FALLBACK_ORDER] as const)
      : MODEL_FALLBACK_ORDER
  )
    .filter((fallback) => fallback !== model)
    .slice(0, 3);
};

export const defaultChatModel: ChatModel = "google/gemini-4-hydrogen";
export const defaultBackgroundModel: ChatModel = "google/gemini-3.5-flash-lite";
export const memoryLearningModel = "openai/gpt-6-luna";
export const memoryLearningMaxOutputTokens = 1300;
export type GenerationModel = ChatModel | typeof memoryLearningModel;
