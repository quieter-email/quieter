import { chatModelGroups, chatModels } from "@quieter/ai/chat-models";
import type { ChatModel, ChatModelGroup } from "@quieter/ai/chat-models";
import type { CommandMenuItem } from "@quieter/ui/command-menu";

export type ChatModelItem = Omit<CommandMenuItem, "icon"> & {
  kind: "model";
  lab?: ChatModelGroup;
  model: ChatModel | "auto";
};

const chatModelLabs = {
  anthropic: { keywords: "claude", label: "Anthropic" },
  google: { keywords: "gemini", label: "Google" },
  openai: { keywords: "gpt chatgpt", label: "OpenAI" },
} satisfies Record<ChatModelGroup, { keywords: string; label: string }>;

export const getSelectedChatModel = (model: ChatModel | "auto") =>
  chatModels.find(
    (option) =>
      option.value === model ||
      option.versions.some((version) => version === model)
  );

export const getChatModelItems = (query: string): ChatModelItem[] => {
  const searchTerms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const items: ChatModelItem[] = [];
  if (searchTerms.every((term) => "auto automatic".includes(term))) {
    items.push({
      group: "Models",
      id: "model-auto",
      kind: "model",
      label: "Auto",
      model: "auto",
    });
  }
  for (const group of chatModelGroups) {
    const lab = chatModelLabs[group];
    for (const option of chatModels) {
      const searchable = [
        lab.label,
        lab.keywords,
        option.label,
        option.value,
        option.value.replaceAll(/[-/]/gu, " "),
      ]
        .join(" ")
        .toLowerCase();
      if (
        option.group === group &&
        searchTerms.every((term) => searchable.includes(term))
      ) {
        items.push({
          group: lab.label,
          id: option.value,
          kind: "model",
          lab: group,
          label: option.label,
          model: option.value,
        });
      }
    }
  }
  return items;
};
