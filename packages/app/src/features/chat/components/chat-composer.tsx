import {
  ArrowUp02Icon,
  Loading03Icon,
  Mail01Icon,
  Mic01Icon,
  Search01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import type { ChatModel } from "@quieter/ai/chat-models";
import { ChatModelPicker } from "@quieter/app/features/chat/components/chat-model-picker";
import { getConnectorIcon } from "@quieter/app/lib/connector-icons";
import { connectorsQueryOptions } from "@quieter/app/lib/connectors-query";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  ComposerContextChip,
  PromptComposerFrame,
} from "@quieter/ui/composer-chrome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { entranceMotionVariants } from "@quieter/ui/motion";
import { Textarea } from "@quieter/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent, ReactNode, RefObject, SubmitEvent } from "react";

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
  inputRef?: RefObject<HTMLTextAreaElement | null>;
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
  const { data: connectorData } = useQuery(connectorsQueryOptions());
  const connectedAccounts =
    connectorData?.connectors.flatMap((connector) =>
      connector.accounts
        .filter((account) => account.status === "connected")
        .map((account) => ({
          account,
          displayName: connector.displayName,
          icon: getConnectorIcon(connector.provider),
        }))
    ) ?? [];
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
    <form className="mt-auto w-full shrink-0 p-0.5" onSubmit={onSubmit}>
      <PromptComposerFrame>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {contextPicker}
          {contextItems.map((item) => (
            <ComposerContextChip
              disabled={disabled}
              icon={
                <Icon
                  aria-hidden
                  size={12}

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
            className={cn(
              "px-1 text-caption text-muted-fg",
              entranceMotionVariants()
            )}
            aria-live="polite"
          >
            {recording
              ? "Listening… Finish when you're done, up to 60 seconds."
              : dictationLabel}
          </output>
        ) : null}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ChatModelPicker
              disabled={disabled}
              model={model}
              onModelChange={onModelChange}
            />
            <DropdownMenu>
              <IconButtonTooltip label="Mention connected account">
                <DropdownMenuTrigger
                  appearance="icon-transparent"
                  aria-label="Mention connected account"
                  disabled={disabled}
                  type="button"
                >
                  @
                </DropdownMenuTrigger>
              </IconButtonTooltip>
              <DropdownMenuContent align="start" size="compact">
                {connectedAccounts.length === 0 ? (
                  <p className="px-2 py-2 text-caption text-muted-fg">
                    No connected accounts
                  </p>
                ) : (
                  connectedAccounts.map(({ account, displayName, icon }) => (
                    <DropdownMenuItem
                      key={account.id}
                      onSelect={() => {
                        const start =
                          inputRef?.current?.selectionStart ?? input.length;
                        const end =
                          inputRef?.current?.selectionEnd ?? input.length;
                        const prefix = input.slice(0, start);
                        const suffix = input.slice(end);
                        const spacer =
                          prefix.length > 0 && !/\s$/u.test(prefix) ? " " : "";
                        const mention = `${spacer}@[connection:${account.id}] `;
                        onInputChange(`${prefix}${mention}${suffix}`);
                        requestAnimationFrame(() => {
                          inputRef?.current?.focus();
                          inputRef?.current?.setSelectionRange(
                            start + mention.length,
                            start + mention.length
                          );
                        });
                      }}
                    >
                      <img
                        alt=""
                        aria-hidden
                        className={cn("size-4", icon.className)}
                        src={icon.src}
                      />
                      <span className="truncate">
                        {displayName}:{" "}
                        {account.providerWorkspaceName
                          ? `${account.providerWorkspaceName}, `
                          : ""}
                        {account.accountEmail ??
                          account.displayName ??
                          "Account"}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
                <Icon
                  aria-hidden
                  animation={audioBusy ? "spin" : undefined}
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
                  <Icon aria-hidden icon={StopIcon} />
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
                  <Icon
                    aria-hidden
                    animation={submitting ? "spin" : undefined}
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
