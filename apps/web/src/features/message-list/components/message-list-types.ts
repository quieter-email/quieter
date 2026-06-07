import type { IconSvgElement } from "@hugeicons/react";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "~/features/mailbox/components/mailbox-action-handlers";
import type { ListMessagesPageResult, MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";

export type ThreadPressGesture = {
  additive: boolean;
  range: boolean;
};

export type MessageListProps = {
  activeMailbox: MailboxCategory;
  activeMessageId?: string | null;
  mailboxId: string;
  mailboxProvider: "gmail" | "managed";
  error: unknown;
  hasNextPage: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  isRefreshing: boolean;
  mailboxActions: MailboxActions;
  messages: ListMessagesPageResult[];
  onActivateMessage: (messageId: string) => void;
  /** Plain row click on the already-open thread closes the reading pane (same as back). */
  onDeactivateActiveMessage: () => void;
  onLoadMore: () => void;
  onOpenSidebar?: () => void;
  onOpenDraft: (message: MessageListItem) => void;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onVisibleMessageIdsChange?: (messageIds: readonly string[]) => void;
  pendingActions: MailboxPendingActions;
  searchQuery: string;
};

export type MessageListBulkAction = {
  destructive?: boolean;
  icon: IconSvgElement;
  id: string;
  label: string;
  onSelect: () => void | Promise<void>;
};
