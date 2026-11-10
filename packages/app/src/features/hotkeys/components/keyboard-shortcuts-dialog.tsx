"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  getShortcutDisplay,
  KEYBOARD_SHORTCUTS,
} from "@quieter/app/features/hotkeys/domain/keyboard-shortcuts";
import type {
  KeyboardShortcut,
  KeyboardShortcutId,
} from "@quieter/app/features/hotkeys/domain/keyboard-shortcuts";
import { SettingsCard } from "@quieter/app/features/settings/components/settings-layout";
import { cn } from "@quieter/ui/cn";
import {
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogHeader,
  FullPageDialogTitle,
} from "@quieter/ui/full-page-dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Kbd } from "@quieter/ui/kbd";

type KeyboardShortcutsDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

type ShortcutViewItem = {
  context?: string;
  id: KeyboardShortcutId;
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

const getShortcutById = (id: KeyboardShortcutId): KeyboardShortcut => {
  const shortcut = shortcutById.get(id);
  if (!shortcut) {
    throw new Error(`Missing keyboard shortcut: ${id}`);
  }
  return shortcut;
};

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
                <span className="text-micro text-muted-fg">
                  <span aria-hidden>→</span>
                  <span className="sr-only">then</span>
                </span>
              )}
              <Kbd>{key}</Kbd>
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
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:px-6">
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
        <IconButtonTooltip label="Close keyboard shortcuts">
          <FullPageDialogClose aria-label="Close keyboard shortcuts">
            <Icon aria-hidden icon={Cancel01Icon} />
          </FullPageDialogClose>
        </IconButtonTooltip>
        <div className="min-w-0">
          <FullPageDialogTitle>Keyboard shortcuts</FullPageDialogTitle>
        </div>
      </FullPageDialogHeader>

      <FullPageDialogBody
        // oxlint-disable-next-line shadcn/no-restyle -- Shortcuts body keeps its content padding.
        className="px-4 py-5 sm:px-6"
      >
        <div className="mx-auto w-full max-w-4xl columns-1 gap-4 lg:columns-2">
          {SHORTCUT_VIEW_SECTIONS.map((section) => (
            <section
              className="mb-4 break-inside-avoid space-y-2"
              key={section.title}
            >
              <h2 className="px-1 text-body font-normal text-fg">
                {section.title}
              </h2>
              <SettingsCard>
                {section.items.map((item) => (
                  <ShortcutRow
                    item={item}
                    key={`${section.title}-${item.id}`}
                  />
                ))}
              </SettingsCard>
            </section>
          ))}
        </div>
      </FullPageDialogBody>
    </FullPageDialogContent>
  </FullPageDialog>
);
