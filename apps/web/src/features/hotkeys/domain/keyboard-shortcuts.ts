import type { HotkeySequence, RegisterableHotkey } from "@tanstack/react-hotkeys";

export type KeyboardShortcutCategory =
  | "Global"
  | "Navigation"
  | "Message list"
  | "Message detail"
  | "Compose";

type KeyboardShortcutBase = {
  category: KeyboardShortcutCategory;
  description?: string;
  id: string;
  label: string;
  scope: "global" | "mailbox" | "message-list" | "message-detail" | "compose";
  status?: "active" | "coming-soon";
};

export type KeyboardShortcut =
  | (KeyboardShortcutBase & {
      keys: readonly RegisterableHotkey[];
      sequence?: never;
    })
  | (KeyboardShortcutBase & {
      keys?: never;
      sequence: HotkeySequence;
    });

export const KEYBOARD_SHORTCUT_CATEGORIES = [
  "Global",
  "Navigation",
  "Message list",
  "Message detail",
  "Compose",
] as const satisfies readonly KeyboardShortcutCategory[];

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  {
    category: "Global",
    id: "show-keyboard-shortcuts",
    keys: [{ key: "/", shift: true }],
    label: "Show keyboard shortcuts",
    scope: "global",
  },
  {
    category: "Global",
    id: "compose",
    keys: ["C"],
    label: "Compose",
    scope: "mailbox",
  },
  {
    category: "Global",
    id: "focus-search",
    keys: ["/"],
    label: "Focus search",
    scope: "mailbox",
  },
  {
    category: "Navigation",
    id: "go-inbox",
    label: "Go to Inbox",
    scope: "mailbox",
    sequence: ["G", "I"],
  },
  {
    category: "Navigation",
    id: "go-sent",
    label: "Go to Sent",
    scope: "mailbox",
    sequence: ["G", "T"],
  },
  {
    category: "Navigation",
    id: "go-drafts",
    label: "Go to Drafts",
    scope: "mailbox",
    sequence: ["G", "D"],
  },
  {
    category: "Navigation",
    id: "go-unread",
    label: "Go to Unread",
    scope: "mailbox",
    sequence: ["G", "U"],
  },
  {
    category: "Navigation",
    id: "go-spam",
    label: "Go to Spam",
    scope: "mailbox",
    sequence: ["G", "S"],
  },
  {
    category: "Navigation",
    id: "go-trash",
    label: "Go to Trash",
    scope: "mailbox",
    sequence: ["G", "R"],
  },
  {
    category: "Navigation",
    id: "go-chat",
    label: "Go to Chat",
    scope: "mailbox",
    sequence: ["G", "H"],
  },
  {
    category: "Message list",
    id: "list-next-conversation",
    keys: ["J"],
    label: "Next conversation",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-previous-conversation",
    keys: ["K"],
    label: "Previous conversation",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-open-conversation",
    keys: ["O", "Enter"],
    label: "Open conversation",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-back",
    keys: ["U"],
    label: "Back to list",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-toggle-selection",
    keys: ["X"],
    label: "Toggle selection",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-select-all",
    keys: ["Mod+A"],
    label: "Select all loaded conversations",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-clear-selection",
    keys: ["Escape"],
    label: "Clear selection",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-archive",
    keys: ["E"],
    label: "Archive",
    scope: "message-list",
    status: "coming-soon",
    description: "Needs an Archive view or undo before this can be safely enabled.",
  },
  {
    category: "Message list",
    id: "list-trash",
    keys: ["Shift+3"],
    label: "Move to Trash",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-spam",
    keys: ["Shift+1"],
    label: "Mark as Spam",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-mark-read",
    keys: ["Shift+I"],
    label: "Mark as Read",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-mark-unread",
    keys: ["Shift+U"],
    label: "Mark as Unread",
    scope: "message-list",
  },
  {
    category: "Message list",
    id: "list-labels",
    keys: ["L"],
    label: "Modify labels",
    scope: "message-list",
  },
  {
    category: "Message detail",
    id: "detail-reply",
    keys: ["R"],
    label: "Reply",
    scope: "message-detail",
  },
  {
    category: "Message detail",
    id: "detail-reply-all",
    keys: ["A"],
    label: "Reply all",
    scope: "message-detail",
  },
  {
    category: "Message detail",
    id: "detail-forward",
    keys: ["F"],
    label: "Forward",
    scope: "message-detail",
  },
  {
    category: "Message detail",
    id: "detail-archive",
    keys: ["E"],
    label: "Archive",
    scope: "message-detail",
    status: "coming-soon",
    description: "Needs an Archive view or undo before this can be safely enabled.",
  },
  {
    category: "Message detail",
    id: "detail-trash",
    keys: ["Shift+3"],
    label: "Move to Trash",
    scope: "message-detail",
  },
  {
    category: "Message detail",
    id: "detail-spam",
    keys: ["Shift+1"],
    label: "Mark as Spam",
    scope: "message-detail",
  },
  {
    category: "Message detail",
    id: "detail-mark-read",
    keys: ["Shift+I"],
    label: "Mark as Read",
    scope: "message-detail",
  },
  {
    category: "Message detail",
    id: "detail-mark-unread",
    keys: ["Shift+U"],
    label: "Mark as Unread",
    scope: "message-detail",
  },
  {
    category: "Message detail",
    id: "detail-back",
    keys: ["U"],
    label: "Back to list",
    scope: "message-detail",
  },
  {
    category: "Compose",
    id: "compose-send",
    keys: ["Mod+Enter"],
    label: "Send",
    scope: "compose",
  },
] as const;

export const getShortcutKeys = (shortcut: KeyboardShortcut) =>
  "sequence" in shortcut ? shortcut.sequence : shortcut.keys;
