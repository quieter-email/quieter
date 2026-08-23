"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import {
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogHeader,
  FullPageDialogTitle,
} from "@quieter/ui/full-page-dialog";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import type { Hotkey, RegisterableHotkey } from "@tanstack/react-hotkeys";

import { KEYBOARD_SHORTCUTS } from "#/features/hotkeys/domain/keyboard-shortcuts";
import type { KeyboardShortcut } from "#/features/hotkeys/domain/keyboard-shortcuts";

type KeyboardShortcutsDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

type ShortcutViewItem = {
  context?: string;
  id: string;
  label?: string;
};

type ShortcutViewSection = {
  items: readonly ShortcutViewItem[];
  title: string;
};

const SHORTCUT_VIEW_SECTIONS: readonly ShortcutViewSection[] = [
  {
    items: [
      { id: "show-keyboard-shortcuts" },
      { id: "compose" },
      { id: "focus-search" },
      { context: "Compose", id: "compose-send" },
    ],
    title: "Basics",
  },
  {
    items: [
      { id: "go-inbox", label: "Inbox" },
      { id: "go-archive", label: "Archive" },
      { id: "go-sent", label: "Sent" },
      { id: "go-drafts", label: "Drafts" },
      { id: "go-unread", label: "Unread" },
      { id: "go-spam", label: "Spam" },
      { id: "go-trash", label: "Trash" },
      { id: "go-chat", label: "Chat" },
    ],
    title: "Go to",
  },
  {
    items: [
      { id: "list-next-conversation" },
      { id: "list-previous-conversation" },
      { id: "list-open-conversation" },
      { id: "list-toggle-selection" },
      { id: "list-select-all" },
      { id: "list-clear-selection" },
      { id: "list-labels" },
    ],
    title: "Conversations",
  },
  {
    items: [
      { id: "detail-reply" },
      { id: "detail-reply-all" },
      { id: "detail-forward" },
      { id: "detail-back" },
    ],
    title: "Message",
  },
  {
    items: [
      { context: "List", id: "list-archive" },
      { context: "List and detail", id: "list-trash" },
      { context: "List and detail", id: "list-spam" },
      { context: "List and detail", id: "list-mark-read" },
      { context: "List and detail", id: "list-mark-unread" },
    ],
    title: "Mail actions",
  },
];

const shortcutById = new Map(
  KEYBOARD_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut])
);

const getShortcutById = (id: string) => {
  const shortcut = shortcutById.get(id);
  if (!shortcut) {
    throw new Error(`Missing keyboard shortcut: ${id}`);
  }
  return shortcut;
};

const formatSingleHotkey = (hotkey: RegisterableHotkey) =>
  typeof hotkey === "object" && hotkey.key === "/" && hotkey.shift === true
    ? "?"
    : formatForDisplay(hotkey, { separatorToken: "+" });

const getShortcutDisplay = (shortcut: KeyboardShortcut): string[][] => {
  const { sequence } = shortcut;
  if (sequence) {
    return [sequence.map((hotkey: Hotkey) => formatSingleHotkey(hotkey))];
  }

  return shortcut.keys.map((hotkey) => [formatSingleHotkey(hotkey)]);
};

const KeyBadge = ({ value }: { value: string }) => (
  <kbd className="squircle inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-bg-surface px-1.5 font-mono text-micro font-medium text-fg shadow-xs">
    {value}
  </kbd>
);

const ShortcutKeys = ({ shortcut }: { shortcut: KeyboardShortcut }) => (
  <div className="flex flex-wrap justify-end gap-1.5">
    {getShortcutDisplay(shortcut).map((binding, bindingIndex, bindings) => {
      const bindingKey = binding.join("-");

      return (
        <div
          className="flex items-center gap-1"
          key={`${shortcut.id}-${bindingKey}`}
        >
          {binding.map((key, keyIndex) => (
            <span
              className="flex items-center gap-1"
              key={`${shortcut.id}-${bindingKey}-${key}`}
            >
              {keyIndex > 0 && (
                <span className="text-micro text-muted-fg">then</span>
              )}
              <KeyBadge value={key} />
            </span>
          ))}
          {bindingIndex < bindings.length - 1 && (
            <span className="text-micro text-muted-fg">or</span>
          )}
        </div>
      );
    })}
  </div>
);

const ShortcutRow = ({ item }: { item: ShortcutViewItem }) => {
  const shortcut = getShortcutById(item.id);
  const context =
    item.context ?? (shortcut.status === "coming-soon" ? "Later" : null);

  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <p
          className={cn("truncate text-body-sm font-normal text-fg", {
            "text-muted-fg": shortcut.status === "coming-soon",
          })}
        >
          {item.label ?? shortcut.label}
        </p>
        {context !== undefined && context !== "" ? (
          <p className="mt-0.5 truncate text-caption/5 text-muted-fg">
            {context}
          </p>
        ) : null}
      </div>
      <ShortcutKeys shortcut={shortcut} />
    </div>
  );
};

export const KeyboardShortcutsDialog = ({
  onOpenChange,
  open,
}: KeyboardShortcutsDialogProps) => (
  <FullPageDialog onOpenChange={onOpenChange} open={open}>
    <FullPageDialogContent data-keyboard-shortcuts-dialog>
      <FullPageDialogHeader>
        <FullPageDialogClose aria-label="Close keyboard shortcuts">
          <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
        </FullPageDialogClose>
        <div className="min-w-0">
          <FullPageDialogTitle>Keyboard shortcuts</FullPageDialogTitle>
        </div>
      </FullPageDialogHeader>

      <FullPageDialogBody className="px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-4xl columns-1 gap-4 lg:columns-2">
          {SHORTCUT_VIEW_SECTIONS.map((section) => (
            <section
              className="mb-4 break-inside-avoid space-y-2"
              key={section.title}
            >
              <h2 className="px-1 text-body font-normal text-fg">
                {section.title}
              </h2>
              <div className="squircle overflow-hidden rounded-lg border border-border bg-bg-raised/58">
                {section.items.map((item) => (
                  <ShortcutRow
                    item={item}
                    key={`${section.title}-${item.id}`}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </FullPageDialogBody>
    </FullPageDialogContent>
  </FullPageDialog>
);
