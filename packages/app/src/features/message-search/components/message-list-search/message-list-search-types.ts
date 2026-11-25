import type { RefObject } from "react";

export type MessageListSearchProps = {
  focusSearchRef?: RefObject<(() => void) | null>;
  isRefreshing: boolean;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  onRefresh: () => void | Promise<void>;
  onScrollToTop: () => boolean | Promise<boolean>;
  onSearch: (query: string) => void;
  searchQuery: string;
  searchMailboxes?: readonly {
    mailboxId: string;
    mailboxProvider: "gmail" | "managed";
  }[];
};

export type PendingFocusTarget =
  | { kind: "segment"; index: number; selectAll?: boolean; toEnd?: boolean }
  | { kind: "text"; toEnd?: boolean };

export type SearchOverlayState = {
  activeDateFilterIndex: number | null;
  isDropdownOpen: boolean;
};
