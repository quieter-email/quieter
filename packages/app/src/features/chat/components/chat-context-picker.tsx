import { Attachment01Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MAX_CHAT_CONTEXT_MESSAGES } from "@quieter/ai/chat-context";
import type { ChatContextItem } from "@quieter/app/features/chat/components/chat-composer";
import { parseSender } from "@quieter/app/lib/gmail/message-utils";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { messagesQueryOptions } from "@quieter/app/lib/mail/inbox-query/index";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Input } from "@quieter/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export const ChatContextPicker = ({
  attachedMessageIds,
  disabled,
  initialCategory,
  mailboxId,
  onSelect,
}: {
  attachedMessageIds: string[];
  disabled?: boolean;
  initialCategory: MailboxCategory;
  mailboxId: string;
  onSelect: (item: ChatContextItem) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(initialCategory);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [search]);
  const {
    data,
    isPending,
    isFetching,
    isError,
    refetch,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery(
    messagesQueryOptions(mailboxId, category, query || undefined, open)
  );
  const messages = data?.pages.flatMap((page) => page.messages) ?? [];
  const limitReached = attachedMessageIds.length >= MAX_CHAT_CONTEXT_MESSAGES;
  let status: string | undefined;
  if (isError) {
    status = "Could not load your mail.";
  } else if (isPending || query !== search.trim()) {
    status = "Finding mail…";
  } else if (messages.length === 0) {
    status = "No matching mail.";
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={<Button size="compact" variant="ghost" />}
      >
        <HugeiconsIcon aria-hidden icon={Attachment01Icon} />
        Attach mail
      </PopoverTrigger>
      <PopoverContent align="start" side="top" size="sm">
        <PopoverTitle>Mail context</PopoverTitle>
        <div className="mt-2">
          <Select
            items={[
              { label: "Inbox", value: "inbox" },
              { label: "Unread", value: "unread" },
              { label: "Sent", value: "sent" },
              { label: "Archive", value: "archive" },
              { label: "Drafts", value: "drafts" },
              { label: "Spam", value: "spam" },
              { label: "Trash", value: "trash" },
            ]}
            onValueChange={(value) => {
              if (value !== null) {
                setCategory(value);
              }
            }}
            value={category}
          >
            <SelectTrigger aria-label="Mail folder" size="sm" variant="ghost">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" size="compact">
              <SelectList>
                <SelectItem value="inbox">Inbox</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="archive">Archive</SelectItem>
                <SelectItem value="drafts">Drafts</SelectItem>
                <SelectItem value="spam">Spam</SelectItem>
                <SelectItem value="trash">Trash</SelectItem>
              </SelectList>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3">
          <Input
            aria-label="Search mail to attach"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search mail…"
            size="sm"
            value={search}
          />
        </div>
        <div className="mt-2 max-h-56 overflow-y-auto" aria-busy={isFetching}>
          {status === undefined ? (
            messages.map((message) => {
              const attached = attachedMessageIds.includes(message.id);
              return (
                <Button
                  aria-label={`Attach ${message.subject?.trim() || "Untitled mail"}`}
                  className="w-full"
                  disabled={attached || limitReached}
                  key={message.id}
                  onClick={() => {
                    onSelect({
                      id: `mail:${message.id}`,
                      label: message.subject?.trim() || "Untitled mail",
                      messageId: message.id,
                      threadId: message.threadId,
                    });
                    setOpen(false);
                  }}
                  size="auto"
                  variant="ghost"
                >
                  <HugeiconsIcon aria-hidden icon={Mail01Icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {message.subject?.trim() || "Untitled mail"}
                    </span>
                    <span className="block truncate text-caption text-muted-fg">
                      {attached ? "Attached" : parseSender(message.from).name}
                    </span>
                  </span>
                </Button>
              );
            })
          ) : (
            <p className="py-3 text-caption text-muted-fg">{status}</p>
          )}
        </div>
        {limitReached ? (
          <p className="mt-2 text-caption text-muted-fg">
            Remove some mail to attach more.
          </p>
        ) : null}
        {isError || hasNextPage ? (
          <ActionFooter className="mt-2">
            <Button
              disabled={isFetching}
              onClick={() => {
                void (isError ? refetch() : fetchNextPage());
              }}
              size="sm"
            >
              {isError ? "Try again" : "Load more"}
            </Button>
          </ActionFooter>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
