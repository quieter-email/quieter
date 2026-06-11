import { chat, type ChatMiddleware } from "@tanstack/ai";
import { createOpenRouterAdapter } from "./openrouter";

export const generateChatTitle = async ({
  middleware,
  prompt,
}: {
  middleware?: ChatMiddleware[];
  prompt: string;
}) => {
  const title = await chat({
    adapter: createOpenRouterAdapter("openai/gpt-5-nano"),
    maxTokens: 24,
    messages: [
      {
        content: prompt,
        role: "user",
      },
    ],
    middleware,
    modelOptions: {
      reasoning: {
        effort: "minimal",
      },
    },
    stream: false,
    systemPrompts: [
      "Write a descriptive title for this chat in 2 to 5 words. Return only the title, with no quotes, markdown, or ending punctuation.",
    ],
  });

  return title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`#*\s]+|["'`#*.!?;:\s]+$/g, "")
    .slice(0, 80);
};
