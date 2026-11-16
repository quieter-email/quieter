"use client";

import { useRegisterCommands } from "../../hotkeys/components/command-palette-context";
import type { AppCommand } from "../../hotkeys/domain/app-commands";
import type { KeyboardShortcutId } from "../../hotkeys/domain/keyboard-shortcuts";
import type { MessageListBulkAction } from "./message-list-types";

const actionShortcuts: ReadonlyMap<string, KeyboardShortcutId> = new Map([
  ["mark-threads-read", "list-mark-read"],
  ["mark-threads-unread", "list-mark-unread"],
  ["mark-threads-spam", "list-spam"],
  ["move-threads-trash", "list-trash"],
]);

export const useMessageListCommands = ({
  actions,
  canEditLabels,
  focusedSubject,
  hasFocusedThread,
  isActive,
  isPending,
  loadedCount,
  onClearSelection,
  onOpenFocusedThread,
  onOpenLabels,
  onSelectAll,
  onToggleFocusedSelection,
  scopeKey,
  selectedCount,
}: {
  actions: readonly MessageListBulkAction[];
  canEditLabels: boolean;
  focusedSubject: string;
  hasFocusedThread: boolean;
  isActive: boolean;
  isPending: boolean;
  loadedCount: number;
  onClearSelection: () => void;
  onOpenFocusedThread: () => void;
  onOpenLabels: () => void;
  onSelectAll: () => void;
  onToggleFocusedSelection: () => void;
  scopeKey: string;
  selectedCount: number;
}) => {
  let targetDescription = "No conversation selected";
  if (selectedCount > 0) {
    targetDescription = `${selectedCount} selected ${selectedCount === 1 ? "conversation" : "conversations"}`;
  } else if (hasFocusedThread) {
    targetDescription = `Focused conversation, ${focusedSubject}`;
  }
  let actionReason: string | null = null;
  if (isPending) {
    actionReason = "Wait for the current action to finish.";
  } else if (selectedCount === 0 && !hasFocusedThread) {
    actionReason = "Select or focus a conversation first.";
  }
  const commands: AppCommand[] = actions.map((action) => ({
    description: targetDescription,
    group: "Conversation actions",
    id: action.id,
    label: action.label,
    shortcutId: actionShortcuts.get(action.id),
    tone: action.destructive === true ? "destructive" : undefined,
    ...(actionReason === null
      ? { execute: action.onSelect, state: "available" }
      : { reason: actionReason, state: "unavailable" }),
  }));
  commands.push(
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
        ? `Focused conversation, ${focusedSubject}`
        : "No conversation focused",
      group: "Conversations",
      id: "list-toggle-selection",
      label: "Toggle selection",
      shortcutId: "list-toggle-selection",
      ...(hasFocusedThread
        ? { execute: onToggleFocusedSelection, state: "available" }
        : { reason: "Focus a conversation first.", state: "unavailable" }),
    },
    {
      group: "Conversations",
      id: "list-select-all",
      label: "Select all loaded conversations",
      shortcutId: "list-select-all",
      ...(loadedCount > 0
        ? { execute: onSelectAll, state: "available" }
        : { reason: "No conversations are loaded.", state: "unavailable" }),
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
              "Choose conversations from one mailbox with labels.",
            state: "unavailable",
          }),
    }
  );
  useRegisterCommands(isActive ? commands : [], scopeKey);
};
