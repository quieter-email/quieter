"use client";

import type { MailboxWorkspaceView } from "@quieter/app/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "@quieter/app/lib/mail";

import { useRegisterCommands } from "../../hotkeys/components/command-palette-context";
import type { AppCommand } from "../../hotkeys/domain/app-commands";
import { KEYBOARD_SHORTCUTS } from "../../hotkeys/domain/keyboard-shortcuts";
import type { KeyboardShortcutId } from "../../hotkeys/domain/keyboard-shortcuts";
import type { useMailboxSelection } from "./mailbox-workspace/use-mailbox-selection";

const mailboxDestinations = [
  { mailbox: "inbox", shortcutId: "go-inbox" },
  { mailbox: "sent", shortcutId: "go-sent" },
  { mailbox: "drafts", shortcutId: "go-drafts" },
  { mailbox: "unread", shortcutId: "go-unread" },
  { mailbox: "spam", shortcutId: "go-spam" },
  { mailbox: "trash", shortcutId: "go-trash" },
] as const satisfies readonly {
  mailbox: MailboxCategory;
  shortcutId: KeyboardShortcutId;
}[];

export const useMailboxCommands = ({
  canCompose,
  isComposeMailbox,
  isMailList,
  isMailWorkspace,
  isWorkspaceReady,
  mailboxes,
  onCompose,
  onManageSnippets,
  onOpenCalendar,
  onOpenMail,
  onSelectMailbox,
  onSelectMailboxId,
  onSelectView,
  selectedMailboxId,
  selectedMailboxProvider,
}: {
  canCompose: boolean;
  isComposeMailbox: boolean;
  isMailList: boolean;
  isMailWorkspace: boolean;
  isWorkspaceReady: boolean;
  mailboxes: ReturnType<typeof useMailboxSelection>["mailboxes"];
  onCompose: () => void;
  onManageSnippets: () => void;
  onOpenCalendar: () => void | Promise<void>;
  onOpenMail: () => void | Promise<void>;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSelectView: (view: MailboxWorkspaceView) => void;
  selectedMailboxId: string | null;
  selectedMailboxProvider: "api" | "gmail" | "managed" | null;
}) => {
  let mailboxReason: string | null = null;
  if (!isWorkspaceReady) {
    mailboxReason = "Wait for your mailboxes to load.";
  } else if (selectedMailboxId === null) {
    mailboxReason = "Choose a mailbox first.";
  } else if (!isMailWorkspace) {
    mailboxReason = "Open Mail first.";
  }
  let composeReason = mailboxReason;
  if (composeReason === null) {
    if (isComposeMailbox) {
      composeReason = "A draft is already open.";
    } else if (!canCompose) {
      composeReason = "Choose a connected mailbox you can send from.";
    }
  }
  const commands: AppCommand[] = [
    ...(!isMailList || !isWorkspaceReady || selectedMailboxId === null
      ? [
          {
            group: "Mail",
            id: "focus-search",
            label: "Search mail",
            reason: mailboxReason ?? "Open a conversation list to search mail.",
            shortcutId: "focus-search",
            state: "unavailable",
          } as const,
        ]
      : []),
    {
      group: "Mail",
      id: "compose",
      label: "Compose",
      shortcutId: "compose",
      ...(composeReason === null
        ? { execute: onCompose, state: "available" }
        : { reason: composeReason, state: "unavailable" }),
    },
    ...KEYBOARD_SHORTCUTS.flatMap((shortcut): AppCommand[] => {
      const destination = mailboxDestinations.find(
        (item) => item.shortcutId === shortcut.id
      );
      if (!destination) {
        return [];
      }
      const { mailbox, shortcutId } = destination;
      const reason =
        mailboxReason ??
        (selectedMailboxProvider === "api" && mailbox !== "sent"
          ? "This mailbox only has Sent mail."
          : null);
      return [
        {
          group: "Views",
          id: shortcutId,
          label: shortcut.label,
          shortcutId,
          ...(reason === null
            ? {
                execute: () => {
                  onSelectMailbox(mailbox);
                },
                state: "available",
              }
            : { reason, state: "unavailable" }),
        },
      ];
    }),
    {
      group: "Views",
      id: "go-all-inboxes",
      label: "Go to All inboxes",
      ...(mailboxReason === null &&
      mailboxes.some((mailbox) => mailbox.provider !== "api")
        ? {
            execute: () => {
              onSelectView("all-inboxes");
            },
            state: "available",
          }
        : {
            reason: mailboxReason ?? "Connect a mailbox to view its Inbox.",
            state: "unavailable",
          }),
    },
    {
      group: "Mail",
      id: "manage-snippets",
      label: "Manage snippets",
      ...(mailboxReason === null && selectedMailboxProvider !== "api"
        ? { execute: onManageSnippets, state: "available" }
        : {
            reason: mailboxReason ?? "Choose a mailbox you can compose from.",
            state: "unavailable",
          }),
    },
    {
      execute: onOpenMail,
      group: "Navigation",
      id: "go-mail",
      label: "Go to Mail",
      state: "available",
    },
    {
      execute: onOpenCalendar,
      group: "Navigation",
      id: "go-calendar",
      label: "Go to Calendar",
      state: "available",
    },
    ...mailboxes.map((mailbox): AppCommand => ({
      description: mailbox.emailAddress,
      group: "Accounts",
      id: `switch-mailbox-${mailbox.id}`,
      label: `Switch to ${mailbox.displayName || mailbox.emailAddress}`,
      ...(isWorkspaceReady && isMailWorkspace
        ? {
            execute: () => {
              onSelectMailboxId(mailbox.id);
            },
            state: "available",
          }
        : {
            reason: isWorkspaceReady
              ? "Open Mail first."
              : "Wait for your mailboxes to load.",
            state: "unavailable",
          }),
    })),
  ];
  useRegisterCommands(
    commands,
    `${selectedMailboxId ?? "none"}:${isMailWorkspace ? "mail" : "calendar"}`
  );
};
