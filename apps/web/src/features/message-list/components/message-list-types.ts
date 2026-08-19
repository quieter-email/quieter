import type { IconSvgElement } from "@hugeicons/react";

import type {
  MailboxActions,
  MailboxPendingActions,
} from "#/features/mailbox/components/mailbox-action-handlers";
import type {
  MessageLabelsTarget,
  MessageLabelsUpdate,
} from "#/features/message-labels/domain/message-label-updates";
import type {
  ListMessagesPageResult,
  MailboxCategory,
  MessageListItem,
} from "#/lib/gmail/gmail";

export type ThreadPressGesture = {
  additive: boolean;
  range: boolean;
};

export type MessageListProps = {
  activeMailbox: MailboxCategory;
  activeMessageId?: string | null;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  error: unknown;
  hasNextPage: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  isRefreshing: boolean;
  mailboxActions: MailboxActions;
  messages: ListMessagesPageResult[];
  onActivateMessage: (messageId: string, threadId?: string | null) => void;
  /** Plain row click on the already-open thread closes the reading pane (same as back). */
  onDeactivateActiveMessage: () => void;
  onLoadMore: () => void;
  onKeyboardOpenMessage?: () => void;
  onOpenSidebar?: () => void;
  onOpenDraft: (message: MessageListItem) => void;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  pendingActions: MailboxPendingActions;
  searchQuery: string;
};

export type MessageListBulkLabels = {
  isPending: boolean;
  mailboxId: string;
  onApply: (updates: MessageLabelsUpdate[]) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targets: readonly MessageLabelsTarget[];
};

export type MessageListBulkAction = {
  destructive?: boolean;
  icon: IconSvgElement;
  id: string;
  label: string;
  onSelect: () => void | Promise<void>;
  /** Gets its own header button whenever the row is wide enough to hold one. */
  promoted?: boolean;
};
