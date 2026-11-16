"use client";

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
    toastError(error, { boundary: "message-actions" });
  }
};

export const useMessageViewHotkeys = ({
  activeMailbox,
  canComposeFromMailbox,
  currentUserEmail,
  hotkeyLinkedDraftMessage,
  hotkeyMessage,
  isActionPending,
  mailboxActions,
  mailboxId,
  mailboxProvider,
  onBackToList,
  onComposeDraftRequested,
}: {
  activeMailbox: MailboxCategory;
  canComposeFromMailbox: boolean;
  currentUserEmail?: string | null;
  hotkeyLinkedDraftMessage: MessageListItem | undefined;
  hotkeyMessage: MessageListItem;
  isActionPending: boolean;
  mailboxActions: MailboxActions;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  onBackToList?: () => void;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
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
  const canCompose =
    canComposeFromMailbox &&
    onComposeDraftRequested !== undefined &&
    activeMailbox !== "drafts";
  const canMarkRead =
    !isActionPending &&
    mailboxActions.canMarkRead &&
    activeMailbox !== "drafts";
  const mailActionReason = isActionPending
    ? "Wait for the current action to finish."
    : "This action is unavailable for this conversation.";
  const actions: {
    enabled: boolean;
    execute: () => void | Promise<void>;
    reason: string;
    shortcutId: KeyboardShortcutId;
    tone?: "destructive";
  }[] = [
    {
      enabled: canCompose,
      execute: () => {
        requestComposeAction("reply");
      },
      reason: "Open a loaded conversation in a mailbox you can reply from.",
      shortcutId: "detail-reply",
    },
    {
      enabled:
        canCompose &&
        hasDistinctReplyAllRecipients(hotkeyMessage, currentUserEmail),
      execute: () => {
        requestComposeAction("reply-all");
      },
      reason: canCompose
        ? "There are no additional recipients to reply to."
        : "Open a loaded conversation in a mailbox you can reply from.",
      shortcutId: "detail-reply-all",
    },
    {
      enabled: canCompose,
      execute: () => {
        requestComposeAction("forward");
      },
      reason: "Open a loaded conversation in a mailbox you can send from.",
      shortcutId: "detail-forward",
    },
    {
      enabled:
        !isActionPending &&
        mailboxProvider !== "api" &&
        activeMailbox !== "drafts" &&
        activeMailbox !== "trash",
      execute: async () => {
        await runThreadAction(async () => {
          await mailboxActions.moveThreadToTrash(hotkeyMessage.threadId);
          onBackToList?.();
        }, "Conversation moved to Trash.");
      },
      reason: mailActionReason,
      shortcutId: "detail-trash",
      tone: "destructive",
    },
    {
      enabled:
        !isActionPending &&
        mailboxProvider === "gmail" &&
        activeMailbox === "inbox",
      execute: async () => {
        await runThreadAction(async () => {
          await mailboxActions.markThreadAsSpam(hotkeyMessage.threadId);
          onBackToList?.();
        }, "Conversation marked as Spam.");
      },
      reason: mailActionReason,
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
      reason: mailActionReason,
      shortcutId: "detail-mark-read",
    },
    {
      enabled: canMarkRead,
      execute: async () => {
        await runThreadAction(async () => {
          await mailboxActions.markThreadAsUnread(hotkeyMessage.threadId);
        }, "Conversation marked as Unread.");
      },
      reason: mailActionReason,
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
        description: hotkeyMessage.subject,
        group: "Conversation actions",
        id: shortcut.id,
        label: shortcut.label,
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
    ])
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
