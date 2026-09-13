import { z } from "zod";

export const chatModels = [
  {
    group: "openai",
    label: "GPT 5.6 Luna",
    value: "openai/gpt-5.6-luna",
  },
  {
    group: "openai",
    label: "GPT 5.6 Terra",
    value: "openai/gpt-5.6-terra",
  },
  {
    group: "openai",
    label: "GPT 5.6 Sol",
    value: "openai/gpt-5.6-sol",
  },
  {
    group: "anthropic",
    label: "Claude Haiku 4.5",
    value: "anthropic/claude-haiku-4.5",
  },
  {
    group: "anthropic",
    label: "Claude Sonnet 5",
    value: "anthropic/claude-sonnet-5",
  },
  {
    group: "anthropic",
    label: "Claude Opus 5",
    value: "anthropic/claude-opus-5",
  },
  {
    group: "google",
    label: "Gemini 3.5 Flash Lite",
    value: "google/gemini-3.5-flash-lite",
  },
  {
    group: "google",
    label: "Gemini 3.6 Flash",
    value: "google/gemini-3.6-flash",
  },
  {
    group: "google",
    label: "Gemini 3.7 Flash",
    value: "google/gemini-3.7-flash",
  },
  {
    group: "google",
    label: "Gemini 3.1 Pro",
    value: "google/gemini-3.1-pro-preview",
  },
  {
    group: "deepseek",
    label: "DeepSeek V4 Flash",
    value: "deepseek/deepseek-v4-flash",
  },
  {
    group: "deepseek",
    label: "DeepSeek V4 Pro",
    value: "deepseek/deepseek-v4-pro",
  },
  {
    group: "deepseek",
    label: "GLM 5.2",
    value: "z-ai/glm-5.2",
  },
  {
    group: "deepseek",
    label: "Kimi K3",
    value: "moonshotai/kimi-k3",
  },
] as const;

export type ChatModelGroup = (typeof chatModels)[number]["group"];
export const chatModelGroups: readonly ChatModelGroup[] = [
  ...new Set(chatModels.map(({ group }) => group)),
];

export const chatModelSchema = z.enum(chatModels.map(({ value }) => value));
export type ChatModel = (typeof chatModels)[number]["value"];

/**
 * Big-provider failover order for OpenRouter's `models` fallback routing.
 * OpenRouter tries these in order when the primary errors, including on
 * rate limits and downtime, and bills whichever model ultimately serves.
 * The primary is always filtered out by `resolveModelFallbacks`.
 */
const MODEL_FALLBACK_ORDER: readonly ChatModel[] = [
  "openai/gpt-5.6-luna",
  "anthropic/claude-haiku-4.5",
  "google/gemini-3.5-flash-lite",
];

export const resolveModelFallbacks = (model: ChatModel): ChatModel[] =>
  MODEL_FALLBACK_ORDER.filter((fallback) => fallback !== model);

export const defaultChatModel: ChatModel = "google/gemini-3.7-flash";
export const defaultBackgroundModel: ChatModel = "google/gemini-3.5-flash-lite";
