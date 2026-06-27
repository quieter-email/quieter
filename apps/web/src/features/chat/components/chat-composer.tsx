import type { FormEvent, KeyboardEvent } from "react";
import { SentIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { chatModels, type ChatModel } from "@quieter/ai";
import {
  Button,
  IconButtonTooltip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui";
import { domMax, LazyMotion, m } from "motion/react";

type ChatComposerProps = {
  busy: boolean;
  disabled?: boolean;
  input: string;
  model: ChatModel;
  streaming: boolean;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onModelChange: (model: ChatModel) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export const ChatComposer = ({
  busy,
  disabled,
  input,
  model,
  streaming,
  onInputChange,
  onInputKeyDown,
  onModelChange,
  onStop,
  onSubmit,
}: ChatComposerProps) => (
  <LazyMotion features={domMax}>
    <m.form
      className="flex w-full flex-col rounded-xl border bg-background/85 shadow-xl squircle"
      layout
      layoutId="composer"
      onSubmit={onSubmit}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <textarea
        aria-label="Message"
        className="max-h-40 min-h-18 w-full grow resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled || busy}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Ask me anything..."
        value={input}
      />
      <div className="flex items-center justify-between gap-1 px-2 pb-2">
        <Select
          items={chatModels.map(({ label, value }) => ({ label, value }))}
          onValueChange={(value) => {
            if (value) onModelChange(value);
          }}
          value={model}
        >
          <SelectTrigger aria-label="Model" disabled={disabled || busy} variant="ghost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {chatModels.map((model) => (
              <SelectItem key={model.value} value={model.value}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {streaming ? (
          <IconButtonTooltip label="Stop">
            <Button
              aria-label="Stop"
              className="ml-auto shrink-0"
              onClick={onStop}
              size="icon"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={StopIcon} />
            </Button>
          </IconButtonTooltip>
        ) : (
          <IconButtonTooltip label="Send">
            <Button
              aria-label="Send"
              className="ml-auto shrink-0 transition-opacity"
              disabled={disabled || busy || !input.trim()}
              size="icon"
              type="submit"
              variant="ghost"
            >
              <HugeiconsIcon icon={SentIcon} />
            </Button>
          </IconButtonTooltip>
        )}
      </div>
    </m.form>
  </LazyMotion>
);
