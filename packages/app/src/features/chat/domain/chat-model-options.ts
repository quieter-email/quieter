import { chatModelGroups, chatModels } from "@quieter/ai/chat-models";
import type { ChatModelGroup } from "@quieter/ai/chat-models";

export const chatModelLabs = {
  anthropic: { keywords: "claude", label: "Anthropic" },
  deepseek: { keywords: "", label: "DeepSeek" },
  google: { keywords: "gemini", label: "Google" },
  moonshotai: { keywords: "moonshotai", label: "Moonshot" },
  openai: { keywords: "gpt chatgpt", label: "OpenAI" },
  "z-ai": { keywords: "z-ai zai", label: "Z.ai" },
} satisfies Record<ChatModelGroup, { keywords: string; label: string }>;

export const getChatModelOptions = (query: string) => {
  const searchTerms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const autoMatches = searchTerms.every((term) =>
    "auto automatic".includes(term)
  );
  const groups = chatModelGroups
    .map((group) => ({
      group,
      options: chatModels.filter(
        (option) =>
          option.group === group &&
          searchTerms.every((term) =>
            `${chatModelLabs[group].label} ${chatModelLabs[group].keywords} ${option.label}`
              .toLowerCase()
              .includes(term)
          )
      ),
    }))
    .filter(({ options }) => options.length > 0);
  return { autoMatches, groups };
};
