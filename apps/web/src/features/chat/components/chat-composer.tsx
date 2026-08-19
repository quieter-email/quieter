import {
  AiMicIcon,
  Loading03Icon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ChatModel } from "@quieter/ai/chat-models";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { TokenField } from "@quieter/ui/token-field";
import type { TokenFieldToken } from "@quieter/ui/token-field";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import type { KeyboardEvent, SubmitEvent } from "react";

import { AiModelSelect } from "#/features/ai/components/ai-model-select";
import { getAppPresenceMotion } from "#/features/motion/app-motion";

type ChatComposerProps = {
  connectorTokens: TokenFieldToken[];
  disabled?: boolean;
  input: string;
  model: ChatModel;
  recording: boolean;
  recordingSupported: boolean;
  streaming: boolean;
  submitting: boolean;
  transcribing: boolean;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onModelChange: (model: ChatModel) => void;
  onRecordingStart: () => void;
  onRecordingStop: () => void;
  onStop: () => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
};

const ChatComposerStatus = ({
  recording,
  shouldReduceMotion,
  statusMotion,
  transcribing,
}: {
  recording: boolean;
  shouldReduceMotion: boolean | null;
  statusMotion: ReturnType<typeof getAppPresenceMotion>;
  transcribing: boolean;
}) => (
  <AnimatePresence initial={false}>
    {recording || transcribing ? (
      <m.output
        {...statusMotion}
        aria-live="polite"
        className="flex h-6 items-center gap-2 px-4 text-caption text-muted-fg"
        key={recording ? "recording" : "transcribing"}
      >
        {recording ? (
          <span className="relative flex size-2" aria-hidden>
            {shouldReduceMotion === true ? null : (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-40" />
            )}
            <span className="relative inline-flex size-2 rounded-full bg-destructive" />
          </span>
        ) : (
          <HugeiconsIcon
            aria-hidden
            className={
              shouldReduceMotion === true ? "size-3" : "size-3 animate-spin"
            }
            icon={Loading03Icon}
          />
        )}
        {recording ? "Listening…" : "Transcribing what you said…"}
      </m.output>
    ) : null}
  </AnimatePresence>
);

export const ChatComposer = ({
  connectorTokens,
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
}: ChatComposerProps) => {
  const shouldReduceMotion = useReducedMotion();
  const statusMotion = getAppPresenceMotion({
    distance: 2,
    reducedMotion: shouldReduceMotion,
  });

  return (
    <form
      className="squircle flex w-full flex-col rounded-xl border border-border bg-bg/85 shadow-xl has-[[data-slot=token-field-input]:focus-visible]:border-ring has-[[data-slot=token-field-input]:focus-visible]:ring-1 has-[[data-slot=token-field-input]:focus-visible]:ring-ring/45 has-[[data-slot=token-field-input]:focus-visible]:outline-none"
      onSubmit={onSubmit}
    >
      <div className="px-4 pt-4 pb-2">
        <TokenField
          aria-label="Message"
          className="max-h-40 min-h-14 overflow-y-auto text-body data-[empty=true]:before:text-muted-fg/50"
          disabled={disabled}
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          placeholder="Ask about your mail…"
          suggestionsLabel="Connectors"
          suggestionsSide="top"
          tokens={connectorTokens}
          value={input}
        />
      </div>

      <ChatComposerStatus
        recording={recording}
        shouldReduceMotion={shouldReduceMotion}
        statusMotion={statusMotion}
        transcribing={transcribing}
      />

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
            <IconButtonTooltip
              label={recordingSupported ? "Dictate" : "Recording unavailable"}
            >
              <Button
                aria-label={
                  recordingSupported ? "Dictate" : "Recording unavailable"
                }
                className="shrink-0"
                disabled={
                  disabled === true || transcribing || !recordingSupported
                }
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
                disabled={
                  disabled === true ||
                  submitting ||
                  recording ||
                  transcribing ||
                  !input.trim()
                }
                size="icon"
                type="submit"
                variant="ghost"
              >
                <HugeiconsIcon
                  className={
                    submitting && shouldReduceMotion !== true
                      ? "animate-spin"
                      : undefined
                  }
                  icon={submitting ? Loading03Icon : SentIcon}
                />
              </Button>
            </IconButtonTooltip>
          )}
        </div>
      </div>
    </form>
  );
};
