"use client";

import { useRegisterCommands } from "../../hotkeys/components/command-palette-context";
import type { AppCommand } from "../../hotkeys/domain/app-commands";
import type { KeyboardShortcutId } from "../../hotkeys/domain/keyboard-shortcuts";
import type { MessageListBulkAction } from "./message-list-types";

const actionShortcuts: ReadonlyMap<string, KeyboardShortcutId> = new Map([
  ["mark-threads-done", "list-done"],
  ["return-threads-to-inbox", "list-done"],
  ["toggle-importance", "list-important"],
  ["mark-threads-read", "list-mark-read"],
  ["mark-threads-unread", "list-mark-unread"],
  ["mark-threads-spam", "list-spam"],
  ["move-threads-trash", "list-trash"],
]);

const actionKeywords: ReadonlyMap<string, string> = new Map([
  ["mark-threads-done", "done archive finish"],
  ["return-threads-to-inbox", "done inbox move back"],
  ["toggle-importance", "important star flag"],
]);

export const useMessageListCommands = ({
  actions,
  canEditLabels,
  canFocusSearch,
  focusedSubject,
  hasActiveMessage,
  hasFocusedThread,
  hasNextConversation,
  hasPreviousConversation,
  isPending,
  isSelecting,
  loadedCount,
  onClearSelection,
  onFocusSearch,
  onOpenFocusedThread,
  onOpenLabels,
  onOpenNextConversation,
  onOpenPreviousConversation,
  onSelectAll,
  onToggleFocusedSelection,
  scopeKey,
  selectedCount,
  supportsSelection,
}: {
  actions: readonly MessageListBulkAction[];
  canEditLabels: boolean;
  canFocusSearch: boolean;
  focusedSubject: string;
  hasActiveMessage: boolean;
  hasFocusedThread: boolean;
  hasNextConversation: boolean;
  hasPreviousConversation: boolean;
  isPending: boolean;
  isSelecting: boolean;
  loadedCount: number;
  onClearSelection: () => void;
  onFocusSearch: () => void;
  onOpenFocusedThread: () => void;
  onOpenLabels: () => void;
  onOpenNextConversation: () => void;
  onOpenPreviousConversation: () => void;
  onSelectAll: () => void;
  onToggleFocusedSelection: () => void;
  scopeKey: string;
  selectedCount: number;
  supportsSelection: boolean;
}) => {
  const normalizedFocusedSubject = focusedSubject.trim() || "(No subject)";
  let searchReason: string | null = null;
  if (!canFocusSearch) {
    searchReason = "Return to the conversation list to search mail.";
  } else if (isSelecting) {
    searchReason = "Clear selection to search mail.";
  }

  const commands: AppCommand[] = [
    {
      group: "Mail",
      id: "focus-search",
      label: "Search mail",
      shortcutId: "focus-search",
      ...(searchReason === null
        ? { execute: onFocusSearch, state: "available" }
        : { reason: searchReason, state: "unavailable" }),
    },
  ];

  if (hasActiveMessage) {
    commands.push(
      {
        group: "Navigation",
        id: "detail-next-conversation",
        label: "Next conversation",
        shortcutId: "detail-next-conversation",
        ...(hasNextConversation
          ? { execute: onOpenNextConversation, state: "available" }
          : {
              reason: "You are at the last loaded conversation.",
              state: "unavailable",
            }),
      },
      {
        group: "Navigation",
        id: "detail-previous-conversation",
        label: "Previous conversation",
        shortcutId: "detail-previous-conversation",
        ...(hasPreviousConversation
          ? { execute: onOpenPreviousConversation, state: "available" }
          : {
              reason: "You are at the first conversation.",
              state: "unavailable",
            }),
      }
    );
    if (selectedCount > 0) {
      commands.push({
        execute: onClearSelection,
        group: "Conversations",
        id: "list-clear-selection",
        label: "Clear selection",
        shortcutId: "list-clear-selection",
        state: "available",
      });
    }
  } else {
    let targetDescription = "No conversation selected";
    if (selectedCount > 0) {
      targetDescription = `${selectedCount} selected ${selectedCount === 1 ? "conversation" : "conversations"}`;
    } else if (hasFocusedThread) {
      targetDescription = `Focused conversation, ${normalizedFocusedSubject}`;
    }
    let actionReason: string | null = null;
    if (isPending) {
      actionReason = "Wait for the current action to finish.";
    } else if (selectedCount === 0 && !hasFocusedThread) {
      actionReason = "Select or focus a conversation first.";
    }
    let toggleSelectionReason: string | null = null;
    if (!supportsSelection) {
      toggleSelectionReason = "This mailbox does not support bulk actions.";
    } else if (!hasFocusedThread) {
      toggleSelectionReason = "Focus a conversation first.";
    }
    let selectAllReason: string | null = null;
    if (!supportsSelection) {
      selectAllReason = "This mailbox does not support bulk actions.";
    } else if (loadedCount === 0) {
      selectAllReason = "No conversations are loaded.";
    }
    commands.push(
      ...actions.map((action): AppCommand => ({
        description: targetDescription,
        group: "Conversation actions",
        id: action.id,
        keywords: actionKeywords.get(action.id),
        label: action.label,
        shortcutId: actionShortcuts.get(action.id),
        tone: action.destructive === true ? "destructive" : undefined,
        ...(actionReason === null
          ? { execute: action.onSelect, state: "available" }
          : { reason: actionReason, state: "unavailable" }),
      })),
      {
        description: targetDescription,
        group: "Conversations",
        id: "list-open-conversation",
        label: "Open conversation",
        shortcutId: "list-open-conversation",
        ...(hasFocusedThread && selectedCount === 0
          ? { execute: onOpenFocusedThread, state: "available" }
          : {
              reason:
                selectedCount > 0
                  ? "Clear the selection to open one conversation."
                  : "Focus a conversation first.",
              state: "unavailable",
            }),
      },
      {
        description: hasFocusedThread
          ? `Focused conversation, ${normalizedFocusedSubject}`
          : "No conversation focused",
        group: "Conversations",
        id: "list-toggle-selection",
        label: "Toggle selection",
        shortcutId: "list-toggle-selection",
        ...(toggleSelectionReason === null
          ? { execute: onToggleFocusedSelection, state: "available" }
          : { reason: toggleSelectionReason, state: "unavailable" }),
      },
      {
        group: "Conversations",
        id: "list-select-all",
        label: "Select all loaded conversations",
        shortcutId: "list-select-all",
        ...(selectAllReason === null
          ? { execute: onSelectAll, state: "available" }
          : { reason: selectAllReason, state: "unavailable" }),
      },
      {
        group: "Conversations",
        id: "list-clear-selection",
        label: "Clear selection",
        shortcutId: "list-clear-selection",
        ...(selectedCount > 0
          ? { execute: onClearSelection, state: "available" }
          : { reason: "No conversations are selected.", state: "unavailable" }),
      },
      {
        description: targetDescription,
        group: "Conversation actions",
        id: "list-labels",
        label: "Modify labels",
        shortcutId: "list-labels",
        ...(actionReason === null && canEditLabels
          ? { execute: onOpenLabels, state: "available" }
          : {
              reason:
                actionReason ??
                (supportsSelection
                  ? "Choose conversations from one mailbox with labels."
                  : "This mailbox does not support labels."),
              state: "unavailable",
            }),
      }
    );
  }
  useRegisterCommands(commands, scopeKey);
};
