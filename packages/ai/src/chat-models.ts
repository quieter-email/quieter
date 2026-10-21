import { z } from "zod";

export const chatModels = [
  {
    group: "anthropic",
    label: "Haiku",
    value: "~anthropic/claude-haiku-latest",
    versions: ["anthropic/claude-haiku-4.5"],
  },
  {
    group: "anthropic",
    label: "Sonnet",
    value: "~anthropic/claude-sonnet-latest",
    versions: ["anthropic/claude-sonnet-5"],
  },
  {
    group: "anthropic",
    label: "Opus",
    value: "~anthropic/claude-opus-latest",
    versions: ["anthropic/claude-opus-5"],
  },
  {
    group: "anthropic",
    label: "Fable",
    value: "~anthropic/claude-fable-latest",
    versions: [],
  },
  {
    group: "openai",
    label: "Luna",
    value: "~openai/gpt-luna-latest",
    versions: ["openai/gpt-5.6-luna"],
  },
  {
    group: "openai",
    label: "Terra",
    value: "~openai/gpt-terra-latest",
    versions: ["openai/gpt-5.6-terra"],
  },
  {
    group: "openai",
    label: "Sol",
    value: "~openai/gpt-sol-latest",
    versions: ["openai/gpt-5.6-sol"],
  },
  {
    group: "openai",
    label: "Astra",
    value: "~openai/gpt-astra-latest",
    versions: [],
  },
  {
    group: "google",
    label: "Gemini Flash",
    value: "~google/gemini-flash-latest",
    versions: [
      "google/gemini-2.5-flash-lite",
      "google/gemini-3.1-flash-lite",
      "google/gemini-3.5-flash-lite",
      "google/gemini-3.6-flash",
      "google/gemini-3.7-flash",
    ],
  },
  {
    group: "google",
    label: "Gemini Pro",
    value: "~google/gemini-pro-latest",
    versions: ["google/gemini-3.1-pro-preview"],
  },
  {
    group: "deepseek",
    label: "DeepSeek Flash",
    value: "~deepseek/deepseek-flash-latest",
    versions: ["deepseek/deepseek-v4-flash"],
  },
  {
    group: "deepseek",
    label: "DeepSeek Pro",
    value: "~deepseek/deepseek-pro-latest",
    versions: ["deepseek/deepseek-v4-pro"],
  },
  {
    group: "z-ai",
    label: "GLM",
    value: "~z-ai/glm-latest",
    versions: ["z-ai/glm-5.2"],
  },
  {
    group: "moonshotai",
    label: "Kimi",
    value: "~moonshotai/kimi-latest",
    versions: ["moonshotai/kimi-k3"],
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

export const defaultChatModel: ChatModel = "google/gemini-3.7-flash";
export const defaultBackgroundModel: ChatModel = "google/gemini-3.5-flash-lite";
