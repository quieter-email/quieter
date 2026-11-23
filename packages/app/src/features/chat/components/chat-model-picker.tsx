import { ArrowDown01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { chatModels } from "@quieter/ai/chat-models";
import type { ChatModel } from "@quieter/ai/chat-models";
import { ModelLabLogo } from "@quieter/app/features/chat/components/model-lab-logo";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { CheckIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { useState } from "react";

import { getChatModelOptions } from "../domain/chat-model-options";

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
  const { autoMatches, groups } = getChatModelOptions(search);
  const options = groups.flatMap((group) => group.options);
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
        render={
          <Button className="-ms-1.25 max-w-full" size="sm" variant="ghost" />
        }
      >
        {selectedModel ? (
          <ModelLabLogo lab={selectedModel.group} />
        ) : (
          <Icon aria-hidden icon={SparklesIcon} />
        )}
        <span className="truncate">{selectedModel?.shortLabel ?? "Auto"}</span>
        <Icon aria-hidden icon={ArrowDown01Icon} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-(--available-height) flex-col"
        collisionPadding={16}
        data-assistant-panel
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
            const firstMatch = options.at(0);
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
        <div className="mt-2 flex max-h-96 min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain empty:hidden">
          {autoMatches ? (
            <Button
              aria-pressed={model === "auto"}
              className="w-full justify-start"
              onClick={() => {
                selectModel("auto");
              }}
              size="compact"
              variant="option"
            >
              <Icon aria-hidden icon={SparklesIcon} />
              <span className="min-w-0 truncate">Auto</span>
              {model === "auto" ? <CheckIcon className="ms-auto" /> : null}
            </Button>
          ) : null}
          {options.map((option) => (
            <Button
              aria-pressed={selectedModel === option}
              className="w-full justify-start"
              key={option.value}
              onClick={() => {
                selectModel(option.value);
              }}
              size="compact"
              variant="option"
            >
              <ModelLabLogo lab={option.group} />
              <span className="min-w-0 truncate">{option.label}</span>
              {selectedModel === option ? (
                <CheckIcon className="ms-auto" />
              ) : null}
            </Button>
          ))}
          {options.length === 0 && !autoMatches ? (
            <output className="py-3 text-caption text-muted-fg">
              No matching models.
            </output>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
