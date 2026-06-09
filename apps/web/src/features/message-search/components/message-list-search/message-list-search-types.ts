export type MessageListSearchProps = {
  isRefreshing: boolean;
  mailboxId: string;
  mailboxProvider: "gmail" | "managed";
  onRefresh: () => void | Promise<void>;
  onOpenSidebar?: () => void;
  onScrollToTop: () => boolean | Promise<boolean> | void | Promise<void>;
  onSearch: (query: string) => void;
  searchQuery: string;
};

export type PendingFocusTarget =
  | { kind: "segment"; index: number; selectAll?: boolean; toEnd?: boolean }
  | { kind: "text"; toEnd?: boolean };

export type DropdownDirection = "next" | "previous";

export type SearchOverlayState = {
  activeDateFilterIndex: number | null;
  activeDropdownIndex: number | null;
  datePopoverLeft: number;
  isDropdownOpen: boolean;
};
