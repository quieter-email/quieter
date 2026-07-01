import { chat, type ChatMiddleware } from "@tanstack/ai";
import { createOpenRouterAdapter } from "./openrouter";

export const TRANSCRIBED_EMAIL_FORMAT_MODEL = "openai/gpt-5-nano" as const;

export const formatTranscribedEmail = async ({
  middleware,
  transcript,
}: {
  middleware?: ChatMiddleware[];
  transcript: string;
}) => {
  const result = await chat({
    adapter: createOpenRouterAdapter(TRANSCRIBED_EMAIL_FORMAT_MODEL),
    messages: [
      {
        content: `<transcript>\n${transcript}\n</transcript>`,
        role: "user",
      },
    ],
    middleware,
    modelOptions: {
      maxCompletionTokens: 700,
      reasoning: {
        effort: "minimal",
      },
    },
    stream: false,
    systemPrompts: [
      `Rewrite the dictated transcript inside <transcript> as a clear email body.

Preserve the speaker's intent, commitments, facts, names, dates, tone, and point of view. Remove filler words, false starts, and dictation commands. Use natural paragraphs and simple line breaks when helpful.

Do not add a subject, greeting, signature, recipient, markdown, quoted transcript, or explanation unless the transcript clearly dictated those exact words. If the transcript is already clean, return it with only minimal punctuation and paragraph fixes.`,
    ],
  });

  return result.trim();
};
