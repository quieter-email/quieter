"use client";

import type { MessageListSearchProps } from "./message-list-search/message-list-search-types";
import { MessageListSearchView } from "./message-list-search/message-list-search-view";
import { useMessageListSearchController } from "./message-list-search/use-message-list-search-controller";

export const MessageListSearch = (props: MessageListSearchProps) => (
  <MessageListSearchView controller={useMessageListSearchController(props)} />
);
