import { z } from "zod";

export const chatModels = [
  { label: "Quick", value: "openai/gpt-5.4-nano" },
  { label: "Balanced", value: "openai/gpt-5.4-mini" },
  { label: "Deep", value: "openai/gpt-5.5" },
  { label: "Quick and concise", value: "google/gemini-3.1-flash-lite" },
  { label: "Flexible", value: "google/gemini-3.5-flash" },
  { label: "Clear and thoughtful", value: "anthropic/claude-haiku-4.5" },
] as const;

export const chatModelSchema = z.enum(chatModels.map(({ value }) => value));
export type ChatModel = z.infer<typeof chatModelSchema>;

export const defaultChatModel: ChatModel = "openai/gpt-5.4-nano";
