import {
  AddToListIcon,
  ArrowUp02Icon,
  Cancel01Icon,
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
  ComposerDictationControl,
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
import { Text } from "@quieter/ui/text";
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
  onCancelDictation: () => void;
  placeholder?: string;
  queue?: {
    canResume: boolean;
    items: readonly { id: string; text: string }[];
    onRemove: (id: string) => void;
    onResume: () => void;
    paused: boolean;
  };
  queueing?: boolean;
  recording: boolean;
  recordingAnalyser: AnalyserNode | null;
  recordingSupported: boolean;
  startingRecording: boolean;
  streaming: boolean;
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
  onCancelDictation,
  placeholder = "Ask about your mail…",
  queue,
  queueing = false,
  recording,
  recordingAnalyser,
  recordingSupported,
  startingRecording,
  streaming,
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
  const dictationLabel = recordingSupported
    ? "Dictate"
    : "Dictation is unavailable in this browser";
  const submitLabel = queueing ? "Queue message" : "Send";

  return (
    <form className="mt-auto w-full shrink-0 p-0.5" onSubmit={onSubmit}>
      <PromptComposerFrame>
        {queue && queue.items.length > 0 ? (
          <div className="flex flex-col gap-1 pb-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <output className="text-caption text-muted-fg">
                {queue.paused ? "Queue paused" : `${queue.items.length} queued`}
              </output>
              {queue.paused ? (
                <Button
                  disabled={!queue.canResume}
                  onClick={() => {
                    queue.onResume();
                  }}
                  size="compact"
                  type="button"
                  variant="secondary"
                >
                  Resume queue
                </Button>
              ) : null}
            </div>
            <ol
              aria-label="Queued messages"
              className="max-h-28 space-y-1 overflow-y-auto overscroll-contain"
            >
              {queue.items.map((item) => (
                <li className="flex min-w-0 items-center gap-2" key={item.id}>
                  <Text
                    className="min-w-0 flex-1"
                    id={`queued-message-${item.id}`}
                    size="sm"
                    title={item.text}
                    tone="muted"
                    truncate
                  >
                    {item.text}
                  </Text>
                  <IconButtonTooltip label="Remove queued message">
                    <Button
                      aria-describedby={`queued-message-${item.id}`}
                      aria-label="Remove queued message"
                      onClick={() => {
                        queue.onRemove(item.id);
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Icon aria-hidden icon={Cancel01Icon} />
                    </Button>
                  </IconButtonTooltip>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
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
          placeholder={queueing ? "Queue a follow-up…" : placeholder}
          ref={inputRef}
          value={input}
          variant="prompt"
        />
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
              <DropdownMenuContent
                align="start"
                data-assistant-panel
                size="compact"
              >
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
            {recording || audioBusy ? (
              <ComposerDictationControl
                onCancel={onCancelDictation}
                onFinish={onToggleDictation}
                state={
                  recording
                    ? { analyser: recordingAnalyser, phase: "recording" }
                    : { phase: startingRecording ? "starting" : "transcribing" }
                }
              />
            ) : (
              <IconButtonTooltip label={dictationLabel}>
                <Button
                  aria-label={dictationLabel}
                  disabled={disabled || !recordingSupported}
                  onClick={onToggleDictation}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Icon aria-hidden icon={Mic01Icon} />
                </Button>
              </IconButtonTooltip>
            )}
            {streaming ? (
              <IconButtonTooltip label="Stop response">
                <Button
                  aria-label="Stop response"
                  onClick={onStop}
                  size="icon-sm"
                  type="button"
                  variant="secondary"
                >
                  <Icon aria-hidden icon={StopIcon} />
                </Button>
              </IconButtonTooltip>
            ) : null}
            {!streaming || queueing ? (
              <IconButtonTooltip label={submitLabel}>
                <Button
                  aria-label={submitLabel}
                  disabled={disabled || recording || audioBusy || !input.trim()}
                  size="icon-sm"
                  type="submit"
                >
                  <Icon
                    aria-hidden
                    icon={queueing ? AddToListIcon : ArrowUp02Icon}
                  />
                </Button>
              </IconButtonTooltip>
            ) : null}
          </div>
        </div>
      </PromptComposerFrame>
    </form>
  );
};
