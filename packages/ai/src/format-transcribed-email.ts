import type { AiUsageReport } from "./chat-usage";
import { runTextGeneration } from "./generation";

export { TRANSCRIBED_EMAIL_FORMAT_MODEL } from "./chat-models";

export const formatTranscribedEmail = async ({
  memoryContext,
  onUsage,
  transcript,
}: {
  memoryContext?: string | null;
  onUsage?: (usage: AiUsageReport) => void;
  transcript: string;
}) => {
  const result = await runTextGeneration({
    maxOutputTokens: 700,
    ...(onUsage === undefined ? {} : { onUsage }),
    prompt: `<transcript>\n${transcript}\n</transcript>`,
    reasoningEffort: "minimal",
    system: `Rewrite the dictated transcript inside <transcript> as a clear email body.

Preserve the speaker's intent, commitments, facts, names, dates, tone, and point of view. Remove filler words, false starts, and dictation commands. Use natural paragraphs and simple line breaks when helpful.

Do not add a subject, greeting, signature, recipient, markdown, quoted transcript, or explanation unless the transcript clearly dictated those exact words. If the transcript is already clean, return it with only minimal punctuation and paragraph fixes.${
      memoryContext !== null &&
      memoryContext !== undefined &&
      memoryContext !== ""
        ? `

Use the following dynamically selected instructions and learned communication style only
to resolve stylistic choices that the transcript leaves open. User-authored instructions override
learned preferences, and mailbox instructions override personal instructions. Never use memory to
add facts, commitments, recipients, greetings, or signatures.\n\n${memoryContext.slice(0, 6000)}`
        : ""
    }`,
  });

  return result.trim();
};
