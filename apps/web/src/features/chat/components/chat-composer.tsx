import {
  Cancel01Icon,
  Loading03Icon,
  Mail01Icon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Textarea } from "@quieter/ui/textarea";
import type { KeyboardEvent, SubmitEvent } from "react";

type ChatComposerProps = {
  contextLabel?: string;
  disabled?: boolean;
  input: string;
  onDismissContext?: () => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  streaming: boolean;
  submitting: boolean;
};

export const ChatComposer = ({
  contextLabel,
  disabled,
  input,
  onDismissContext,
  onInputChange,
  onInputKeyDown,
  onStop,
  onSubmit,
  streaming,
  submitting,
}: ChatComposerProps) => (
  <form
    className="mt-auto flex w-full shrink-0 flex-col gap-2 p-4"
    onSubmit={onSubmit}
  >
    {contextLabel === undefined ? null : (
      <div className="flex h-4 items-center gap-2 text-caption text-muted-fg">
        <HugeiconsIcon
          aria-hidden
          className="size-3.5 shrink-0"
          icon={Mail01Icon}
        />
        <span className="min-w-0 truncate">{contextLabel}</span>
        {onDismissContext === undefined ? null : (
          <IconButtonTooltip label="Remove message context">
            <Button
              aria-label="Remove message context"
              onClick={onDismissContext}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5"
                icon={Cancel01Icon}
              />
            </Button>
          </IconButtonTooltip>
        )}
      </div>
    )}
    <div className="relative flex">
      <Textarea
        aria-label="Message"
        data-assistant-composer
        disabled={disabled}
        onChange={(event) => {
          onInputChange(event.target.value);
        }}
        onKeyDown={onInputKeyDown}
        placeholder="Ask Quieter…"
        value={input}
        variant="composer-action"
      />
      <div className="absolute right-2 bottom-2 flex">
        {streaming ? (
          <IconButtonTooltip label="Stop response">
            <Button
              aria-label="Stop response"
              onClick={onStop}
              size="icon-sm"
              type="button"
              variant="secondary"
            >
              <HugeiconsIcon aria-hidden className="size-3.5" icon={StopIcon} />
            </Button>
          </IconButtonTooltip>
        ) : (
          <IconButtonTooltip label="Send">
            <Button
              aria-label="Send"
              disabled={disabled === true || submitting || !input.trim()}
              size="icon-sm"
              type="submit"
            >
              <HugeiconsIcon
                aria-hidden
                className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
                icon={submitting ? Loading03Icon : SentIcon}
              />
            </Button>
          </IconButtonTooltip>
        )}
      </div>
    </div>
  </form>
);
