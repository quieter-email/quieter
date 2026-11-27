"use client";

import {
  ArrowLeft01Icon,
  ArrowRightDoubleIcon,
  Delete01Icon,
  Delete02Icon,
  Mail01Icon,
  MailOpen02Icon,
  MailReply02Icon,
  MailReplyAll02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import {
  buildComposeDraftFromMessageAction,
  hasDistinctReplyAllRecipients,
} from "@quieter/app/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { shouldIgnoreAppShortcut } from "@quieter/app/features/hotkeys/domain/hotkey-guards";
import type { MailboxActions } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import type { MessageViewProps } from "@quieter/app/features/message-thread/components/message-view-types";
import { toastError } from "@quieter/app/lib/error-toast";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import { toast } from "@quieter/ui/toast";
import { useHotkeys } from "@tanstack/react-hotkeys";

import { useRegisterCommands } from "../../hotkeys/components/command-palette-context";
import type { AppCommand } from "../../hotkeys/domain/app-commands";
import { KEYBOARD_SHORTCUTS } from "../../hotkeys/domain/keyboard-shortcuts";
import type { KeyboardShortcutId } from "../../hotkeys/domain/keyboard-shortcuts";

const runThreadAction = async (
  action: () => void | Promise<void>,
  successMessage: string
) => {
  try {
    await action();
    toast.success(successMessage);
  } catch (error) {
    toastError(error, {
      boundary: "message-actions",
      fallback: "Could not update message.",
    });
  }
};

export const useMessageViewHotkeys = ({
  activeMailbox,
  canComposeFromMailbox,
  currentUserEmail,
  hotkeyLinkedDraftMessage,
  hotkeyMessage,
  importanceIcon,
  importanceLabel,
  isActionPending,
  mailboxActions,
  mailboxId,
  mailboxProvider,
  onBackToList,
  onComposeDraftRequested,
  onToggleImportance,
  onTogglePlacement,
  placementIcon,
  placementLabel,
}: {
  activeMailbox: MailboxCategory;
  canComposeFromMailbox: boolean;
  currentUserEmail?: string | null;
  hotkeyLinkedDraftMessage: MessageListItem | undefined;
  hotkeyMessage: MessageListItem;
  importanceIcon?: IconSvgElement;
  importanceLabel?: string;
  isActionPending: boolean;
  mailboxActions: MailboxActions;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  onBackToList?: () => void;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onToggleImportance?: () => void;
  onTogglePlacement?: () => void;
  placementIcon?: IconSvgElement;
  placementLabel?: string;
}) => {
  const requestComposeAction = (action: "reply" | "reply-all" | "forward") => {
    if (!canComposeFromMailbox || onComposeDraftRequested === undefined) {
      return;
    }
    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        existingDraftMessage: hotkeyLinkedDraftMessage,
        message: hotkeyMessage,
      })
    );
  };
  const normalizedSubject = hotkeyMessage.subject?.trim() || "(No subject)";
  const canCompose =
    canComposeFromMailbox &&
    onComposeDraftRequested !== undefined &&
    activeMailbox !== "drafts";
  const composeUnavailableReason =
    activeMailbox === "drafts"
      ? "Open the draft instead of replying or forwarding."
      : "Choose a connected mailbox you can send from.";
  const canMarkRead = mailboxActions.canMarkRead && activeMailbox !== "drafts";
  const unavailableActionReason =
    "This action is unavailable for this conversation.";
  const threadPendingReason = isActionPending
    ? "Wait for the current action to finish."
    : unavailableActionReason;
  const actions: {
    enabled: boolean;
    execute: () => void | Promise<void>;
    icon?: IconSvgElement;
    keywords?: string;
    label?: string;
    reason: string;
    shortcutId: KeyboardShortcutId;
    tone?: "destructive";
  }[] = [
    {
      enabled: canCompose,
      execute: () => {
        requestComposeAction("reply");
      },
      icon: MailReply02Icon,
      reason: composeUnavailableReason,
      shortcutId: "detail-reply",
    },
    {
      enabled:
        canCompose &&
        hasDistinctReplyAllRecipients(hotkeyMessage, currentUserEmail),
      execute: () => {
        requestComposeAction("reply-all");
      },
      icon: MailReplyAll02Icon,
      reason: canCompose
        ? "There are no additional recipients to reply to."
        : composeUnavailableReason,
      shortcutId: "detail-reply-all",
    },
    {
      enabled: canCompose,
      execute: () => {
        requestComposeAction("forward");
      },
      icon: ArrowRightDoubleIcon,
      reason: composeUnavailableReason,
      shortcutId: "detail-forward",
    },
    {
      enabled: !isActionPending && onTogglePlacement !== undefined,
      execute: () => {
        onTogglePlacement?.();
      },
      icon: placementIcon,
      keywords: "done archive inbox",
      label: placementLabel,
      reason: threadPendingReason,
      shortcutId: "detail-done",
    },
    {
      enabled: !isActionPending && onToggleImportance !== undefined,
      execute: () => {
        onToggleImportance?.();
      },
      icon: importanceIcon,
      keywords: "important star flag",
      label: importanceLabel,
      reason: threadPendingReason,
      shortcutId: "detail-important",
    },
    {
      enabled:
        mailboxProvider !== "api" &&
        activeMailbox !== "drafts" &&
        activeMailbox !== "trash",
      execute: async () => {
        await runThreadAction(async () => {
          await mailboxActions.moveThreadToTrash(hotkeyMessage.threadId);
          onBackToList?.();
        }, "Conversation moved to Trash.");
      },
      icon: Delete01Icon,
      reason: unavailableActionReason,
      shortcutId: "detail-trash",
      tone: "destructive",
    },
    {
      enabled: mailboxProvider === "gmail" && activeMailbox === "inbox",
      execute: async () => {
        await runThreadAction(async () => {
          await mailboxActions.markThreadAsSpam(hotkeyMessage.threadId);
          onBackToList?.();
        }, "Conversation marked as Spam.");
      },
      icon: Delete02Icon,
      reason: unavailableActionReason,
      shortcutId: "detail-spam",
      tone: "destructive",
    },
    {
      enabled: canMarkRead,
      execute: async () => {
        await runThreadAction(async () => {
          await mailboxActions.markThreadAsRead(hotkeyMessage.threadId);
        }, "Conversation marked as Read.");
      },
      icon: MailOpen02Icon,
      reason: unavailableActionReason,
      shortcutId: "detail-mark-read",
    },
    {
      enabled: canMarkRead,
      execute: async () => {
        await runThreadAction(async () => {
          await mailboxActions.markThreadAsUnread(hotkeyMessage.threadId);
        }, "Conversation marked as Unread.");
      },
      icon: Mail01Icon,
      reason: unavailableActionReason,
      shortcutId: "detail-mark-unread",
    },
  ];
  const commands: AppCommand[] = KEYBOARD_SHORTCUTS.flatMap((shortcut) => {
    const action = actions.find((item) => item.shortcutId === shortcut.id);
    if (action === undefined) {
      return [];
    }
    return [
      {
        group: "Conversation actions",
        icon: action.icon,
        id: shortcut.id,
        keywords: action.keywords,
        label: action.label ?? shortcut.label,
        shortcutId: shortcut.id,
        tone: action.tone,
        ...(action.enabled
          ? { execute: action.execute, state: "available" }
          : { reason: action.reason, state: "unavailable" }),
      },
    ];
  });
  commands.push({
    group: "Navigation",
    icon: ArrowLeft01Icon,
    id: "detail-back",
    label: "Back to list",
    shortcutId: "detail-back",
    ...(onBackToList === undefined
      ? {
          reason: "Open the conversation from a mail list first.",
          state: "unavailable",
        }
      : { execute: onBackToList, state: "available" }),
  });
  useRegisterCommands(
    commands,
    JSON.stringify([
      mailboxId,
      activeMailbox,
      hotkeyMessage.threadId,
      hotkeyMessage.id,
    ]),
    normalizedSubject
  );
  useHotkeys(
    KEYBOARD_SHORTCUTS.flatMap((shortcut) => {
      const action = actions.find((item) => item.shortcutId === shortcut.id);
      if (action?.enabled !== true || !("keys" in shortcut)) {
        return [];
      }
      return shortcut.keys.map((hotkey) => ({
        callback: (event: KeyboardEvent) => {
          if (!shouldIgnoreAppShortcut(event)) {
            void action.execute();
          }
        },
        hotkey,
      }));
    }),
    { ignoreInputs: true }
  );
};
