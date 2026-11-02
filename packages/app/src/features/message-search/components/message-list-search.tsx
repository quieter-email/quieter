"use client";

import type { MessageListSearchProps } from "@quieter/app/features/message-search/components/message-list-search/message-list-search-types";
import { MessageListSearchView } from "@quieter/app/features/message-search/components/message-list-search/message-list-search-view";
import { useMessageListSearchController } from "@quieter/app/features/message-search/components/message-list-search/use-message-list-search-controller";

export const MessageListSearch = (props: MessageListSearchProps) => (
  <MessageListSearchView controller={useMessageListSearchController(props)} />
);
