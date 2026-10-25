import { ArrowDown01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { chatModelGroups, chatModels } from "@quieter/ai/chat-models";
import type { ChatModel, ChatModelGroup } from "@quieter/ai/chat-models";
import { ModelLabLogo } from "@quieter/app/features/chat/components/model-lab-logo";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { Input } from "@quieter/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { useState } from "react";

const labs = {
  anthropic: { keywords: "claude", label: "Anthropic" },
  deepseek: { keywords: "", label: "DeepSeek" },
  google: { keywords: "gemini", label: "Google" },
  moonshotai: { keywords: "moonshotai", label: "Moonshot" },
  openai: { keywords: "gpt chatgpt", label: "OpenAI" },
  "z-ai": { keywords: "z-ai zai", label: "Z.ai" },
} satisfies Record<ChatModelGroup, { keywords: string; label: string }>;

export const ChatModelPicker = ({
  disabled,
  model,
  onModelChange,
}: {
  disabled?: boolean;
  model: ChatModel | "auto";
  onModelChange: (model: ChatModel | "auto") => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchTerms = search.toLowerCase().trim().split(/\s+/u).filter(Boolean);
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
            `${labs[group].label} ${labs[group].keywords} ${option.label}`
              .toLowerCase()
              .includes(term)
          )
      ),
    }))
    .filter(({ options }) => options.length > 0);
  const selectedModel = chatModels.find(
    (option) =>
      option.value === model ||
      option.versions.some((version) => version === model)
  );
  const selectModel = (value: ChatModel | "auto") => {
    onModelChange(value);
    setOpen(false);
  };

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setSearch("");
        }
      }}
      open={open}
    >
      <PopoverTrigger
        aria-label="Choose model"
        disabled={disabled}
        render={<Button className="max-w-full" size="sm" variant="ghost" />}
      >
        {selectedModel ? (
          <ModelLabLogo lab={selectedModel.group} />
        ) : (
          <Icon aria-hidden icon={SparklesIcon} />
        )}
        <span className="truncate">{selectedModel?.label ?? "Auto"}</span>
        <Icon aria-hidden icon={ArrowDown01Icon} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-(--available-height) w-90 flex-col"
        collisionPadding={16}
        side="top"
        size="sm"
      >
        <PopoverTitle className="sr-only">Choose model</PopoverTitle>
        <Input
          aria-label="Search models"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            const firstMatch = groups.at(0)?.options.at(0);
            if (autoMatches) {
              selectModel("auto");
            } else if (firstMatch) {
              selectModel(firstMatch.value);
            }
          }}
          placeholder="Search models or labs…"
          size="sm"
          type="search"
          value={search}
        />
        <div className="mt-2 flex max-h-72 min-h-0 flex-col gap-2 overflow-y-auto">
          {autoMatches ? (
            <div className="flex items-start gap-2">
              <span className="flex w-24 shrink-0 items-center gap-1.5 py-1.5 text-caption text-muted-fg">
                <Icon
                  aria-hidden
                  size={14}

                  icon={SparklesIcon}
                />
                Automatic
              </span>
              <Button
                aria-pressed={model === "auto"}
                onClick={() => {
                  selectModel("auto");
                }}
                size="compact"
                variant="option"
              >
                Auto
              </Button>
            </div>
          ) : null}
          {groups.map(({ group, options }) => (
            <fieldset
              aria-label={`${labs[group].label} models`}
              className="flex items-start gap-2"
              key={group}
            >
              <span className="flex w-24 shrink-0 items-center gap-1.5 py-1.5 text-caption text-muted-fg">
                <ModelLabLogo lab={group} />
                {labs[group].label}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {options.map((option) => (
                  <Button
                    aria-label={option.label}
                    aria-pressed={selectedModel === option}
                    key={option.value}
                    onClick={() => {
                      selectModel(option.value);
                    }}
                    size="compact"
                    variant="option"
                  >
                    {option.label.replace(/^(?:Gemini|DeepSeek|GLM) /u, "")}
                  </Button>
                ))}
              </div>
            </fieldset>
          ))}
          {groups.length === 0 && !autoMatches ? (
            <output className="py-3 text-caption text-muted-fg">
              No matching models.
            </output>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
