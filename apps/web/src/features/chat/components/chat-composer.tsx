import type { ChatModel } from "@quieter/ai/chat-models";
import type { FormEvent, KeyboardEvent } from "react";
import { AiMicIcon, SentIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { domMax, LazyMotion, m } from "motion/react";
import { AiModelSelect } from "~/features/ai/components/ai-model-select";

type ChatComposerProps = {
  busy: boolean;
  disabled?: boolean;
  input: string;
  model: ChatModel;
  recording: boolean;
  recordingSupported: boolean;
  streaming: boolean;
  transcribing: boolean;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onModelChange: (model: ChatModel) => void;
  onRecordingStart: () => void;
  onRecordingStop: () => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const audioWaveBars = [
  { id: "low-left", scale: 0.42 },
  { id: "mid-left", scale: 0.7 },
  { id: "peak-left", scale: 0.95 },
  { id: "soft-left", scale: 0.58 },
  { id: "peak-right", scale: 0.82 },
  { id: "soft-right", scale: 0.48 },
  { id: "mid-right", scale: 0.72 },
  { id: "low-right", scale: 0.52 },
];

export const ChatComposer = ({
  busy,
  disabled,
  input,
  model,
  recording,
  recordingSupported,
  streaming,
  transcribing,
  onInputChange,
  onInputKeyDown,
  onModelChange,
  onRecordingStart,
  onRecordingStop,
  onStop,
  onSubmit,
}: ChatComposerProps) => {
  const audioActive = recording || transcribing;

  return (
    <LazyMotion features={domMax}>
      <m.form
        className="flex w-full flex-col rounded-xl border bg-background/85 shadow-xl squircle"
        layout
        layoutId="composer"
        onSubmit={onSubmit}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {audioActive ? (
          <output
            aria-label={recording ? "Recording audio" : "Transcribing audio"}
            className="flex min-h-18 w-full items-center justify-center px-4 pt-4 pb-2"
          >
            <div className="flex h-9 items-center gap-1.5 rounded-full border border-border/70 bg-secondary/35 px-4">
              {audioWaveBars.map((bar, index) => (
                <m.span
                  animate={{
                    scaleY: [0.35, bar.scale, 0.35],
                  }}
                  className={cn("h-6 w-1 rounded-full bg-foreground/75", {
                    "bg-primary": recording,
                    "bg-muted-foreground": transcribing,
                  })}
                  key={bar.id}
                  transition={{
                    delay: index * 0.07,
                    duration: 0.8,
                    ease: "easeInOut",
                    repeat: Infinity,
                  }}
                />
              ))}
            </div>
          </output>
        ) : (
          <textarea
            aria-label="Message"
            className="max-h-40 min-h-18 w-full grow resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || busy}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Ask me anything..."
            value={input}
          />
        )}
        <div className="flex items-center justify-between gap-1 px-2 pb-2">
          <AiModelSelect
            ariaLabel="Model"
            disabled={disabled || busy}
            onValueChange={onModelChange}
            value={model}
            variant="ghost"
          />
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
            <div className="ml-auto flex items-center gap-1">
              {recording ? (
                <IconButtonTooltip label="Stop recording">
                  <Button
                    aria-label="Stop recording"
                    className="shrink-0 text-primary"
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
                    disabled={disabled || busy || !recordingSupported}
                    onClick={onRecordingStart}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon icon={AiMicIcon} />
                  </Button>
                </IconButtonTooltip>
              )}
              <IconButtonTooltip label="Send">
                <Button
                  aria-label="Send"
                  className="shrink-0 transition-opacity"
                  disabled={disabled || busy || audioActive || !input.trim()}
                  size="icon"
                  type="submit"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={SentIcon} />
                </Button>
              </IconButtonTooltip>
            </div>
          )}
        </div>
      </m.form>
    </LazyMotion>
  );
};
