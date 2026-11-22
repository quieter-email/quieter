"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkSquare02Icon,
  MailOpen01Icon,
  Search01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import type { MailboxCategory } from "@quieter/app/lib/mail";

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
  activeMailbox,
  canFocusSearch,
  focusedSubject,
  hasActiveMessage,
  hasFocusedThread,
  hasLabelTarget,
  hasNextConversation,
  hasPreviousConversation,
  hasUserLabels,
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
  activeMailbox: MailboxCategory;
  canFocusSearch: boolean;
  focusedSubject: string;
  hasActiveMessage: boolean;
  hasFocusedThread: boolean;
  hasLabelTarget: boolean;
  hasNextConversation: boolean;
  hasPreviousConversation: boolean;
  hasUserLabels: boolean;
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

  let contextLabel: string | undefined;
  const commands: AppCommand[] = [
    {
      group: "Mail",
      icon: Search01Icon,
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
        icon: ArrowRight01Icon,
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
        icon: ArrowLeft01Icon,
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
        icon: Cancel01Icon,
        id: "list-clear-selection",
        label: "Clear selection",
        shortcutId: "list-clear-selection",
        state: "available",
      });
    }
  } else {
    if (selectedCount > 0) {
      contextLabel = `${selectedCount} selected ${selectedCount === 1 ? "conversation" : "conversations"}`;
    } else if (hasFocusedThread) {
      contextLabel = normalizedFocusedSubject;
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
    let labelsReason = actionReason;
    if (labelsReason === null) {
      if (!supportsSelection) {
        labelsReason = "This mailbox does not support labels.";
      } else if (activeMailbox === "drafts") {
        labelsReason = "Labels cannot be modified in Drafts.";
      } else if (!hasLabelTarget) {
        labelsReason =
          "Select conversations from one mailbox to modify labels.";
      } else if (!hasUserLabels) {
        labelsReason = "Create a label first to label conversations.";
      }
    }
    commands.push(
      ...actions.map((action): AppCommand => ({
        group: "Conversation actions",
        icon: action.icon,
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
        group: "Conversations",
        icon: MailOpen01Icon,
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
        group: "Conversations",
        icon: CheckmarkSquare02Icon,
        id: "list-toggle-selection",
        label: "Toggle selection",
        shortcutId: "list-toggle-selection",
        ...(toggleSelectionReason === null
          ? { execute: onToggleFocusedSelection, state: "available" }
          : { reason: toggleSelectionReason, state: "unavailable" }),
      },
      {
        group: "Conversations",
        icon: CheckListIcon,
        id: "list-select-all",
        label: "Select all loaded conversations",
        shortcutId: "list-select-all",
        ...(selectAllReason === null
          ? { execute: onSelectAll, state: "available" }
          : { reason: selectAllReason, state: "unavailable" }),
      },
      {
        group: "Conversations",
        icon: Cancel01Icon,
        id: "list-clear-selection",
        label: "Clear selection",
        shortcutId: "list-clear-selection",
        ...(selectedCount > 0
          ? { execute: onClearSelection, state: "available" }
          : { reason: "No conversations are selected.", state: "unavailable" }),
      },
      {
        group: "Conversation actions",
        icon: Tag01Icon,
        id: "list-labels",
        label: "Modify labels",
        shortcutId: "list-labels",
        ...(labelsReason === null
          ? { execute: onOpenLabels, state: "available" }
          : { reason: labelsReason, state: "unavailable" }),
      }
    );
  }
  useRegisterCommands(commands, scopeKey, contextLabel);
};
