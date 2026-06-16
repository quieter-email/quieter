import { z } from "zod";

export const chatModels = [
  { label: "GPT 5.4 Nano", value: "openai/gpt-5.4-nano" },
  { label: "GPT 5.4 Mini", value: "openai/gpt-5.4-mini" },
  { label: "GPT 5.5", value: "openai/gpt-5.5" },
  { label: "Gemini 3.1 Flash Lite", value: "google/gemini-3.1-flash-lite" },
  { label: "Gemini 3.5 Flash", value: "google/gemini-3.5-flash" },
  { label: "Claude Haiku 4.5", value: "anthropic/claude-haiku-4.5" },
] as const;

export const chatModelSchema = z.enum(chatModels.map(({ value }) => value));
export type ChatModel = z.infer<typeof chatModelSchema>;

export const defaultChatModel: ChatModel = "openai/gpt-5.4-nano";
