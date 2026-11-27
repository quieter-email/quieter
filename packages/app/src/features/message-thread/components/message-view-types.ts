"use client";

import type { ComposeSenderMailbox } from "@quieter/app/features/compose/components/compose-workspace";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import type { CorrespondentHistoryActionProps } from "@quieter/app/features/message-thread/components/correspondent-history-action";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import type { RefObject } from "react";

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
  navigationInteractionRef?: RefObject<HTMLElement | null>;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  mailboxActions: MailboxActions;
  message: MessageListItem;
  onConversationOpened?: (visit: {
    mailboxId: string;
    message: MessageListItem;
  }) => void;
  onOpenConversation?: CorrespondentHistoryActionProps["onOpenConversation"];
  onBackToList?: () => void;
  /** Opens the mailbox list filtered to one label, from a label's menu. */
  onFilterByLabel?: (label: MailboxLabel) => void;
  onAutoFocusComplete?: () => void;
  onManageSnippets?: () => void;
  pendingActions: MailboxPendingActions;
};
