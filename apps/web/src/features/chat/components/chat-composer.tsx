import type { FormEvent, KeyboardEvent } from "react";
import { SentIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export const ChatComposer = ({
  input,
  isLoading,
  onInputChange,
  onInputKeyDown,
  onStop,
  onSubmit,
}: ChatComposerProps) => (
  <LazyMotion features={domMax}>
    <m.form
      className="squircle flex w-full flex-col rounded-xl border bg-background/85 shadow-xl"
      layout
      layoutId="composer"
      onSubmit={onSubmit}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <textarea
        aria-label="Message"
        className="max-h-40 min-h-18 w-full grow resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isLoading}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Ask me anything..."
        value={input}
      />
      <div className="flex items-center justify-between gap-1 px-2 pb-2">
        <Select value="openrouter/free">
          <SelectTrigger aria-label="Model" disabled variant="ghost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openrouter/free">openrouter/free</SelectItem>
          </SelectContent>
        </Select>
        {isLoading ? (
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
              disabled={!input.trim()}
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
