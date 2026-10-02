"use client";

import type {
  MailboxActions,
  MailboxPendingActions,
} from "#/features/mailbox/components/mailbox-action-handlers";
import type { MailboxCategory, MessageListItem } from "#/lib/mail";

export type MessageViewProps = {
  activeMailbox: MailboxCategory;
  composeDemoMode?: boolean;
  composeManagedDemoMode?: boolean;
  composePersistDrafts?: boolean;
  composeSignature?: { html: string | null; text: string | null };
  focusOnOpen?: boolean;
  currentUserEmail?: string | null;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  mailboxActions: MailboxActions;
  message: MessageListItem;
  onBackToList?: () => void;
  onAutoFocusComplete?: () => void;
  onManageTemplates?: () => void;
  pendingActions: MailboxPendingActions;
};
