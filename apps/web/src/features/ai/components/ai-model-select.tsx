"use client";

import { chatModelGroups, chatModels, type ChatModel } from "@quieter/ai/chat-models";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  type SelectTriggerProps,
  SelectValue,
} from "@quieter/ui/select";
import { Fragment } from "react";

type AiModelSelectProps = {
  align?: "center" | "end" | "start";
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (model: ChatModel) => void;
  size?: SelectTriggerProps["size"];
  value: ChatModel;
  variant?: SelectTriggerProps["variant"];
};

export const AiModelSelect = ({
  align,
  ariaLabel,
  className,
  disabled,
  onValueChange,
  size,
  value,
  variant,
}: AiModelSelectProps) => (
  <Select
    items={chatModels.map(({ label, value: model }) => ({ label, value: model }))}
    onValueChange={(model) => {
      if (model) onValueChange(model);
    }}
    value={value}
  >
    <SelectTrigger
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      size={size}
      variant={variant}
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent align={align}>
      {chatModelGroups.map((group, index) => (
        <Fragment key={group}>
          {index > 0 && <SelectSeparator className="mx-2 my-1 h-px bg-border/70" />}
          <SelectGroup>
            {chatModels
              .filter((model) => model.group === group)
              .map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
          </SelectGroup>
        </Fragment>
      ))}
    </SelectContent>
  </Select>
);
