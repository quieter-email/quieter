"use client";

import {
  ArrowUpRight01Icon,
  Mail01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DailyBriefItem } from "@quieter/mail/daily-brief";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Textarea } from "@quieter/ui/textarea";
import { useId, useState } from "react";

import type { UnifiedInboxMailbox } from "#/features/mailbox/domain/unified-inbox";
import { parseSender } from "#/lib/gmail/message-utils";

export const DailyBriefCard = ({
  item,
  mailbox,
  showMailbox,
  busy,
  onOpenSource,
  onFeedback,
  onPrepareDraft,
}: {
  item: DailyBriefItem;
  mailbox: UnifiedInboxMailbox;
  showMailbox: boolean;
  busy: boolean;
  onOpenSource: (
    mailboxId: string,
    messageId: string,
    threadId: string
  ) => void;
  onFeedback: (
    action: "dismiss" | "not_important" | "defer",
    preference?: string
  ) => void;
  onPrepareDraft: () => void;
}) => {
  const preferenceId = useId();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <article
      aria-label={item.title}
      className="group relative grid grid-cols-[8px_minmax(0,1fr)] gap-x-3.5 sm:gap-x-5 [&:nth-child(3n)]:text-q-orange [&:nth-child(3n+1)]:text-q-blue [&:nth-child(3n+2)]:text-q-cyan"
    >
      <span
        aria-hidden
        className="mt-2 size-2 rounded-sm bg-current ring-4 ring-current/10"
      />
      <div className="min-w-0">
        <h2 className="pr-7 text-body-lg leading-snug font-medium tracking-tight text-fg">
          {item.title}
        </h2>
        <p className="mt-1.5 text-body leading-relaxed text-muted-fg">
          {item.summary}
        </p>
        <nav
          aria-label={`Emails for ${item.title}`}
          className="mt-3 overflow-hidden rounded-lg border border-current/15 bg-current/5"
        >
          {item.sources.map((source) => {
            const sender = source.fromName
              ? parseSender(source.fromName)
              : null;
            const senderLabel =
              sender?.name || sender?.email || sender?.display;
            return (
              <div
                className="min-w-0 border-t border-current/10 first:border-t-0"
                key={source.messageId}
              >
                <Button
                  aria-label={`Read ${source.subject || "email"}`}
                  // oxlint-disable-next-line shadcn/no-restyle -- Source emails share the topic accent and read as rows within one linked list.
                  className="group/source h-auto min-h-9 w-full justify-start gap-x-2.5 rounded-none px-3 py-2 text-left text-caption font-normal text-inherit hover:bg-current/10 hover:text-inherit sm:gap-x-3"
                  onClick={() => {
                    onOpenSource(mailbox.id, source.messageId, source.threadId);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <HugeiconsIcon
                    aria-hidden
                    icon={Mail01Icon}
                    className="size-3.5 opacity-70"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      {source.subject || "Email"}
                    </span>
                    {senderLabel ? (
                      <span className="max-w-full truncate text-muted-fg sm:max-w-32">
                        {senderLabel}
                      </span>
                    ) : null}
                  </span>
                  <HugeiconsIcon
                    aria-hidden
                    icon={ArrowUpRight01Icon}
                    className="size-3.5 opacity-40 transition-opacity group-hover/source:opacity-100 group-focus-visible/source:opacity-100"
                  />
                </Button>
              </div>
            );
          })}
        </nav>
        {showMailbox ? (
          <p className="mt-2 text-caption text-muted-fg">
            {mailbox.displayName || mailbox.emailAddress}
          </p>
        ) : null}
      </div>
      <DropdownMenu>
        <IconButtonTooltip label="Item actions">
          <DropdownMenuTrigger
            appearance="icon"
            aria-label={`Actions for ${item.title}`}
            // oxlint-disable-next-line shadcn/no-restyle -- Keep secondary actions quiet until hover or keyboard focus.
            className="absolute -top-1 -right-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100 max-sm:opacity-100"
            disabled={busy}
          >
            <HugeiconsIcon
              aria-hidden
              icon={MoreHorizontalIcon}
              className="size-4"
            />
          </DropdownMenuTrigger>
        </IconButtonTooltip>
        <DropdownMenuContent align="end" size="compact">
          {mailbox.grantRole === "reader" ? null : (
            <DropdownMenuItem onSelect={onPrepareDraft}>
              Prepare a reply
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              onFeedback("dismiss");
            }}
          >
            Dismiss
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onFeedback("defer");
            }}
          >
            Hide for an hour
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setFeedbackOpen(true);
            }}
          >
            Less like this
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const preference = new FormData(event.currentTarget).get(
                "preference"
              );
              onFeedback(
                "not_important",
                typeof preference === "string" ? preference.trim() : undefined
              );
              setFeedbackOpen(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>Less like this</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <label
                className="mb-2 block text-body text-muted-fg"
                htmlFor={preferenceId}
              >
                What should your brief focus on instead?
              </label>
              <Textarea
                id={preferenceId}
                name="preference"
                maxLength={1000}
                placeholder="Optional"
                rows={3}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                onClick={() => {
                  setFeedbackOpen(false);
                }}
                variant="ghost"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save feedback
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  );
};
