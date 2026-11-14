import {
  AddToListIcon,
  ArrowUp02Icon,
  Cancel01Icon,
  Mail01Icon,
  Mic01Icon,
  NoteIcon,
  Search01Icon,
  SparklesIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import type { ChatModel } from "@quieter/ai/chat-models";
import { ChatModelPicker } from "@quieter/app/features/chat/components/chat-model-picker";
import { ModelLabLogo } from "@quieter/app/features/chat/components/model-lab-logo";
import { getConnectorIcon } from "@quieter/app/lib/connector-icons";
import { connectorsQueryOptions } from "@quieter/app/lib/connectors-query";
import { orpc } from "@quieter/app/lib/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { CommandMenu } from "@quieter/ui/command-menu";
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
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject, SubmitEvent } from "react";

import {
  getChatSlashCommand,
  getChatSlashItems,
} from "../domain/chat-slash-commands";

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
  mailboxId: string;
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

type CommandCursor = {
  end: number;
  highlightedId?: string;
  phase: "focused" | "blurred" | "dismissed";
  start: number;
};

export const ChatComposer = ({
  contextItems,
  contextPicker,
  disabled = false,
  input,
  inputRef,
  mailboxId,
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
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? localInputRef;
  const listId = useId();
  const [cursor, setCursor] = useState<CommandCursor | null>(null);
  const command =
    disabled || cursor === null || cursor.phase === "dismissed"
      ? null
      : getChatSlashCommand(input, cursor.start, cursor.end);
  const snippets = useQuery({
    ...orpc.mailSnippets.list.queryOptions({ input: { mailboxId } }),
    enabled:
      command !== null &&
      command.kind !== "model" &&
      cursor?.phase === "focused",
  });
  const commands =
    command === null
      ? []
      : getChatSlashItems(command, snippets.data?.snippets ?? []);
  const commandOpen =
    command !== null && (command.kind !== "commands" || commands.length > 0);
  const menuVisible = commandOpen && cursor?.phase === "focused";
  const activeIndex = Math.max(
    0,
    commands.findIndex(({ id }) => id === cursor?.highlightedId)
  );
  let commandStatus: string | undefined;
  if (command?.kind === "snippet") {
    if (snippets.isFetching) {
      commandStatus = "Loading snippets…";
    } else if (snippets.isError) {
      commandStatus = "Could not load snippets.";
    }
  }
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
  let submitLabel = queueing ? "Queue message" : "Send";
  if (commandOpen) {
    submitLabel = "Select command";
  }

  const captureCursor = (target: HTMLTextAreaElement) => {
    const { selectionStart: start, selectionEnd: end } = target;
    setCursor((current) =>
      current?.start === start &&
      current.end === end &&
      current.phase !== "blurred"
        ? current
        : { end, phase: "focused", start }
    );
  };

  const selectCommand = (index: number) => {
    const item = commands[index];
    if (command === null || item === undefined) {
      return;
    }
    let replacement = "";
    if (item.kind === "search") {
      replacement = `/${item.command} `;
    } else if (item.kind === "snippet") {
      replacement = item.text;
    }
    const position = command.from + replacement.length;
    setCursor({
      end: position,
      phase: item.kind === "search" ? "focused" : "dismissed",
      start: position,
    });
    onInputChange(
      `${input.slice(0, command.from)}${replacement}${input.slice(command.to)}`
    );
    if (item.kind === "model") {
      onModelChange(item.model);
    }
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      target?.setSelectionRange(position, position);
      target?.focus();
    });
  };

  const highlightCommand = (index: number) => {
    const item = commands[index];
    if (item !== undefined) {
      setCursor((current) =>
        current === null || current.highlightedId === item.id
          ? current
          : { ...current, highlightedId: item.id }
      );
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Safari can clear isComposing before the IME confirmation key event.
    // oxlint-disable-next-line typescript/no-deprecated
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (menuVisible) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setCursor((current) =>
          current === null ? null : { ...current, phase: "dismissed" }
        );
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        selectCommand(activeIndex);
        return;
      }
      if (
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        if (commands.length > 0) {
          const nextIndex =
            (activeIndex +
              (event.key === "ArrowDown" ? 1 : -1) +
              commands.length) %
            commands.length;
          highlightCommand(nextIndex);
          document
            .querySelector(`#${CSS.escape(`${listId}-${nextIndex}`)}`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
    }
    onInputKeyDown(event);
  };

  return (
    <form
      className="mt-auto w-full shrink-0 p-0.5"
      onSubmit={(event) => {
        if (commandOpen) {
          event.preventDefault();
          selectCommand(activeIndex);
        } else {
          onSubmit(event);
        }
      }}
    >
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
        <div className="relative flex flex-col">
          <Textarea
            aria-activedescendant={
              menuVisible && commands.length > 0
                ? `${listId}-${activeIndex}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={menuVisible ? listId : undefined}
            aria-label="Message"
            data-assistant-composer
            disabled={disabled}
            onBlur={(event) => {
              const target = event.relatedTarget;
              if (
                target !== null &&
                event.currentTarget.parentElement?.contains(target) === true
              ) {
                return;
              }
              setCursor((current) =>
                current?.phase === "focused"
                  ? { ...current, phase: "blurred" }
                  : current
              );
            }}
            onChange={(event) => {
              const {
                selectionStart: start,
                selectionEnd: end,
                value,
              } = event.currentTarget;
              setCursor({ end, phase: "focused", start });
              onInputChange(value);
            }}
            onFocus={(event) => {
              captureCursor(event.currentTarget);
            }}
            onKeyDown={handleInputKeyDown}
            onSelect={(event) => {
              captureCursor(event.currentTarget);
            }}
            placeholder={queueing ? "Queue a follow-up…" : placeholder}
            ref={textareaRef}
            value={input}
            variant="prompt"
          />
          {menuVisible ? (
            <div className="absolute start-0 bottom-full z-50 mb-1">
              <CommandMenu
                activeIndex={activeIndex}
                id={listId}
                items={commands.map((item) => {
                  if (item.kind === "model" && item.lab !== undefined) {
                    return { ...item, icon: <ModelLabLogo lab={item.lab} /> };
                  }
                  const isSnippet =
                    item.kind === "snippet" ||
                    (item.kind === "search" && item.command === "snippet");
                  return {
                    ...item,
                    icon: <Icon icon={isSnippet ? NoteIcon : SparklesIcon} />,
                  };
                })}
                label="Chat commands"
                onHighlight={highlightCommand}
                onSelect={selectCommand}
                selectionHint="select"
                status={commandStatus}
              />
            </div>
          ) : null}
        </div>
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
                          textareaRef.current?.selectionStart ?? input.length;
                        const end =
                          textareaRef.current?.selectionEnd ?? input.length;
                        const prefix = input.slice(0, start);
                        const suffix = input.slice(end);
                        const spacer =
                          prefix.length > 0 && !/\s$/u.test(prefix) ? " " : "";
                        const mention = `${spacer}@[connection:${account.id}] `;
                        onInputChange(`${prefix}${mention}${suffix}`);
                        requestAnimationFrame(() => {
                          textareaRef.current?.focus();
                          textareaRef.current?.setSelectionRange(
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
                  disabled={
                    disabled ||
                    recording ||
                    audioBusy ||
                    !input.trim() ||
                    (commandOpen && commands.length === 0)
                  }
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
