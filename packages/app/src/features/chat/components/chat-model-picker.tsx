import { ArrowDown01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import type { ChatModel } from "@quieter/ai/chat-models";
import { ModelLabLogo } from "@quieter/app/features/chat/components/model-lab-logo";
import { Button } from "@quieter/ui/button";
import { CommandMenu } from "@quieter/ui/command-menu";
import { Icon } from "@quieter/ui/icon";
import { CheckIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  getChatModelItems,
  getSelectedChatModel,
} from "../domain/chat-model-options";

export const CurrentChatModelMark = () => (
  <span className="flex shrink-0">
    <CheckIcon className="size-3.5" />
    <span className="sr-only">Current model</span>
  </span>
);

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
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const listId = useId();
  const items = getChatModelItems(search);
  const activeIndex = Math.max(
    0,
    items.findIndex(({ id }) => id === highlightedId)
  );
  const selectedModel = getSelectedChatModel(model);
  const currentModel = selectedModel?.value ?? "auto";

  const selectModel = (index: number) => {
    const item = items[index];
    if (item !== undefined) {
      onModelChange(item.model);
      setOpen(false);
    }
  };

  const highlightModel = (index: number) => {
    setHighlightedId(items[index]?.id ?? null);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Safari can clear isComposing before the IME confirmation key event.
    // oxlint-disable-next-line typescript/no-deprecated
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      selectModel(activeIndex);
      return;
    }
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      if (items.length > 0) {
        const nextIndex =
          (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
        highlightModel(nextIndex);
        document
          .querySelector(`#${CSS.escape(`${listId}-${nextIndex}`)}`)
          ?.scrollIntoView({ block: "nearest" });
      }
    }
  };

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setSearch("");
          setHighlightedId(null);
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
        chrome="bare"
        collisionPadding={16}
        data-assistant-panel
        side="top"
      >
        <PopoverTitle className="sr-only">Choose model</PopoverTitle>
        <CommandMenu
          activeIndex={activeIndex}
          id={listId}
          items={items.map((item) => ({
            ...item,
            icon:
              item.lab === undefined ? (
                <Icon icon={SparklesIcon} />
              ) : (
                <ModelLabLogo lab={item.lab} />
              ),
            shortcut:
              item.model === currentModel ? (
                <CurrentChatModelMark />
              ) : undefined,
          }))}
          label="Models"
          onHighlight={highlightModel}
          onSelect={selectModel}
          search={
            <Input
              aria-activedescendant={
                items.length > 0 ? `${listId}-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded={open}
              aria-label="Search models"
              autoComplete="off"
              chrome="command"
              onChange={(event) => {
                setSearch(event.target.value);
                setHighlightedId(null);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search models or labs…"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Input renders an input with an external model listbox.
              role="combobox"
              size="sm"
              value={search}
            />
          }
          selectionHint="select"
          status={items.length === 0 ? "No matching models." : undefined}
        />
      </PopoverContent>
    </Popover>
  );
};
