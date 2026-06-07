"use client";

import {
  Cancel01Icon,
  Refresh01Icon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, IconButtonTooltip } from "@quieter/ui";
import { useRef } from "react";
import { ArrowInteractionButton } from "~/components/arrow-interaction-button";
import { SpinWhileActive } from "~/components/spin-while-active";
import type { MessageListSearchProps } from "./message-list-search/message-list-search-types";
import { MessageListSearchView } from "./message-list-search/message-list-search-view";
import { useMessageListSearchController } from "./message-list-search/use-message-list-search-controller";

const ManagedMessageListSearch = ({
  isRefreshing,
  onOpenSidebar,
  onRefresh,
  onScrollToTop,
  onSearch,
  searchQuery,
}: MessageListSearchProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = () => onSearch(inputRef.current?.value.trim() ?? "");

  return (
    <search className="block bg-transparent p-4">
      <div className="flex min-w-0 items-center gap-2 lg:-ml-2">
        {onOpenSidebar && (
          <IconButtonTooltip label="Open sidebar">
            <Button
              aria-label="Open sidebar"
              className="lg:hidden"
              onClick={onOpenSidebar}
              size="icon-sm"
              variant="outline"
            >
              <HugeiconsIcon icon={SidebarLeftIcon} />
            </Button>
          </IconButtonTooltip>
        )}

        <IconButtonTooltip label="Refresh list">
          <Button
            aria-label="Refresh list"
            disabled={isRefreshing}
            onClick={() => void onRefresh()}
            size="icon-sm"
            variant="outline"
          >
            <SpinWhileActive active={isRefreshing}>
              <HugeiconsIcon icon={Refresh01Icon} />
            </SpinWhileActive>
          </Button>
        </IconButtonTooltip>

        <div className="squircle flex h-8 min-w-0 flex-1 items-center rounded-md border border-input bg-background px-2 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <input
            aria-label="Search managed mailbox"
            autoCapitalize="off"
            autoCorrect="off"
            className="peer h-6 min-w-[8ch] flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            defaultValue={searchQuery}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search subject, sender, recipient, or message"
            ref={inputRef}
            spellCheck={false}
            type="text"
          />

          <IconButtonTooltip label="Clear search">
            <Button
              aria-label="Clear search"
              className="size-6 shrink-0 text-muted-foreground peer-placeholder-shown:pointer-events-none peer-placeholder-shown:invisible hover:text-foreground"
              onClick={() => {
                if (inputRef.current) {
                  inputRef.current.value = "";
                  inputRef.current.focus();
                }
                onSearch("");
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon className="size-4" icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>

          <IconButtonTooltip label="Run search">
            <Button
              aria-label="Run search"
              className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={runSearch}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={Search01Icon} />
            </Button>
          </IconButtonTooltip>
        </div>

        <IconButtonTooltip label="Scroll to top">
          <ArrowInteractionButton
            aria-label="Scroll to top"
            onClick={async () => {
              const didScroll = await onScrollToTop();
              return typeof didScroll === "boolean" ? didScroll : true;
            }}
            size="icon-sm"
            type="button"
            variant="outline"
          />
        </IconButtonTooltip>
      </div>
    </search>
  );
};

const GmailMessageListSearch = (props: MessageListSearchProps) => (
  <MessageListSearchView controller={useMessageListSearchController(props)} />
);

export const MessageListSearch = (props: MessageListSearchProps) =>
  props.mailboxProvider === "managed" ? (
    <ManagedMessageListSearch key={`${props.mailboxId}:${props.searchQuery}`} {...props} />
  ) : (
    <GmailMessageListSearch {...props} />
  );
