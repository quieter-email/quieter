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
import {
  ChatModelPicker,
  CurrentChatModelMark,
} from "@quieter/app/features/chat/components/chat-model-picker";
import { ModelLabLogo } from "@quieter/app/features/chat/components/model-lab-logo";
import { getConnectorIcon } from "@quieter/app/lib/connector-icons";
import { connectorsQueryOptions } from "@quieter/app/lib/connectors-query";
import { orpc } from "@quieter/app/lib/orpc";
import { connectorMentionPattern } from "@quieter/orpc/mail-agent/contracts";
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
import { TokenField } from "@quieter/ui/token-field";
import type {
  TokenFieldHandle,
  TokenFieldToken,
} from "@quieter/ui/token-field";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject, SubmitEvent } from "react";

import { getSelectedChatModel } from "../domain/chat-model-options";
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
  sendDisabled?: boolean;
  input: string;
  inputRef: RefObject<TokenFieldHandle | null>;
  mailboxId: string;
  model: ChatModel | "auto";
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
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
  sendDisabled = false,
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
  const listId = useId();
  const [cursor, setCursor] = useState<CommandCursor | null>(null);
  const selectionRef = useRef<{ end: number; start: number } | undefined>(
    undefined
  );
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
  } else if (command?.kind === "model" && commands.length === 0) {
    commandStatus = "No matching models.";
  }
  const currentModel = getSelectedChatModel(model)?.value ?? "auto";
  const { data: connectorData } = useQuery(connectorsQueryOptions());
  const connectedAccounts: TokenFieldToken[] =
    connectorData?.connectors.flatMap((connector) =>
      connector.accounts
        .filter((account) => account.status === "connected")
        .map((account) => {
          const icon = getConnectorIcon(connector.provider);
          const workspace = account.providerWorkspaceName;
          const name = account.accountEmail ?? account.displayName ?? "Account";
          return {
            iconClassName: cn("size-4", icon.className),
            iconSrc: icon.src,
            id: account.id,
            label: `${connector.displayName}: ${workspace ? `${workspace}, ` : ""}${name}`,
            match: "literal",
            text: `@[connection:${account.id}]`,
          };
        })
    ) ?? [];
  const accountsByText = new Map(
    connectedAccounts.map((account) => [account.text, account])
  );
  const tokens = [...connectedAccounts];
  for (const [mention] of input.matchAll(connectorMentionPattern)) {
    if (!tokens.some((token) => token.text === mention)) {
      tokens.push({
        id: mention,
        label: "Unavailable account",
        match: "literal",
        text: mention,
        tone: "orange",
      });
    }
  }
  const audioBusy = startingRecording || transcribing;
  const dictationLabel = recordingSupported
    ? "Dictate"
    : "Dictation is unavailable in this browser";
  let submitLabel = queueing ? "Queue message" : "Send";
  if (commandOpen) {
    submitLabel = "Select command";
  }

  const captureCursor = (selection: { end: number; start: number }) => {
    selectionRef.current = selection;
    const { end, start } = selection;
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
    inputRef.current?.replaceRange(
      { end: command.to, start: command.from },
      replacement
    );
    setCursor({
      end: position,
      phase: item.kind === "search" ? "focused" : "dismissed",
      start: position,
    });
    if (item.kind === "model") {
      onModelChange(item.model);
    }
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

  const handleInputKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
      className="mt-auto w-full shrink-0 p-2"
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
              {queue.items.map((item) => {
                const preview = item.text.replaceAll(
                  connectorMentionPattern,
                  (mention) =>
                    accountsByText.get(mention)?.label ?? "Unavailable account"
                );
                return (
                  <li className="flex min-w-0 items-center gap-2" key={item.id}>
                    <Text
                      className="min-w-0 flex-1"
                      id={`queued-message-${item.id}`}
                      size="sm"
                      title={preview}
                      tone="muted"
                      truncate
                    >
                      {preview}
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
                );
              })}
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
        <div
          className="relative flex flex-col"
          data-assistant-composer
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setCursor((current) =>
                current?.phase === "focused"
                  ? { ...current, phase: "blurred" }
                  : current
              );
            }
          }}
        >
          <TokenField
            aria-activedescendant={
              menuVisible && commands.length > 0
                ? `${listId}-${activeIndex}`
                : undefined
            }
            aria-controls={menuVisible ? listId : undefined}
            aria-label="Message"
            disabled={disabled}
            onChange={(value, selection) => {
              selectionRef.current = selection;
              setCursor(selection ? { ...selection, phase: "focused" } : null);
              onInputChange(value);
            }}
            onKeyDown={handleInputKeyDown}
            onSelect={captureCursor}
            placeholder={queueing ? "Queue a follow-up…" : placeholder}
            ref={inputRef}
            size="composer"
            tokens={tokens}
            trigger={null}
            value={input}
          />
          {menuVisible ? (
            <div className="absolute start-0 bottom-full z-50 mb-1">
              <CommandMenu
                activeIndex={activeIndex}
                id={listId}
                items={commands.map((item) => {
                  if (item.kind === "model") {
                    return {
                      ...item,
                      icon:
                        item.lab === undefined ? (
                          <Icon icon={SparklesIcon} />
                        ) : (
                          <ModelLabLogo lab={item.lab} />
                        ),
                      shortcut:
                        item.model === currentModel ? (
                          <CurrentChatModelMark />
                        ) : undefined,
                    };
                  }
                  const isSnippet =
                    item.kind === "snippet" ||
                    (item.kind === "search" && item.command === "snippet");
                  return {
                    ...item,
                    icon: <Icon icon={isSnippet ? NoteIcon : SparklesIcon} />,
                  };
                })}
                label={command?.kind === "model" ? "Models" : "Chat commands"}
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
                  connectedAccounts.map((account) => (
                    <DropdownMenuItem
                      key={account.id}
                      onSelect={() => {
                        const { end, start } = selectionRef.current ?? {
                          end: input.length,
                          start: input.length,
                        };
                        const prefix = input.slice(0, start);
                        const spacer =
                          prefix.length > 0 && !/\s$/u.test(prefix) ? " " : "";
                        requestAnimationFrame(() => {
                          inputRef.current?.replaceRange(
                            { end, start },
                            `${spacer}${account.text} `
                          );
                        });
                      }}
                    >
                      <img
                        alt=""
                        aria-hidden
                        className={account.iconClassName}
                        src={account.iconSrc}
                      />
                      <span className="truncate">{account.label}</span>
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
                    (sendDisabled && !commandOpen) ||
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
