"use client";

import type { ConversationNavigationScope } from "@quieter/app/components/conversation-navigator";
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
  navigationScope?: ConversationNavigationScope;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  mailboxActions: MailboxActions;
  message: MessageListItem;
  onConversationOpened?: (visit: {
    mailboxId: string;
    message: MessageListItem;
  }) => void;
  onBackToList?: () => void;
  onAutoFocusComplete?: () => void;
  onManageSnippets?: () => void;
  pendingActions: MailboxPendingActions;
};
