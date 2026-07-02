import { chat, type ChatMiddleware } from "@tanstack/ai";
import { z } from "zod";
import { createOpenRouterAdapter } from "./openrouter";

export const USER_AI_CONTEXT_MODEL = "deepseek/deepseek-v4-flash" as const;
export const USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH = 12_000;

export type UserAiContextEditorEvent = {
  id: string;
  kind: string;
  metadata: Record<string, string | number | boolean | null>;
};

const userAiContextEditorSchema = z.object({
  markdown: z.string().max(USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH),
});

export const sanitizeUserAiContextMarkdown = (markdown: string) => {
  const normalized = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return normalized.length <= USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH
    ? normalized
    : normalized.slice(0, USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH).trimEnd();
};

export const buildUserAiContextEditorInput = ({
  currentMarkdown,
  events,
}: {
  currentMarkdown: string | null;
  events: UserAiContextEditorEvent[];
}) => ({
  currentMarkdown: currentMarkdown?.slice(0, USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH) ?? "",
  events: events.map((event) => ({
    id: event.id,
    kind: event.kind,
    metadata: event.metadata,
  })),
});

export const editUserAiContext = async ({
  currentMarkdown,
  events,
  middleware,
}: {
  currentMarkdown: string | null;
  events: UserAiContextEditorEvent[];
  middleware?: ChatMiddleware[];
}) => {
  const result = await chat({
    adapter: createOpenRouterAdapter(USER_AI_CONTEXT_MODEL),
    messages: [
      {
        content: JSON.stringify(buildUserAiContextEditorInput({ currentMarkdown, events })),
        role: "user",
      },
    ],
    middleware,
    modelOptions: {
      maxCompletionTokens: 2_000,
    },
    outputSchema: userAiContextEditorSchema,
    systemPrompts: [
      `Maintain a compact Markdown preference profile for Quieter's email AI agents.

The input events are trusted compact application metadata, not raw email content. Return the full
replacement Markdown profile, not a patch.

Rules:
- Keep only durable preferences that can improve future email chat, auto-labeling, or useful-detail
  decisions.
- Prefer editing existing lines over appending new lines.
- Resolve conflicts by keeping the newest clear preference and deleting obsolete text.
- Do not store raw message bodies, secrets, authentication codes, verification codes, passwords,
  private keys, access tokens, or full thread content.
- Do not keep one-off facts, transient tasks, single email summaries, or implementation details.
- Keep the profile short, skimmable, and under the hard length limit.
- Use Markdown headings and bullets only.`,
    ],
  });

  return {
    markdown: sanitizeUserAiContextMarkdown(result.markdown),
  };
};
