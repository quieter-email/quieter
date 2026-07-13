import type { ChatModel } from "@quieter/ai/chat-models";
import type { FormEvent, KeyboardEvent } from "react";
import { AiMicIcon, Loading03Icon, SentIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { AnimatePresence, m } from "motion/react";
import { AiModelSelect } from "~/features/ai/components/ai-model-select";

type ChatComposerProps = {
  disabled?: boolean;
  input: string;
  model: ChatModel;
  recording: boolean;
  recordingSupported: boolean;
  streaming: boolean;
  submitting: boolean;
  transcribing: boolean;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onModelChange: (model: ChatModel) => void;
  onRecordingStart: () => void;
  onRecordingStop: () => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export const ChatComposer = ({
  disabled,
  input,
  model,
  recording,
  recordingSupported,
  streaming,
  submitting,
  transcribing,
  onInputChange,
  onInputKeyDown,
  onModelChange,
  onRecordingStart,
  onRecordingStop,
  onStop,
  onSubmit,
}: ChatComposerProps) => (
  <m.form
    className="flex w-full flex-col rounded-xl border bg-background/85 shadow-xl squircle"
    layout
    layoutId="composer"
    onSubmit={onSubmit}
    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
  >
    <textarea
      aria-label="Message"
      className="max-h-40 min-h-18 w-full grow resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onChange={(event) => onInputChange(event.target.value)}
      onKeyDown={onInputKeyDown}
      placeholder="Ask about your mail…"
      value={input}
    />

    <AnimatePresence initial={false}>
      {recording || transcribing ? (
        <m.output
          animate={{ opacity: 1, y: 0 }}
          aria-live="polite"
          className="flex h-6 items-center gap-2 px-4 text-xs text-muted-foreground"
          exit={{ opacity: 0, y: -2 }}
          initial={{ opacity: 0, y: 2 }}
          key={recording ? "recording" : "transcribing"}
          transition={{ duration: 0.14 }}
        >
          {recording ? (
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-40" />
              <span className="relative inline-flex size-2 rounded-full bg-destructive" />
            </span>
          ) : (
            <HugeiconsIcon aria-hidden className="size-3 animate-spin" icon={Loading03Icon} />
          )}
          {recording ? "Listening…" : "Transcribing what you said…"}
        </m.output>
      ) : null}
    </AnimatePresence>

    <div className="flex items-center justify-between gap-1 px-2 pb-2">
      <AiModelSelect
        ariaLabel="Model"
        disabled={disabled}
        onValueChange={onModelChange}
        value={model}
        variant="ghost"
      />
      <div className="ml-auto flex items-center gap-1">
        {recording ? (
          <IconButtonTooltip label="Stop recording">
            <Button
              aria-label="Stop recording"
              className="shrink-0 text-destructive"
              onClick={onRecordingStop}
              size="icon"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={StopIcon} />
            </Button>
          </IconButtonTooltip>
        ) : (
          <IconButtonTooltip label={recordingSupported ? "Dictate" : "Recording unavailable"}>
            <Button
              aria-label={recordingSupported ? "Dictate" : "Recording unavailable"}
              className="shrink-0"
              disabled={disabled || transcribing || !recordingSupported}
              onClick={onRecordingStart}
              size="icon"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={AiMicIcon} />
            </Button>
          </IconButtonTooltip>
        )}

        {streaming ? (
          <IconButtonTooltip label="Stop response">
            <Button
              aria-label="Stop response"
              className="shrink-0"
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
              className="shrink-0 transition-opacity"
              disabled={disabled || submitting || recording || transcribing || !input.trim()}
              size="icon"
              type="submit"
              variant="ghost"
            >
              <HugeiconsIcon
                className={submitting ? "animate-spin" : undefined}
                icon={submitting ? Loading03Icon : SentIcon}
              />
            </Button>
          </IconButtonTooltip>
        )}
      </div>
    </div>
  </m.form>
);
