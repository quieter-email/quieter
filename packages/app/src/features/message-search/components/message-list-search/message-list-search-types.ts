import type { MailboxProvider } from "@quieter/mail/search";

export type MessageListSearchProps = {
  isRefreshing: boolean;
  mailboxId: string;
  mailboxProvider: MailboxProvider;
  onRefresh: () => void | Promise<void>;
  onScrollToTop: () => boolean | Promise<boolean>;
  onSearch: (query: string) => void;
  searchQuery: string;
  searchMailboxes?: readonly {
    mailboxId: string;
    mailboxProvider: Exclude<MailboxProvider, "api">;
  }[];
};

export type PendingFocusTarget =
  | { kind: "segment"; index: number; selectAll?: boolean; toEnd?: boolean }
  | { kind: "text"; index?: number; toEnd?: boolean };

export type DropdownDirection = "next" | "previous";

export type SearchOverlayState = {
  activeDateFilterIndex: number | null;
  activeDropdownIndex: number | null;
  datePopoverLeft: number;
  isDropdownOpen: boolean;
};
