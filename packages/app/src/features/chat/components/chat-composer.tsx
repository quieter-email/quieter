import {
  ArrowUp02Icon,
  Loading03Icon,
  Mail01Icon,
  Mic01Icon,
  Search01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ChatModel } from "@quieter/ai/chat-models";
import { ChatModelPicker } from "@quieter/app/features/chat/components/chat-model-picker";
import { Button } from "@quieter/ui/button";
import {
  ComposerContextChip,
  PromptComposerFrame,
} from "@quieter/ui/composer-chrome";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Textarea } from "@quieter/ui/textarea";
import type { KeyboardEvent, ReactNode, Ref, SubmitEvent } from "react";

export type ChatContextItem = {
  id: string;
  label: string;
  messageId?: string;
  query?: string;
  threadId?: string;
};

type ChatComposerProps = {
  contextItems: ChatContextItem[];
  contextPicker: ReactNode;
  disabled?: boolean;
  input: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  model: ChatModel | "auto";
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onModelChange: (model: ChatModel | "auto") => void;
  onRemoveContext: (id: string) => void;
  onStop: () => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onToggleDictation: () => void;
  placeholder?: string;
  recording: boolean;
  recordingSupported: boolean;
  startingRecording: boolean;
  streaming: boolean;
  submitting: boolean;
  transcribing: boolean;
};

export const ChatComposer = ({
  contextItems,
  contextPicker,
  disabled = false,
  input,
  inputRef,
  model,
  onInputChange,
  onInputKeyDown,
  onModelChange,
  onRemoveContext,
  onStop,
  onSubmit,
  onToggleDictation,
  placeholder = "Ask about your mail…",
  recording,
  recordingSupported,
  startingRecording,
  streaming,
  submitting,
  transcribing,
}: ChatComposerProps) => {
  const audioBusy = startingRecording || transcribing;
  let dictationIcon = Mic01Icon;
  if (audioBusy) {
    dictationIcon = Loading03Icon;
  } else if (recording) {
    dictationIcon = StopIcon;
  }
  let dictationLabel = "Dictate";
  if (!recordingSupported) {
    dictationLabel = "Dictation is unavailable in this browser";
  } else if (recording) {
    dictationLabel = "Finish dictation";
  } else if (audioBusy) {
    dictationLabel = transcribing ? "Transcribing…" : "Starting microphone…";
  }

  return (
    <form className="mt-auto w-full shrink-0 p-3" onSubmit={onSubmit}>
      <PromptComposerFrame>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {contextPicker}
          {contextItems.map((item) => (
            <ComposerContextChip
              disabled={disabled}
              icon={
                <HugeiconsIcon
                  aria-hidden
                  className="size-3 shrink-0"
                  icon={item.query === undefined ? Mail01Icon : Search01Icon}
                />
              }
              key={item.id}
              label={item.label}
              onRemove={() => {
                onRemoveContext(item.id);
              }}
            />
          ))}
        </div>
        <Textarea
          aria-label="Message"
          data-assistant-composer
          disabled={disabled}
          onChange={(event) => {
            onInputChange(event.target.value);
          }}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          value={input}
          variant="prompt"
        />
        {recording || audioBusy ? (
          <output
            className="px-1 text-caption text-muted-fg"
            aria-live="polite"
          >
            {recording
              ? "Listening… Finish when you're done, up to 60 seconds."
              : dictationLabel}
          </output>
        ) : null}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <ChatModelPicker
              disabled={disabled}
              model={model}
              onModelChange={onModelChange}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButtonTooltip label={dictationLabel}>
              <Button
                aria-label={dictationLabel}
                aria-pressed={recording}
                disabled={disabled || audioBusy || !recordingSupported}
                onClick={onToggleDictation}
                size="icon-sm"
                variant={recording ? "secondary" : "ghost"}
              >
                <HugeiconsIcon
                  aria-hidden
                  className={audioBusy ? "animate-spin" : undefined}
                  icon={dictationIcon}
                />
              </Button>
            </IconButtonTooltip>
            {streaming ? (
              <IconButtonTooltip label="Stop response">
                <Button
                  aria-label="Stop response"
                  onClick={onStop}
                  size="icon-sm"
                  variant="secondary"
                >
                  <HugeiconsIcon aria-hidden icon={StopIcon} />
                </Button>
              </IconButtonTooltip>
            ) : (
              <IconButtonTooltip label="Send">
                <Button
                  aria-label="Send"
                  disabled={
                    disabled ||
                    submitting ||
                    recording ||
                    audioBusy ||
                    !input.trim()
                  }
                  size="icon-sm"
                  type="submit"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className={submitting ? "animate-spin" : undefined}
                    icon={submitting ? Loading03Icon : ArrowUp02Icon}
                  />
                </Button>
              </IconButtonTooltip>
            )}
          </div>
        </div>
      </PromptComposerFrame>
    </form>
  );
};
