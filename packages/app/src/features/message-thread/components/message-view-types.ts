"use client";

import type { ComposeSenderMailbox } from "@quieter/app/features/compose/components/compose-workspace";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";

export type MessageViewProps = {
  activeMailbox: MailboxCategory;
  detailOnly?: boolean;
  showDesktopBack?: boolean;
  composeDemoMode?: boolean;
  composeManagedDemoMode?: boolean;
  composePersistDrafts?: boolean;
  composeSenderMailbox?: ComposeSenderMailbox;
  composeSignature?: { html: string | null; text: string | null };
  focusOnOpen?: boolean;
  currentUserEmail?: string | null;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  mailboxActions: MailboxActions;
  message: MessageListItem;
  onBackToList?: () => void;
  onAutoFocusComplete?: () => void;
  onManageSnippets?: () => void;
  pendingActions: MailboxPendingActions;
};
