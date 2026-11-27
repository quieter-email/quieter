"use client";

import {
  AlarmClockIcon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  Flag01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend02Icon,
  MailsIcon,
  NoteEditIcon,
  Search01Icon,
  UserSwitchIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { MailboxWorkspaceView } from "@quieter/app/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "@quieter/app/lib/mail";

import { useRegisterCommands } from "../../hotkeys/components/command-palette-context";
import type { AppCommand } from "../../hotkeys/domain/app-commands";
import { KEYBOARD_SHORTCUTS } from "../../hotkeys/domain/keyboard-shortcuts";
import type { KeyboardShortcutId } from "../../hotkeys/domain/keyboard-shortcuts";
import type { useMailboxSelection } from "./mailbox-workspace/use-mailbox-selection";

const mailboxDestinations = [
  { icon: Flag01Icon, mailbox: "important", shortcutId: "go-important" },
  { icon: InboxIcon, mailbox: "inbox", shortcutId: "go-inbox" },
  { icon: CheckmarkCircle02Icon, mailbox: "done", shortcutId: "go-done" },
  { icon: AlarmClockIcon, mailbox: "later", shortcutId: "go-later" },
  { icon: Mail01Icon, mailbox: "unread", shortcutId: "go-unread" },
  { icon: MailSend02Icon, mailbox: "sent", shortcutId: "go-sent" },
  { icon: Edit01Icon, mailbox: "drafts", shortcutId: "go-drafts" },
  { icon: Delete01Icon, mailbox: "trash", shortcutId: "go-trash" },
  { icon: Delete02Icon, mailbox: "spam", shortcutId: "go-spam" },
] as const satisfies readonly {
  icon: IconSvgElement;
  mailbox: MailboxCategory;
  shortcutId: KeyboardShortcutId;
}[];

export const isMailboxSupportedByProvider = (
  provider: "api" | "gmail" | "managed" | null,
  mailbox: MailboxCategory
) => {
  if (provider === "api") {
    return mailbox === "sent";
  }
  return true;
};

export const useMailboxCommands = ({
  activeMailbox,
  canCompose,
  isComposeMailbox,
  isMailWorkspace,
  isSnippetMailbox,
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
  view,
}: {
  activeMailbox: MailboxCategory;
  canCompose: boolean;
  isComposeMailbox: boolean;
  isMailWorkspace: boolean;
  isSnippetMailbox: boolean;
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
  view: MailboxWorkspaceView;
}) => {
  const allInboxesActive = view === "all-inboxes";
  const hasNonApiMailbox = mailboxes.some(
    (mailbox) => mailbox.provider !== "api"
  );
  const effectiveViewProvider =
    allInboxesActive && selectedMailboxProvider === "api"
      ? (mailboxes.find((mailbox) => mailbox.provider !== "api")?.provider ??
        selectedMailboxProvider)
      : selectedMailboxProvider;

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

  let snippetsReason = mailboxReason;
  if (snippetsReason === null) {
    if (isSnippetMailbox) {
      snippetsReason = "Already viewing Snippets.";
    } else if (selectedMailboxProvider === "api") {
      snippetsReason = "Choose a mailbox you can compose from.";
    }
  }

  let allInboxesReason = mailboxReason;
  if (allInboxesReason === null) {
    if (!hasNonApiMailbox) {
      allInboxesReason = "Connect a mailbox to view its Inbox.";
    } else if (allInboxesActive && !isComposeMailbox && !isSnippetMailbox) {
      allInboxesReason = "Already viewing All inboxes.";
    }
  }

  let openMailReason: string | null = null;
  if (!isWorkspaceReady) {
    openMailReason = "Wait for your mailboxes to load.";
  } else if (isMailWorkspace) {
    openMailReason = "Already viewing Mail.";
  }

  let openCalendarReason: string | null = null;
  if (!isWorkspaceReady) {
    openCalendarReason = "Wait for your mailboxes to load.";
  } else if (!isMailWorkspace) {
    openCalendarReason = "Already viewing Calendar.";
  }

  const commands: AppCommand[] = [
    {
      fallback: true,
      group: "Mail",
      icon: Search01Icon,
      id: "focus-search",
      label: "Search mail",
      reason: mailboxReason ?? "Open a conversation list to search mail.",
      shortcutId: "focus-search",
      state: "unavailable",
    },
    {
      group: "Mail",
      icon: Edit01Icon,
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
      const { icon, mailbox, shortcutId } = destination;
      const isViewingDestination =
        !isComposeMailbox &&
        !isSnippetMailbox &&
        (view === "inbox" || view === "all-inboxes") &&
        mailbox === activeMailbox;
      let reason = mailboxReason;
      if (reason === null) {
        if (!isMailboxSupportedByProvider(effectiveViewProvider, mailbox)) {
          reason =
            effectiveViewProvider === "api"
              ? "This mailbox only has Sent mail."
              : "This view is unavailable for this mailbox.";
        } else if (isViewingDestination) {
          reason = `Already viewing ${shortcut.label.replace(/^Go to /u, "")}.`;
        }
      }
      return [
        {
          group: "Views",
          icon,
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
      icon: MailsIcon,
      id: "go-all-inboxes",
      label: "Go to All inboxes",
      ...(allInboxesReason === null
        ? {
            execute: () => {
              onSelectView("all-inboxes");
            },
            state: "available",
          }
        : {
            reason: allInboxesReason,
            state: "unavailable",
          }),
    },
    {
      group: "Mail",
      icon: NoteEditIcon,
      id: "manage-snippets",
      label: "Manage snippets",
      ...(snippetsReason === null
        ? { execute: onManageSnippets, state: "available" }
        : { reason: snippetsReason, state: "unavailable" }),
    },
    {
      group: "Navigation",
      icon: InboxIcon,
      id: "go-mail",
      label: "Go to Mail",
      ...(openMailReason === null
        ? { execute: onOpenMail, state: "available" }
        : { reason: openMailReason, state: "unavailable" }),
    },
    {
      group: "Navigation",
      icon: Calendar03Icon,
      id: "go-calendar",
      label: "Go to Calendar",
      ...(openCalendarReason === null
        ? { execute: onOpenCalendar, state: "available" }
        : { reason: openCalendarReason, state: "unavailable" }),
    },
    ...mailboxes.map((mailbox): AppCommand => {
      let switchReason: string | null = null;
      if (!isWorkspaceReady) {
        switchReason = "Wait for your mailboxes to load.";
      } else if (!isMailWorkspace) {
        switchReason = "Open Mail first.";
      } else if (!allInboxesActive && mailbox.id === selectedMailboxId) {
        switchReason = "Already viewing this mailbox.";
      }
      return {
        description: mailbox.emailAddress,
        group: "Accounts",
        icon: UserSwitchIcon,
        id: `switch-mailbox-${mailbox.id}`,
        keywords: mailbox.emailAddress,
        label: `Switch to ${mailbox.displayName || mailbox.emailAddress}`,
        ...(switchReason === null
          ? {
              execute: () => {
                onSelectMailboxId(mailbox.id);
              },
              state: "available",
            }
          : { reason: switchReason, state: "unavailable" }),
      };
    }),
  ];
  useRegisterCommands(
    commands,
    JSON.stringify([
      selectedMailboxId ?? "none",
      isMailWorkspace ? "mail" : "calendar",
      view,
      activeMailbox,
      isComposeMailbox,
      isSnippetMailbox,
    ])
  );
};
