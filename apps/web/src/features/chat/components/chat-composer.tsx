import {
  ArrowDown01Icon,
  Cancel01Icon,
  Shield01Icon,
  Loading03Icon,
  Mail01Icon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Textarea } from "@quieter/ui/textarea";
import type { KeyboardEvent, SubmitEvent } from "react";

export type AssistantPolicy = "ask" | "automatic";

type ChatComposerProps = {
  contextLabel?: string;
  disabled?: boolean;
  input: string;
  onDismissContext?: () => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPolicyChange: (policy: AssistantPolicy) => void;
  onStop: () => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  policy: AssistantPolicy;
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
  onPolicyChange,
  onStop,
  onSubmit,
  policy,
  streaming,
  submitting,
}: ChatComposerProps) => (
  <form className="flex w-full shrink-0 flex-col gap-4 p-4" onSubmit={onSubmit}>
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
            <button
              aria-label="Remove message context"
              className="text-muted-fg transition-colors hover:text-fg focus-visible:outline-none"
              onClick={onDismissContext}
              type="button"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5"
                icon={Cancel01Icon}
              />
            </button>
          </IconButtonTooltip>
        )}
      </div>
    )}
    <div>
      <Textarea
        aria-label="Message"
        className="[field-sizing:content] max-h-40 min-h-[42px] resize-none rounded-[9px] border border-border/70 bg-bg/45 px-3 py-2.5 text-body-sm leading-5 shadow-none placeholder:text-muted-fg focus-visible:ring-1"
        data-assistant-composer
        disabled={disabled}
        onChange={(event) => {
          onInputChange(event.target.value);
        }}
        onKeyDown={onInputKeyDown}
        placeholder="Ask Quieter…"
        value={input}
      />
    </div>
    <div className="flex h-7 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Choose assistant change policy"
          className="flex min-w-0 items-center gap-2 rounded-md py-1 text-caption text-muted-fg transition-colors hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
          disabled={disabled}
          type="button"
        >
          <HugeiconsIcon aria-hidden className="size-3.5" icon={Shield01Icon} />
          <span>
            {policy === "ask" ? "Ask before changes" : "Auto approve"}
          </span>
          <HugeiconsIcon
            aria-hidden
            className="size-3"
            icon={ArrowDown01Icon}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" data-assistant-panel>
          <DropdownMenuItem
            onSelect={() => {
              onPolicyChange("ask");
            }}
          >
            Ask before changes
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onPolicyChange("automatic");
            }}
          >
            Auto approve
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto">
        {streaming ? (
          <IconButtonTooltip label="Stop response">
            <Button
              aria-label="Stop response"
              className="bg-muted text-fg hover:bg-control-hover"
              onClick={onStop}
              size="icon-sm"
              type="button"
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
